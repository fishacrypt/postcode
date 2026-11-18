import { recoverMessageAddress, type Hex } from 'viem'
import { claimCommitment, hashCanonical, type Json } from '@pp/crypto'
import { decrypt, encrypt, randomSalt } from '@pp/crypto/server'
import { assessGps, getCountryModule, validatePostcode } from '@pp/address'
import { CREDENTIAL_VALIDITY_DAYS, SENSITIVE_CLAIMS, type ClaimField, type CredentialDocument } from '@pp/shared'
import type { AppContext } from '../context'
import { HttpError } from '../http'
import { loadOwned, readSensitive } from '../addresses/service'

export interface CredentialRow {
  id: string
  user_id: string
  address_id: string | null
  credential_version: number
  document: CredentialDocument
  document_hash: string
  issuer_address: string
  issuer_signature: string
  claims_blob: Uint8Array | null
  status: 'active' | 'revoked'
  issued_at: Date
  expires_at: Date
  renewed_from: string | null
  created_at: Date
}

export type EffectiveStatus = 'active' | 'expired' | 'revoked'

export function effectiveStatus(row: Pick<CredentialRow, 'status' | 'expires_at'>, now: Date): EffectiveStatus {
  if (row.status === 'revoked') return 'revoked'
  return row.expires_at <= now ? 'expired' : 'active'
}

interface StoredClaims {
  [field: string]: { value: string; salt: string }
}

const aad = (id: string, userId: string): string => `credential:${id}:${userId}`
const DAY = 24 * 3600_000

export async function loadOwnedCredential(app: AppContext, id: string, userId: string): Promise<CredentialRow> {
  const rows = await app.db<CredentialRow[]>`SELECT * FROM credentials WHERE id = ${id} AND user_id = ${userId}`
  const row = rows[0]
  if (!row) throw new HttpError(404, 'not_found', 'Credential not found.')
  return row
}

export async function issueCredential(
  app: AppContext,
  userId: string,
  addressId: string,
  renewedFrom: string | null = null,
): Promise<CredentialRow> {
  const address = await loadOwned(app, addressId, userId)
  const module = getCountryModule(address.country)
  if (!module) throw new HttpError(422, 'country_unsupported', 'This country is not active yet.')
  const sensitive = readSensitive(app, address)

  // Re-run validation now so the credential reflects today's dataset, using the stored GPS fix as captured.
  let validation
  try {
    validation = await validatePostcode(
      module,
      app.provider,
      { postcode: address.postcode, state: address.state, lga: address.lga, gps: sensitive.gps },
      app.now(),
    )
  } catch {
    throw new HttpError(503, 'postcode_validation_unavailable', 'The postcode validation provider is temporarily unavailable. Try again before issuing a credential.')
  }
  if (!validation.format.valid) {
    throw new HttpError(422, 'address_not_valid', 'Fix the postcode before issuing a credential.')
  }
  if (validation.dataset.status !== 'matched') {
    throw new HttpError(422, 'postcode_not_verified', 'A successful postcode dataset match is required before issuing a credential.')
  }
  if (validation.geographic.status === 'inconsistent') {
    throw new HttpError(422, 'address_inconsistent', validation.geographic.detail)
  }
  const gpsFix = assessGps(address.country, sensitive.gps, app.now()).status === 'confirmed'

  const values: Partial<Record<ClaimField, string>> = {
    country: address.country,
    state: address.state,
    lga: address.lga,
    city: address.city,
    postcode: address.postcode,
    street: sensitive.street,
    buildingNumber: sensitive.buildingNumber,
  }
  if (sensitive.district) values.district = sensitive.district

  const stored: StoredClaims = {}
  const commitments: Partial<Record<ClaimField, string>> = {}
  for (const [field, value] of Object.entries(values) as [ClaimField, string][]) {
    const salt = randomSalt()
    stored[field] = { value, salt }
    commitments[field] = claimCommitment(field, value, salt)
  }

  const id = crypto.randomUUID()
  const issuedAt = app.now()
  const expiresAt = new Date(issuedAt.getTime() + CREDENTIAL_VALIDITY_DAYS * DAY)
  const document: CredentialDocument = {
    format: 'postcodeproof.credential.v1',
    version: 1,
    id,
    type: 'AddressCredential',
    issuer: { name: 'PostcodeProof', address: app.config.signer.address },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    subjectRef: `pp:subject:${crypto.randomUUID()}`,
    addressCommitment: hashCanonical({ commitments }),
    commitments,
    assurance: {
      level: validation.assuranceLevel,
      formatValid: validation.format.valid,
      datasetMatch: validation.dataset.status === 'matched',
      gpsFix,
      proofOfResidence: 'not_established',
      postcodeFormat: validation.format.format,
      validationSource: app.provider.id,
      validationEnvironment: app.provider.id === 'nipost-validator'
        ? app.config.nipostEnvironment
        : 'local',
    },
  }
  const documentHash = hashCanonical(document as unknown as Json)
  const signature = await app.config.signer.signDigest(documentHash)
  const { blob, keyVersion } = encrypt(app.config.keys, JSON.stringify(stored), aad(id, userId))

  const rows = await app.db.begin(async (tx) => {
    const inserted = await tx<CredentialRow[]>`
      INSERT INTO credentials (id, user_id, address_id, document, document_hash, issuer_address, issuer_signature,
                               claims_blob, encryption_key_version, issued_at, expires_at, renewed_from)
      VALUES (${id}, ${userId}, ${address.id}, ${JSON.stringify(document)}::text::jsonb, ${documentHash}, ${app.config.signer.address},
              ${signature}, ${blob}, ${keyVersion}, ${issuedAt}, ${expiresAt}, ${renewedFrom})
      RETURNING *`
    return inserted
  })
  const row = rows[0]
  if (!row) throw new Error('Credential insert failed')
  return row
}

export async function revokeCredential(
  app: AppContext,
  row: CredentialRow,
  revokedBy: string | null,
  source: 'holder' | 'issuer' | 'admin' | 'renewal' | 'address_deleted',
  reason: string | null,
): Promise<void> {
  if (row.status === 'revoked') throw new HttpError(409, 'already_revoked', 'This credential is already revoked.')
  await app.db.begin(async (tx) => {
    await tx`UPDATE credentials SET status = 'revoked' WHERE id = ${row.id}`
    await tx`
      INSERT INTO credential_revocations (credential_id, revoked_by, source, reason)
      VALUES (${row.id}, ${revokedBy}, ${source}, ${reason})`
    await tx`UPDATE verification_tokens SET revoked_at = ${app.now()} WHERE credential_id = ${row.id} AND revoked_at IS NULL`
  })
}

/** Decrypts only the requested claims. */
export function disclose(
  app: AppContext,
  row: CredentialRow,
  fields: readonly string[],
): { field: ClaimField; value: string; salt: string }[] {
  if (!row.claims_blob) return []
  const stored = JSON.parse(decrypt(app.config.keys, row.claims_blob, aad(row.id, row.user_id))) as StoredClaims
  const out: { field: ClaimField; value: string; salt: string }[] = []
  for (const f of fields) {
    const entry = stored[f]
    if (entry) out.push({ field: f as ClaimField, value: entry.value, salt: entry.salt })
  }
  return out
}

export function assertSensitiveAcknowledged(fields: readonly string[], acknowledged: boolean): void {
  const sensitive = fields.filter((f) => (SENSITIVE_CLAIMS as readonly string[]).includes(f))
  if (sensitive.length > 0 && !acknowledged) {
    throw new HttpError(
      422,
      'sensitive_not_acknowledged',
      'Street-level details identify your exact home. Confirm that you want to share them.',
      { fields: 'Street-level fields need explicit confirmation.' },
    )
  }
}

export interface SignatureCheck {
  hashMatches: boolean
  signatureValid: boolean
  issuerTrusted: boolean
  issuer: string | null
}

/** Authenticity check for any presented credential document. */
export async function checkSignature(app: AppContext, document: CredentialDocument, signature: string): Promise<SignatureCheck> {
  try {
    const hash = hashCanonical(document as unknown as Json)
    const recovered = await recoverMessageAddress({ message: { raw: hash }, signature: signature as Hex })
    const claimed = document.issuer?.address?.toLowerCase()
    const signatureValid = claimed === recovered.toLowerCase()
    return {
      hashMatches: true,
      signatureValid,
      issuerTrusted: signatureValid && app.config.trustedIssuers.includes(recovered.toLowerCase()),
      issuer: recovered,
    }
  } catch {
    return { hashMatches: false, signatureValid: false, issuerTrusted: false, issuer: null }
  }
}

export function disclosureMatches(
  document: CredentialDocument,
  d: { field: string; value: string; salt: string },
): boolean {
  const commitment = (document.commitments as Record<string, string | undefined>)[d.field]
  return commitment !== undefined && commitment === claimCommitment(d.field, d.value, d.salt)
}

export const RENEWAL_WINDOW_DAYS = 30

export function renewalEligible(row: CredentialRow, now: Date, addressUpdatedAt: Date | null): boolean {
  if (row.status === 'revoked' || !row.address_id) return false
  const nearExpiry = row.expires_at.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * DAY
  const stale = addressUpdatedAt !== null && addressUpdatedAt > row.issued_at
  return nearExpiry || stale
}

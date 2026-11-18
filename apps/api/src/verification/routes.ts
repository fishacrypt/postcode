import { consentCodeSchema, consentDecisionSchema, disclosureRequestSchema, presentationSchema, tokenSchema } from '@pp/validation'
import { ASSURANCE_LABELS } from '@pp/address'
import { hashCanonical } from '@pp/crypto'
import { CLAIM_LABELS, SENSITIVE_CLAIMS, type ClaimField, type CredentialDocument } from '@pp/shared'
import { HttpError, json, limit, readBody, requireUser, type Ctx, type Router } from '../http'
import { audit, hashOneTimeToken, ipHash } from '../security/session'
import { authBusiness, hashRequestCode } from '../business/auth'
import { notify } from '../services/notifications'
import { onchainStatus, type OnchainStatus } from '../services/chain'
import {
  assertSensitiveAcknowledged,
  checkSignature,
  disclose,
  disclosureMatches,
  effectiveStatus,
  type CredentialRow,
} from '../credentials/service'

interface TokenJoin {
  token_id: string
  user_id: string
  fields: ClaimField[]
  max_uses: number | null
  use_count: number
  expires_at: Date
  revoked_at: Date | null
  request_id: string | null
}

const NOTICE =
  'This confirms an address credential was issued and is still valid. It does not prove that the holder lives at the address.'

const GENERIC_UNAVAILABLE = new HttpError(404, 'link_unavailable', 'This verification link is invalid, expired or no longer available.')

type Status = 'valid' | 'expired' | 'revoked' | 'invalid' | 'unavailable'

function labelled(items: { field: ClaimField; value: string }[]) {
  return items.map((d) => ({ field: d.field, label: CLAIM_LABELS[d.field], value: d.value, sensitive: (SENSITIVE_CLAIMS as readonly string[]).includes(d.field) }))
}

function summary(document: CredentialDocument, status: Status, onchain: OnchainStatus | null, revokedAt: Date | null = null) {
  return {
    status,
    reference: document.id.slice(0, 8),
    issuedAt: document.issuedAt,
    expiresAt: document.expiresAt,
    revokedAt,
    issuer: document.issuer,
    assurance: { ...document.assurance, label: ASSURANCE_LABELS[document.assurance.level] },
    onchain,
    notice: NOTICE,
  }
}

async function logVerification(
  ctx: Ctx,
  entry: { credentialId: string | null; tokenId?: string | null; businessId?: string | null; channel: string; outcome: string; fields: string[] },
): Promise<void> {
  await ctx.app.db`
    INSERT INTO verification_logs (credential_id, token_id, business_id, channel, outcome, fields, ip_hash)
    VALUES (${entry.credentialId}, ${entry.tokenId ?? null}, ${entry.businessId ?? null}, ${entry.channel}, ${entry.outcome},
            ${JSON.stringify(entry.fields)}::text::jsonb, ${ipHash(ctx.app, ctx.ip)})`
}

async function credentialStatus(ctx: Ctx, row: CredentialRow): Promise<{ status: Status; onchain: OnchainStatus | null; revokedAt: Date | null }> {
  const sig = await checkSignature(ctx.app, row.document, row.issuer_signature)
  if (!sig.issuerTrusted) return { status: 'invalid', onchain: null, revokedAt: null }
  const base = effectiveStatus(row, ctx.app.now())
  const revocations = await ctx.app.db<{ created_at: Date }[]>`SELECT created_at FROM credential_revocations WHERE credential_id = ${row.id} LIMIT 1`
  const revokedAt = revocations[0]?.created_at ?? null
  // A local revocation is definitive; it must not become "unavailable" just because RPC is down.
  if (base === 'revoked') return { status: 'revoked', onchain: null, revokedAt }
  const anchored = await ctx.app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM credential_anchors WHERE credential_id = ${row.id}`
  const hasAnchor = Number(anchored[0]?.n ?? 0) > 0
  const onchain = hasAnchor ? await onchainStatus(ctx.app.config, row.id) : null
  // For anchored credentials, the registry is part of the validity check. Never
  // claim validity when its status cannot be confirmed or the anchor is missing.
  if (onchain === 'revoked') return { status: 'revoked', onchain, revokedAt }
  if (onchain === 'expired') return { status: 'expired', onchain, revokedAt: null }
  if (onchain === 'unknown') return { status: 'unavailable', onchain, revokedAt: null }
  if (onchain === 'none') return { status: 'invalid', onchain, revokedAt: null }
  return { status: base === 'active' ? 'valid' : base, onchain, revokedAt: base === 'revoked' ? revokedAt : null }
}

export function registerVerificationRoutes(router: Router): void {
  /** Public link check. Unknown, expired, revoked and exhausted links all look the same to the caller. */
  router.post('/api/v1/verify/link', async (ctx) => {
    limit(ctx, 'verify-link', 30, 60_000)
    const body = await readBody(ctx, tokenSchema)
    const hash = hashOneTimeToken(ctx.app, 'verify-link', body.token)
    const rows = await ctx.app.db<TokenJoin[]>`
      UPDATE verification_tokens SET use_count = use_count + 1
      WHERE token_hash = ${hash} AND revoked_at IS NULL AND expires_at > ${ctx.app.now()}
        AND (max_uses IS NULL OR use_count < max_uses)
      RETURNING id AS token_id, user_id, fields, max_uses, use_count, expires_at, revoked_at, request_id`
    const t = rows[0]
    if (!t) {
      limit(ctx, 'verify-link-miss', 10, 10 * 60_000)
      throw GENERIC_UNAVAILABLE
    }
    const creds = await ctx.app.db<CredentialRow[]>`
      SELECT c.* FROM credentials c JOIN verification_tokens v ON v.credential_id = c.id WHERE v.id = ${t.token_id}`
    const row = creds[0]
    if (!row) throw GENERIC_UNAVAILABLE
    const { status, onchain, revokedAt } = await credentialStatus(ctx, row)
    const disclosed = status === 'valid' ? disclose(ctx.app, row, t.fields) : []
    await logVerification(ctx, { credentialId: row.id, tokenId: t.token_id, channel: 'public_link', outcome: status, fields: disclosed.map((d) => d.field) })
    return json({
      ...summary(row.document, status, onchain, revokedAt),
      disclosed: labelled(disclosed),
      linkExpiresAt: t.expires_at,
    })
  })

  /** Verifies a downloaded presentation without needing a link. */
  router.post('/api/v1/verify/credential', async (ctx) => {
    limit(ctx, 'verify-credential', 30, 60_000)
    const body = await readBody(ctx, presentationSchema)
    const document = body.document as unknown as CredentialDocument
    if (document?.format !== 'postcodeproof.credential.v1' || typeof document.id !== 'string' || !document.commitments || !document.issuer) {
      throw new HttpError(422, 'validation_failed', 'This is not a PostcodeProof credential.')
    }
    const sig = await checkSignature(ctx.app, document, body.signature)
    const disclosures = body.disclosures.map((d) => ({ ...d, matches: disclosureMatches(document, d) }))
    let status: Status = 'invalid'
    let onchain: OnchainStatus | null = null
    let revokedAt: Date | null = null
    let credentialRecordFound = false
    if (sig.issuerTrusted) {
      const stored = await ctx.app.db<CredentialRow[]>`
        SELECT * FROM credentials WHERE document_hash = ${hashCanonical(document as never)}`
      const row = stored[0]
      credentialRecordFound = Boolean(row)
      // A trusted signature alone is not enough: the authoritative record must exist
      // so local revocation and lifecycle state can be checked before calling it valid.
      if (row) ({ status, onchain, revokedAt } = await credentialStatus(ctx, row))
      else status = 'invalid'
    }
    const allMatch = disclosures.every((d) => d.matches)
    await logVerification(ctx, { credentialId: null, channel: 'presentation', outcome: status, fields: disclosures.map((d) => d.field) })
    return json({
      ...summary(document, status, onchain, revokedAt),
      checks: {
        signatureValid: sig.signatureValid,
        issuerTrusted: sig.issuerTrusted,
        credentialRecordFound,
        disclosuresMatch: allMatch,
      },
      disclosed: labelled(disclosures.filter((d) => d.matches && status === 'valid')),
    })
  })

  /** The holder looks up a business request by its code before deciding. */
  router.post('/api/v1/verify/requests/preview', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'consent-code', 10, 10 * 60_000, true)
    const body = await readBody(ctx, consentCodeSchema)
    const rows = await ctx.app.db<{ id: string; purpose: string; reference: string; requested_fields: ClaimField[]; expires_at: Date; business: string }[]>`
      SELECT r.id, r.purpose, r.reference, r.requested_fields, r.expires_at, b.name AS business
      FROM verification_requests r JOIN businesses b ON b.id = r.business_id
      WHERE r.code_hash = ${hashRequestCode(ctx.app, body.code)} AND r.status = 'pending' AND r.expires_at > ${ctx.app.now()}`
    const r = rows[0]
    if (!r) throw new HttpError(404, 'request_unavailable', 'No open request matches this code.')
    await audit(ctx.app, user.id, 'consent.request_viewed', {}, ctx.ip)
    return json({
      request: {
        business: r.business,
        purpose: r.purpose,
        reference: r.reference,
        requestedFields: r.requested_fields.map((f) => ({ field: f, label: CLAIM_LABELS[f], sensitive: (SENSITIVE_CLAIMS as readonly string[]).includes(f) })),
        expiresAt: r.expires_at,
      },
    })
  })

  router.post('/api/v1/verify/consent', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'consent-decision', 20, 10 * 60_000, true)
    const body = await readBody(ctx, consentDecisionSchema)
    const rows = await ctx.app.db<{ id: string; business_id: string; requested_fields: ClaimField[]; purpose: string; business: string }[]>`
      SELECT r.id, r.business_id, r.requested_fields, r.purpose, b.name AS business
      FROM verification_requests r JOIN businesses b ON b.id = r.business_id
      WHERE r.code_hash = ${hashRequestCode(ctx.app, body.code)} AND r.status = 'pending' AND r.expires_at > ${ctx.app.now()}
`
    const r = rows[0]
    if (!r) throw new HttpError(404, 'request_unavailable', 'No open request matches this code.')

    if (!body.approve) {
      await ctx.app.db`UPDATE verification_requests SET status = 'declined', decided_at = ${ctx.app.now()}, decided_by = ${user.id} WHERE id = ${r.id}`
      await ctx.app.db`
        INSERT INTO consent_records (user_id, kind, decision, request_id, recipient, purpose, fields)
        VALUES (${user.id}, 'disclosure', 'declined', ${r.id}, ${r.business}, ${r.purpose}, ${JSON.stringify(r.requested_fields)}::text::jsonb)`
      return json({ decision: 'declined' })
    }
    const fields = [...new Set(body.fields)]
    if (fields.length === 0 || fields.some((f) => !r.requested_fields.includes(f))) {
      throw new HttpError(422, 'validation_failed', 'Choose at least one requested field. You cannot share more than was requested.', { fields: 'Pick from the requested fields.' })
    }
    assertSensitiveAcknowledged(fields, body.acknowledgeSensitive)
    if (!body.credentialId) throw new HttpError(422, 'validation_failed', 'Choose a credential.', { credentialId: 'Required.' })
    const creds = await ctx.app.db<CredentialRow[]>`SELECT * FROM credentials WHERE id = ${body.credentialId} AND user_id = ${user.id}`
    const cred = creds[0]
    if (!cred || effectiveStatus(cred, ctx.app.now()) !== 'active') throw new HttpError(409, 'not_active', 'Choose an active credential.')
    if (fields.some((f) => !(cred.document.commitments as Record<string, string | undefined>)[f])) {
      throw new HttpError(422, 'validation_failed', 'This credential does not contain every selected field.')
    }
    const expires = new Date(ctx.app.now().getTime() + 24 * 3600_000)
    const tokenHash = hashOneTimeToken(ctx.app, 'verify-link', crypto.randomUUID() + crypto.randomUUID())
    await ctx.app.db.begin(async (tx) => {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO verification_tokens (user_id, credential_id, request_id, token_hash, fields, label, expires_at)
        VALUES (${user.id}, ${cred.id}, ${r.id}, ${tokenHash}, ${JSON.stringify(fields)}::text::jsonb, ${`For ${r.business}`}, ${expires})
        RETURNING id`
      const claimed = await tx<{ id: string }[]>`
        UPDATE verification_requests SET status = 'approved', decided_at = ${ctx.app.now()}, decided_by = ${user.id}
        WHERE id = ${r.id} AND status = 'pending' RETURNING id`
      if (!claimed[0]) throw new HttpError(409, 'request_unavailable', 'This request was already answered.')
      await tx`
        INSERT INTO consent_records (user_id, kind, decision, request_id, token_id, credential_id, recipient, purpose, fields)
        VALUES (${user.id}, 'disclosure', 'granted', ${r.id}, ${inserted[0]?.id ?? null}, ${cred.id}, ${r.business}, ${r.purpose}, ${JSON.stringify(fields)}::text::jsonb)`
    })
    await audit(ctx.app, user.id, 'consent.granted', { requestId: r.id, fields: fields.length }, ctx.ip)
    await notify.consentGranted(ctx.app, user.id, r.business, fields.length)
    return json({ decision: 'approved', shared: fields, business: r.business, availableUntil: expires })
  })

  router.get('/api/v1/consents', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const rows = await ctx.app.db<{ id: string; kind: string; decision: string; recipient: string | null; purpose: string | null; fields: string[]; created_at: Date; token_id: string | null }[]>`
      SELECT id, kind, decision, recipient, purpose, fields, created_at, token_id
      FROM consent_records WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 100`
    return json({
      consents: rows.map((r) => ({
        id: r.id, kind: r.kind, decision: r.decision, recipient: r.recipient, purpose: r.purpose, fields: r.fields,
        createdAt: r.created_at, tokenId: r.token_id,
      })),
    })
  })

  /** A holder's own history of who checked their credential. No addresses, no raw tokens. */
  router.get('/api/v1/verification-history', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const rows = await ctx.app.db<{ id: string; channel: string; outcome: string; fields: string[]; created_at: Date; business: string | null }[]>`
      SELECT l.id::text, l.channel, l.outcome, l.fields, l.created_at, b.name AS business
      FROM verification_logs l
      JOIN credentials c ON c.id = l.credential_id
      LEFT JOIN businesses b ON b.id = l.business_id
      WHERE c.user_id = ${user.id} ORDER BY l.id DESC LIMIT 100`
    return json({
      history: rows.map((r) => ({ id: r.id, channel: r.channel, outcome: r.outcome, fields: r.fields, business: r.business, createdAt: r.created_at })),
    })
  })

  /** A business collects what the holder approved. Replays are allowed until the window closes and every read is logged. */
  router.post('/api/v1/verify/disclosure', async (ctx) => {
    const actor = await authBusiness(ctx, 'verification:read')
    const body = await readBody(ctx, disclosureRequestSchema)
    const rows = await ctx.app.db<(TokenJoin & { credential_id: string })[]>`
      SELECT v.id AS token_id, v.user_id, v.fields, v.max_uses, v.use_count, v.expires_at, v.revoked_at, v.request_id, v.credential_id
      FROM verification_tokens v JOIN verification_requests r ON r.id = v.request_id
      WHERE r.id = ${body.requestId} AND r.business_id = ${actor.businessId} AND r.status = 'approved'
      ORDER BY v.created_at DESC LIMIT 1`
    const t = rows[0]
    if (!t) throw new HttpError(404, 'not_found', 'No approved request with this id.')
    if (t.revoked_at || t.expires_at <= ctx.app.now()) {
      throw new HttpError(410, 'disclosure_closed', 'The holder withdrew consent or the disclosure window has closed.')
    }
    const creds = await ctx.app.db<CredentialRow[]>`SELECT * FROM credentials WHERE id = ${t.credential_id}`
    const row = creds[0]
    if (!row) throw new HttpError(404, 'not_found', 'No approved request with this id.')
    const { status, onchain } = await credentialStatus(ctx, row)
    const disclosed = status === 'valid' ? disclose(ctx.app, row, t.fields) : []
    await ctx.app.db`UPDATE verification_tokens SET use_count = use_count + 1 WHERE id = ${t.token_id}`
    await logVerification(ctx, {
      credentialId: row.id, tokenId: t.token_id, businessId: actor.businessId,
      channel: actor.apiKeyId ? 'business_api' : 'business_dashboard', outcome: status, fields: disclosed.map((d) => d.field),
    })
    return json({ requestId: body.requestId, ...summary(row.document, status, onchain), disclosed: labelled(disclosed), availableUntil: t.expires_at })
  })
}

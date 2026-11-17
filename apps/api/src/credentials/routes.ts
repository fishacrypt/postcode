import { z } from 'zod'
import type { Hex } from 'viem'
import { randomToken } from '@pp/crypto/server'
import { anchorSchema, credentialCreateSchema, revokeSchema, tokenCreateSchema } from '@pp/validation'
import { CLAIM_FIELDS, type ClaimField } from '@pp/shared'
import { HttpError, json, limit, readBody, requireUser, requireVerifiedEmail, type Ctx, type Router } from '../http'
import { audit, hashOneTimeToken } from '../security/session'
import { notify } from '../services/notifications'
import { confirmAnchorTx, onchainId, onchainStatus } from '../services/chain'
import {
  assertSensitiveAcknowledged,
  disclose,
  effectiveStatus,
  issueCredential,
  loadOwnedCredential,
  renewalEligible,
  revokeCredential,
  type CredentialRow,
} from './service'

const idParam = (raw: string | undefined): string => {
  const parsed = z.string().uuid().safeParse(raw)
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Credential not found.')
  return parsed.data
}

interface AnchorRow {
  chain_id: number
  registry_address: string
  holder_address: string
  tx_hash: string
  status: string
  anchored_at: Date
}

const DOMAIN_NAME = 'PostcodeProof Credential Registry'
const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'credentialId', type: 'bytes32' },
    { name: 'commitment', type: 'bytes32' },
    { name: 'holder', type: 'address' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const
const REVOCATION_TYPES = {
  Revocation: [
    { name: 'credentialId', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

async function toDto(ctx: Ctx, row: CredentialRow) {
  const now = ctx.app.now()
  const anchors = await ctx.app.db<AnchorRow[]>`
    SELECT chain_id, registry_address, holder_address, tx_hash, status, anchored_at
    FROM credential_anchors WHERE credential_id = ${row.id} ORDER BY anchored_at DESC LIMIT 1`
  const addr = row.address_id
    ? await ctx.app.db<{ state: string; lga: string; city: string; postcode: string; updated_at: Date }[]>`
        SELECT state, lga, city, postcode, updated_at FROM addresses WHERE id = ${row.address_id}`
    : []
  const a = addr[0]
  const anchor = anchors[0]
  return {
    id: row.id,
    type: row.document.type,
    version: row.credential_version,
    status: effectiveStatus(row, now),
    issuer: row.document.issuer,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    credentialHash: row.document_hash,
    assurance: row.document.assurance,
    renewedFrom: row.renewed_from,
    renewable: renewalEligible(row, now, a?.updated_at ?? null),
    addressChanged: a ? a.updated_at > row.issued_at : false,
    address: a ? { state: a.state, lga: a.lga, city: a.city, postcode: a.postcode } : null,
    anchor: anchor
      ? {
          status: 'anchored' as const,
          chainId: anchor.chain_id,
          registry: anchor.registry_address,
          holder: anchor.holder_address,
          txHash: anchor.tx_hash,
          anchoredAt: anchor.anchored_at,
        }
      : { status: 'not_anchored' as const },
  }
}

export function registerCredentialRoutes(router: Router): void {
  router.post('/api/v1/credentials', async (ctx) => {
    const user = requireUser(ctx, 'user')
    requireVerifiedEmail(user)
    limit(ctx, 'credential-issue', 10, 60 * 60 * 1000, true)
    const body = await readBody(ctx, credentialCreateSchema)
    const existing = await ctx.app.db<{ n: string }[]>`
      SELECT count(*)::text AS n FROM credentials
      WHERE address_id = ${body.addressId} AND user_id = ${user.id} AND status = 'active' AND expires_at > ${ctx.app.now()}`
    if (Number(existing[0]?.n ?? 0) > 0) {
      throw new HttpError(409, 'credential_exists', 'This address already has an active credential. Renew it instead.')
    }
    const row = await issueCredential(ctx.app, user.id, body.addressId)
    await ctx.app.db`
      INSERT INTO consent_records (user_id, kind, decision, credential_id, recipient, purpose, fields, statement_version)
      VALUES (${user.id}, 'credential_issuance', 'granted', ${row.id}, 'PostcodeProof', 'Issue an address credential',
              ${JSON.stringify(CLAIM_FIELDS)}::text::jsonb, ${body.consent.statementVersion})`
    await audit(ctx.app, user.id, 'credential.issued', { credentialId: row.id }, ctx.ip)
    await notify.credentialIssued(ctx.app, user.id, row.expires_at)
    return json({ credential: await toDto(ctx, row) }, 201)
  })

  router.get('/api/v1/credentials', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const rows = await ctx.app.db<CredentialRow[]>`SELECT * FROM credentials WHERE user_id = ${user.id} ORDER BY created_at DESC`
    return json({ credentials: await Promise.all(rows.map((r) => toDto(ctx, r))) })
  })

  router.get('/api/v1/credentials/:id', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const row = await loadOwnedCredential(ctx.app, idParam(ctx.params.id), user.id)
    return json({ credential: await toDto(ctx, row), document: row.document, signature: row.issuer_signature })
  })

  router.post('/api/v1/credentials/:id/revoke', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const row = await loadOwnedCredential(ctx.app, idParam(ctx.params.id), user.id)
    const body = await readBody(ctx, revokeSchema)
    await revokeCredential(ctx.app, row, user.id, 'holder', body.reason ?? null)
    await audit(ctx.app, user.id, 'credential.revoked', { credentialId: row.id }, ctx.ip)
    await notify.credentialRevoked(ctx.app, user.id, 'you')
    return json({ credential: await toDto(ctx, await loadOwnedCredential(ctx.app, row.id, user.id)), onchain: await revocationPermit(ctx, row) })
  })

  router.post('/api/v1/credentials/:id/renew', async (ctx) => {
    const user = requireUser(ctx, 'user')
    requireVerifiedEmail(user)
    limit(ctx, 'credential-issue', 10, 60 * 60 * 1000, true)
    const old = await loadOwnedCredential(ctx.app, idParam(ctx.params.id), user.id)
    const addr = old.address_id
      ? await ctx.app.db<{ updated_at: Date }[]>`SELECT updated_at FROM addresses WHERE id = ${old.address_id}`
      : []
    if (!old.address_id || !renewalEligible(old, ctx.app.now(), addr[0]?.updated_at ?? null)) {
      throw new HttpError(409, 'not_renewable', 'This credential cannot be renewed yet.')
    }
    const next = await issueCredential(ctx.app, user.id, old.address_id, old.id)
    if (old.status === 'active') await revokeCredential(ctx.app, old, user.id, 'renewal', 'Replaced by a renewed credential')
    await audit(ctx.app, user.id, 'credential.renewed', { credentialId: next.id, previous: old.id }, ctx.ip)
    return json({ credential: await toDto(ctx, next) }, 201)
  })

  /**
   * Two-phase anchoring. Without txHash: returns an EIP-712 attestation the holder wallet submits to the registry.
   * With txHash: verifies the registration event on chain, then records the anchor.
   */
  router.post('/api/v1/credentials/:id/anchor', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'credential-anchor', 20, 60 * 60 * 1000, true)
    const row = await loadOwnedCredential(ctx.app, idParam(ctx.params.id), user.id)
    const body = await readBody(ctx, anchorSchema)
    const registry = ctx.app.config.registryAddress
    if (!registry) throw new HttpError(503, 'registry_not_configured', 'Onchain anchoring is not configured yet.')
    if (effectiveStatus(row, ctx.app.now()) !== 'active') throw new HttpError(409, 'not_active', 'Only active credentials can be anchored.')
    const holder = body.holder as Hex

    if (body.txHash) {
      const ok = await confirmAnchorTx(ctx.app.config, body.txHash as Hex, {
        credentialId: row.id, commitment: row.document_hash as Hex, holder,
      })
      if (!ok) throw new HttpError(422, 'anchor_unconfirmed', 'The transaction does not register this credential.')
      await ctx.app.db`
        INSERT INTO credential_anchors (credential_id, chain_id, registry_address, holder_address, commitment, tx_hash)
        VALUES (${row.id}, ${ctx.app.config.anchorChainId}, ${registry}, ${holder.toLowerCase()}, ${row.document_hash}, ${body.txHash})
        ON CONFLICT DO NOTHING`
      await audit(ctx.app, user.id, 'credential.anchored', { credentialId: row.id }, ctx.ip)
      return json({ credential: await toDto(ctx, row) })
    }

    const expiresAt = BigInt(Math.floor(row.expires_at.getTime() / 1000))
    const deadline = BigInt(Math.floor(ctx.app.now().getTime() / 1000) + 3600)
    const message = {
      credentialId: onchainId(row.id),
      commitment: row.document_hash as Hex,
      holder,
      expiresAt,
      deadline,
    }
    const domain = { name: DOMAIN_NAME, version: '1', chainId: ctx.app.config.anchorChainId, verifyingContract: registry }
    const signature = await ctx.app.config.signer.signTypedData({
      domain, types: ATTESTATION_TYPES, primaryType: 'Attestation', message,
    })
    return json({
      attestation: {
        registry,
        chainId: ctx.app.config.anchorChainId,
        credentialId: message.credentialId,
        commitment: message.commitment,
        expiresAt: expiresAt.toString(),
        deadline: deadline.toString(),
        issuer: ctx.app.config.signer.address,
        signature,
      },
    })
  })

  /** Opaque verification links. The raw token is returned once; only its hash is stored. */
  router.post('/api/v1/credentials/:id/links', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'link-create', 30, 60 * 60 * 1000, true)
    const row = await loadOwnedCredential(ctx.app, idParam(ctx.params.id), user.id)
    const body = await readBody(ctx, tokenCreateSchema)
    if (effectiveStatus(row, ctx.app.now()) !== 'active') throw new HttpError(409, 'not_active', 'Only active credentials can be shared.')
    assertSensitiveAcknowledged(body.fields, body.acknowledgeSensitive)
    const present = body.fields.filter((f) => (row.document.commitments as Record<string, string | undefined>)[f])
    if (present.length !== body.fields.length) throw new HttpError(422, 'validation_failed', 'This credential does not contain every selected field.')
    const active = await ctx.app.db<{ n: string }[]>`
      SELECT count(*)::text AS n FROM verification_tokens
      WHERE credential_id = ${row.id} AND revoked_at IS NULL AND expires_at > ${ctx.app.now()}`
    if (Number(active[0]?.n ?? 0) >= 20) throw new HttpError(409, 'link_limit', 'Revoke an existing link before creating another.')
    const token = randomToken(32)
    const expires = new Date(ctx.app.now().getTime() + body.expiresInHours * 3600_000)
    const rows = await ctx.app.db<{ id: string }[]>`
      INSERT INTO verification_tokens (user_id, credential_id, token_hash, fields, label, max_uses, expires_at)
      VALUES (${user.id}, ${row.id}, ${hashOneTimeToken(ctx.app, 'verify-link', token)}, ${JSON.stringify(present)}::text::jsonb,
              ${body.label ?? null}, ${body.maxUses ?? null}, ${expires}) RETURNING id`
    const linkId = rows[0]?.id
    await ctx.app.db`
      INSERT INTO consent_records (user_id, kind, decision, token_id, credential_id, recipient, purpose, fields)
      VALUES (${user.id}, 'disclosure', 'granted', ${linkId ?? null}, ${row.id}, 'Anyone holding the link', ${body.label ?? 'Shared verification link'},
              ${JSON.stringify(present)}::text::jsonb)`
    await audit(ctx.app, user.id, 'verification_link.created', { credentialId: row.id }, ctx.ip)
    return json({ link: { id: linkId, token, path: `/verify#${token}`, expiresAt: expires, fields: present } }, 201)
  })

  router.get('/api/v1/links', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const rows = await ctx.app.db<{ id: string; credential_id: string; label: string | null; fields: ClaimField[]; max_uses: number | null; use_count: number; expires_at: Date; revoked_at: Date | null; created_at: Date }[]>`
      SELECT id, credential_id, label, fields, max_uses, use_count, expires_at, revoked_at, created_at
      FROM verification_tokens WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 100`
    return json({
      links: rows.map((r) => ({
        id: r.id, credentialId: r.credential_id, label: r.label, fields: r.fields, maxUses: r.max_uses, useCount: r.use_count,
        expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at,
        state: r.revoked_at ? 'revoked' : r.expires_at <= ctx.app.now() ? 'expired' : 'active',
      })),
    })
  })

  router.delete('/api/v1/links/:id', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const id = z.string().uuid().safeParse(ctx.params.id)
    if (!id.success) throw new HttpError(404, 'not_found', 'Link not found.')
    const rows = await ctx.app.db<{ id: string }[]>`
      UPDATE verification_tokens SET revoked_at = ${ctx.app.now()}
      WHERE id = ${id.data} AND user_id = ${user.id} AND revoked_at IS NULL RETURNING id`
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Link not found.')
    await ctx.app.db`
      INSERT INTO consent_records (user_id, kind, decision, token_id) VALUES (${user.id}, 'disclosure', 'withdrawn', ${id.data})`
    await audit(ctx.app, user.id, 'verification_link.revoked', {}, ctx.ip)
    return json({ ok: true })
  })

  /** Downloadable presentation: the signed document plus only the claims you choose to reveal. */
  router.get('/api/v1/credentials/:id/presentation', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const row = await loadOwnedCredential(ctx.app, idParam(ctx.params.id), user.id)
    const fields = (ctx.url.searchParams.get('fields') ?? '').split(',').filter(Boolean)
    const parsed = z.array(z.enum(CLAIM_FIELDS)).max(CLAIM_FIELDS.length).safeParse(fields)
    if (!parsed.success) throw new HttpError(422, 'validation_failed', 'Unknown field.')
    assertSensitiveAcknowledged(parsed.data, ctx.url.searchParams.get('acknowledgeSensitive') === 'true')
    await audit(ctx.app, user.id, 'credential.downloaded', { credentialId: row.id, disclosed: parsed.data.length }, ctx.ip)
    return json({
      document: row.document,
      signature: row.issuer_signature,
      disclosures: disclose(ctx.app, row, parsed.data),
    })
  })
}

/** When a credential is anchored, hand the holder a permit that revokes it onchain through any relayer. */
async function revocationPermit(ctx: Ctx, row: CredentialRow) {
  const registry = ctx.app.config.registryAddress
  if (!registry) return null
  const anchors = await ctx.app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM credential_anchors WHERE credential_id = ${row.id}`
  if (Number(anchors[0]?.n ?? 0) === 0) return null
  const deadline = BigInt(Math.floor(ctx.app.now().getTime() / 1000) + 3600)
  const message = { credentialId: onchainId(row.id), deadline }
  const signature = await ctx.app.config.signer.signTypedData({
    domain: { name: DOMAIN_NAME, version: '1', chainId: ctx.app.config.anchorChainId, verifyingContract: registry },
    types: REVOCATION_TYPES, primaryType: 'Revocation', message,
  })
  return {
    registry, chainId: ctx.app.config.anchorChainId, credentialId: message.credentialId,
    deadline: deadline.toString(), issuer: ctx.app.config.signer.address, signature,
    onchainStatus: await onchainStatus(ctx.app.config, row.id),
  }
}

import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { randomToken } from '@pp/crypto/server'
import { apiKeyCreateSchema, businessUpdateSchema, verificationRequestCreateSchema } from '@pp/validation'
import { HttpError, json, limit, readBody, requireUser, requireVerifiedEmail, type Router } from '../http'
import { audit } from '../security/session'
import { authBusiness, hashApiKey, hashRequestCode } from './auth'

// Unambiguous alphabet (no 0/O, 1/I/L). 8 characters = 40 bits, short-lived and rate limited.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const makeCode = (): string => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

const uuid = (raw: string | undefined): string => {
  const p = z.string().uuid().safeParse(raw)
  if (!p.success) throw new HttpError(404, 'not_found', 'Not found.')
  return p.data
}

export function registerBusinessRoutes(router: Router): void {
  router.get('/api/v1/businesses/me', async (ctx) => {
    const user = requireUser(ctx, 'business')
    const rows = await ctx.app.db<{ id: string; name: string; website: string | null; contact_email: string | null; description: string | null; status: string; created_at: Date }[]>`
      SELECT id, name, website, contact_email, description, status, created_at FROM businesses WHERE owner_user_id = ${user.id}`
    const b = rows[0]
    if (!b) throw new HttpError(404, 'not_found', 'No business profile.')
    return json({ business: { id: b.id, name: b.name, website: b.website, contactEmail: b.contact_email, description: b.description, status: b.status, createdAt: b.created_at } })
  })

  router.add('PATCH', '/api/v1/businesses/me', async (ctx) => {
    const user = requireUser(ctx, 'business')
    const body = await readBody(ctx, businessUpdateSchema)
    await ctx.app.db`
      UPDATE businesses SET name = ${body.name}, website = ${body.website || null}, contact_email = ${body.contactEmail || null},
        description = ${body.description ?? null}
      WHERE owner_user_id = ${user.id}`
    await audit(ctx.app, user.id, 'business.updated', {}, ctx.ip)
    return json({ ok: true })
  })

  router.post('/api/v1/businesses/api-keys', async (ctx) => {
    const user = requireUser(ctx, 'business')
    requireVerifiedEmail(user)
    limit(ctx, 'api-key-create', 10, 60 * 60 * 1000, true)
    const body = await readBody(ctx, apiKeyCreateSchema)
    const biz = await ctx.app.db<{ id: string }[]>`SELECT id FROM businesses WHERE owner_user_id = ${user.id}`
    const businessId = biz[0]?.id
    if (!businessId) throw new HttpError(404, 'not_found', 'No business profile.')
    const count = await ctx.app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM business_api_keys WHERE business_id = ${businessId} AND revoked_at IS NULL`
    if (Number(count[0]?.n ?? 0) >= 10) throw new HttpError(409, 'key_limit', 'Revoke an unused key before creating another.')
    const key = `pp_live_${randomToken(32)}`
    const expires = body.expiresInDays ? new Date(ctx.app.now().getTime() + body.expiresInDays * 86400_000) : null
    const rows = await ctx.app.db<{ id: string }[]>`
      INSERT INTO business_api_keys (business_id, name, prefix, key_hash, scopes, expires_at)
      VALUES (${businessId}, ${body.name}, ${key.slice(0, 16)}, ${hashApiKey(ctx.app, key)}, ${JSON.stringify(body.scopes)}::text::jsonb, ${expires})
      RETURNING id`
    await audit(ctx.app, user.id, 'business.api_key_created', { keyId: rows[0]?.id ?? null }, ctx.ip)
    // The only time the plaintext key is ever returned.
    return json({ key, apiKey: { id: rows[0]?.id, name: body.name, prefix: key.slice(0, 16), scopes: body.scopes, expiresAt: expires } }, 201)
  })

  router.get('/api/v1/businesses/api-keys', async (ctx) => {
    const user = requireUser(ctx, 'business')
    const rows = await ctx.app.db<{ id: string; name: string; prefix: string; scopes: string[]; created_at: Date; expires_at: Date | null; last_used_at: Date | null; revoked_at: Date | null }[]>`
      SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.expires_at, k.last_used_at, k.revoked_at
      FROM business_api_keys k JOIN businesses b ON b.id = k.business_id
      WHERE b.owner_user_id = ${user.id} ORDER BY k.created_at DESC`
    return json({
      apiKeys: rows.map((k) => ({
        id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.created_at,
        expiresAt: k.expires_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at,
      })),
    })
  })

  router.delete('/api/v1/businesses/api-keys/:id', async (ctx) => {
    const user = requireUser(ctx, 'business')
    const id = uuid(ctx.params.id)
    const rows = await ctx.app.db<{ id: string }[]>`
      UPDATE business_api_keys k SET revoked_at = ${ctx.app.now()}
      FROM businesses b WHERE k.id = ${id} AND k.business_id = b.id AND b.owner_user_id = ${user.id} AND k.revoked_at IS NULL
      RETURNING k.id`
    if (!rows[0]) throw new HttpError(404, 'not_found', 'API key not found.')
    await audit(ctx.app, user.id, 'business.api_key_revoked', { keyId: id }, ctx.ip)
    return json({ ok: true })
  })

  router.get('/api/v1/businesses/usage', async (ctx) => {
    const user = requireUser(ctx, 'business')
    const perKey = await ctx.app.db<{ id: string; name: string; prefix: string; calls_24h: string; calls_30d: string }[]>`
      SELECT k.id, k.name, k.prefix,
        count(u.id) FILTER (WHERE u.created_at > now() - interval '24 hours')::text AS calls_24h,
        count(u.id) FILTER (WHERE u.created_at > now() - interval '30 days')::text AS calls_30d
      FROM business_api_keys k JOIN businesses b ON b.id = k.business_id
      LEFT JOIN api_usage u ON u.api_key_id = k.id
      WHERE b.owner_user_id = ${user.id} GROUP BY k.id ORDER BY k.created_at DESC`
    const daily = await ctx.app.db<{ day: string; calls: string }[]>`
      SELECT to_char(date_trunc('day', u.created_at), 'YYYY-MM-DD') AS day, count(*)::text AS calls
      FROM api_usage u JOIN business_api_keys k ON k.id = u.api_key_id JOIN businesses b ON b.id = k.business_id
      WHERE b.owner_user_id = ${user.id} AND u.created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`
    return json({
      keys: perKey.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, calls24h: Number(k.calls_24h), calls30d: Number(k.calls_30d) })),
      daily: daily.map((d) => ({ day: d.day, calls: Number(d.calls) })),
    })
  })

  router.post('/api/v1/businesses/verification-requests', async (ctx) => {
    const actor = await authBusiness(ctx, 'verification:create')
    limit(ctx, 'vr-create', 60, 60 * 60 * 1000)
    const body = await readBody(ctx, verificationRequestCreateSchema)
    const code = makeCode()
    const expires = new Date(ctx.app.now().getTime() + body.expiresInHours * 3600_000)
    const rows = await ctx.app.db<{ id: string }[]>`
      INSERT INTO verification_requests (business_id, reference, purpose, requested_fields, code_hash, code_hint, expires_at, api_key_id)
      VALUES (${actor.businessId}, ${body.reference}, ${body.purpose}, ${JSON.stringify(body.requestedFields)}::text::jsonb,
              ${hashRequestCode(ctx.app, code)}, ${code.slice(-2)}, ${expires}, ${actor.apiKeyId})
      RETURNING id`
    // The code is shown once. The business gives it to the person, who enters it in their PostcodeProof account.
    return json({ request: { id: rows[0]?.id, code, reference: body.reference, requestedFields: body.requestedFields, expiresAt: expires, status: 'pending' } }, 201)
  })

  router.get('/api/v1/businesses/verification-requests', async (ctx) => {
    const actor = await authBusiness(ctx, 'verification:read')
    const rows = await ctx.app.db<{ id: string; reference: string; purpose: string; requested_fields: string[]; status: string; expires_at: Date; decided_at: Date | null; created_at: Date; code_hint: string }[]>`
      SELECT id, reference, purpose, requested_fields, status, expires_at, decided_at, created_at, code_hint
      FROM verification_requests WHERE business_id = ${actor.businessId} ORDER BY created_at DESC LIMIT 100`
    const now = ctx.app.now()
    return json({
      requests: rows.map((r) => ({
        id: r.id, reference: r.reference, purpose: r.purpose, requestedFields: r.requested_fields,
        status: r.status === 'pending' && r.expires_at <= now ? 'expired' : r.status,
        codeHint: `••••••${r.code_hint}`, expiresAt: r.expires_at, decidedAt: r.decided_at, createdAt: r.created_at,
      })),
    })
  })

  router.get('/api/v1/businesses/verification-requests/:id', async (ctx) => {
    const actor = await authBusiness(ctx, 'verification:read')
    const id = uuid(ctx.params.id)
    const rows = await ctx.app.db<{ id: string; reference: string; status: string; expires_at: Date; decided_at: Date | null }[]>`
      SELECT id, reference, status, expires_at, decided_at FROM verification_requests WHERE id = ${id} AND business_id = ${actor.businessId}`
    const r = rows[0]
    if (!r) throw new HttpError(404, 'not_found', 'Request not found.')
    return json({
      request: {
        id: r.id, reference: r.reference,
        status: r.status === 'pending' && r.expires_at <= ctx.app.now() ? 'expired' : r.status,
        expiresAt: r.expires_at, decidedAt: r.decided_at,
      },
    })
  })

  router.delete('/api/v1/businesses/verification-requests/:id', async (ctx) => {
    const actor = await authBusiness(ctx, 'verification:create')
    const id = uuid(ctx.params.id)
    const rows = await ctx.app.db<{ id: string }[]>`
      UPDATE verification_requests SET status = 'cancelled'
      WHERE id = ${id} AND business_id = ${actor.businessId} AND status = 'pending' RETURNING id`
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Open request not found.')
    return json({ ok: true })
  })

  router.get('/api/v1/businesses/history', async (ctx) => {
    const actor = await authBusiness(ctx, 'verification:read')
    const rows = await ctx.app.db<{ id: string; channel: string; outcome: string; fields: string[]; created_at: Date }[]>`
      SELECT id::text, channel, outcome, fields, created_at FROM verification_logs
      WHERE business_id = ${actor.businessId} ORDER BY id DESC LIMIT 100`
    return json({ history: rows.map((r) => ({ id: r.id, channel: r.channel, outcome: r.outcome, fields: r.fields, createdAt: r.created_at })) })
  })
}

import { z } from 'zod'
import { adminRoleSchema, contactSchema, revokeSchema } from '@pp/validation'
import { HttpError, json, limit, readBody, requireUser, type Router } from '../http'
import { audit } from '../security/session'
import { revokeCredential, type CredentialRow } from '../credentials/service'
import { notify } from '../services/notifications'

const uuid = (raw: string | undefined): string => {
  const p = z.string().uuid().safeParse(raw)
  if (!p.success) throw new HttpError(404, 'not_found', 'Not found.')
  return p.data
}

export function registerAdminRoutes(router: Router): void {
  router.get('/api/v1/admin/users', async (ctx) => {
    requireUser(ctx, 'admin')
    const rows = await ctx.app.db<{ id: string; email: string; role: string; status: string; email_verified_at: Date | null; created_at: Date }[]>`
      SELECT id, email, role, status, email_verified_at, created_at FROM users ORDER BY created_at DESC LIMIT 200`
    return json({ users: rows.map((u) => ({ id: u.id, email: u.email, role: u.role, status: u.status, emailVerified: u.email_verified_at !== null, createdAt: u.created_at })) })
  })

  router.post('/api/v1/admin/users/:id/role', async (ctx) => {
    const admin = requireUser(ctx, 'admin')
    const id = uuid(ctx.params.id)
    if (id === admin.id) throw new HttpError(409, 'self_change', 'You cannot change your own role.')
    const body = await readBody(ctx, adminRoleSchema)
    const rows = await ctx.app.db<{ id: string }[]>`UPDATE users SET role = ${body.role} WHERE id = ${id} RETURNING id`
    if (!rows[0]) throw new HttpError(404, 'not_found', 'User not found.')
    await ctx.app.db`DELETE FROM sessions WHERE user_id = ${id}`
    await audit(ctx.app, admin.id, 'admin.role_changed', { target: id, role: body.role }, ctx.ip)
    await notify.securityAlert(ctx.app, id, `Your account role was changed to ${body.role} by an administrator`)
    return json({ ok: true })
  })

  router.post('/api/v1/admin/users/:id/status', async (ctx) => {
    const admin = requireUser(ctx, 'admin')
    const id = uuid(ctx.params.id)
    if (id === admin.id) throw new HttpError(409, 'self_change', 'You cannot suspend yourself.')
    const body = await readBody(ctx, z.object({ status: z.enum(['active', 'suspended']) }))
    await ctx.app.db`UPDATE users SET status = ${body.status} WHERE id = ${id}`
    if (body.status === 'suspended') await ctx.app.db`DELETE FROM sessions WHERE user_id = ${id}`
    await audit(ctx.app, admin.id, 'admin.status_changed', { target: id, status: body.status }, ctx.ip)
    return json({ ok: true })
  })

  router.get('/api/v1/admin/businesses', async (ctx) => {
    requireUser(ctx, 'admin')
    const rows = await ctx.app.db<{ id: string; name: string; status: string; email: string; created_at: Date; keys: string; requests: string }[]>`
      SELECT b.id, b.name, b.status, u.email, b.created_at,
        (SELECT count(*) FROM business_api_keys k WHERE k.business_id = b.id AND k.revoked_at IS NULL)::text AS keys,
        (SELECT count(*) FROM verification_requests r WHERE r.business_id = b.id)::text AS requests
      FROM businesses b JOIN users u ON u.id = b.owner_user_id ORDER BY b.created_at DESC LIMIT 200`
    return json({ businesses: rows.map((b) => ({ id: b.id, name: b.name, status: b.status, ownerEmail: b.email, activeKeys: Number(b.keys), requests: Number(b.requests), createdAt: b.created_at })) })
  })

  router.post('/api/v1/admin/businesses/:id/status', async (ctx) => {
    const admin = requireUser(ctx, 'admin')
    const id = uuid(ctx.params.id)
    const body = await readBody(ctx, z.object({ status: z.enum(['active', 'suspended']) }))
    const rows = await ctx.app.db<{ id: string }[]>`UPDATE businesses SET status = ${body.status} WHERE id = ${id} RETURNING id`
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Business not found.')
    // A suspended business loses every API key at once; keys are not restored when it is reactivated.
    if (body.status === 'suspended') await ctx.app.db`UPDATE business_api_keys SET revoked_at = ${ctx.app.now()} WHERE business_id = ${id} AND revoked_at IS NULL`
    await audit(ctx.app, admin.id, 'admin.business_status_changed', { target: id, status: body.status }, ctx.ip)
    return json({ ok: true })
  })

  router.get('/api/v1/admin/verification-activity', async (ctx) => {
    requireUser(ctx, 'admin')
    const rows = await ctx.app.db<{ day: string; channel: string; outcome: string; n: string }[]>`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, channel, outcome, count(*)::text AS n
      FROM verification_logs WHERE created_at > now() - interval '14 days' GROUP BY 1, 2, 3 ORDER BY 1 DESC`
    return json({ activity: rows.map((r) => ({ day: r.day, channel: r.channel, outcome: r.outcome, count: Number(r.n) })) })
  })

  router.get('/api/v1/admin/health', async (ctx) => {
    requireUser(ctx, 'admin')
    const counts = await ctx.app.db<{ users: string; credentials: string; active_credentials: string; sessions: string }[]>`
      SELECT (SELECT count(*) FROM users)::text AS users, (SELECT count(*) FROM credentials)::text AS credentials,
             (SELECT count(*) FROM credentials WHERE status = 'active' AND expires_at > ${ctx.app.now()})::text AS active_credentials,
             (SELECT count(*) FROM sessions WHERE expires_at > ${ctx.app.now()})::text AS sessions`
    const migrations = await ctx.app.db<{ name: string }[]>`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`
    const c = counts[0]
    return json({
      database: 'ok',
      latestMigration: migrations[0]?.name ?? null,
      postcodeDataset: (await ctx.app.provider.isAvailable('NG')) ? 'loaded' : 'not loaded',
      registry: ctx.app.config.registryAddress ? 'configured' : 'not configured',
      mailer: ctx.app.config.mailer,
      encryptionKeyVersion: ctx.app.config.keys.currentVersion,
      issuer: ctx.app.config.signer.address,
      counts: { users: Number(c?.users ?? 0), credentials: Number(c?.credentials ?? 0), activeCredentials: Number(c?.active_credentials ?? 0), sessions: Number(c?.sessions ?? 0) },
    })
  })

  router.get('/api/v1/admin/audit', async (ctx) => {
    requireUser(ctx, 'admin')
    const rows = await ctx.app.db<{ id: string; user_id: string | null; actor_role: string | null; action: string; meta: unknown; created_at: Date }[]>`
      SELECT id::text, user_id, actor_role, action, meta, created_at FROM audit_logs ORDER BY id DESC LIMIT 200`
    return json({ events: rows.map((r) => ({ id: r.id, userId: r.user_id, actorRole: r.actor_role, action: r.action, meta: r.meta, createdAt: r.created_at })) })
  })

  // Issuers and admins see credential metadata only (never address values) and can revoke for abuse.
  router.get('/api/v1/issuer/credentials', async (ctx) => {
    requireUser(ctx, 'issuer', 'admin')
    const rows = await ctx.app.db<{ id: string; status: string; issued_at: Date; expires_at: Date; assurance: number }[]>`
      SELECT id, status, issued_at, expires_at, (document->'assurance'->>'level')::int AS assurance
      FROM credentials ORDER BY created_at DESC LIMIT 200`
    return json({ credentials: rows.map((r) => ({ id: r.id, status: r.status, issuedAt: r.issued_at, expiresAt: r.expires_at, assurance: r.assurance })) })
  })

  // Admin registry: searchable metadata and revocation history, without address claims.
  router.get('/api/v1/admin/credentials', async (ctx) => {
    requireUser(ctx, 'admin')
    const rawPage = Number(ctx.url.searchParams.get('page') ?? '1')
    const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, 10000)) : 1
    const pageSize = 20
    const search = (ctx.url.searchParams.get('q') ?? '').trim().slice(0, 100)
    const status = ctx.url.searchParams.get('status') ?? 'all'
    if (!['all', 'active', 'expired', 'revoked'].includes(status)) {
      throw new HttpError(422, 'validation_failed', 'Unknown credential status filter.')
    }
    const pattern = `%${search}%`
    const filterStatus = status
    const rows = await ctx.app.db<{
      id: string; status: string; issued_at: Date; expires_at: Date; assurance: number;
      owner_email: string; revoked_at: Date | null; revoked_by_email: string | null;
      revocation_source: string | null; revocation_reason: string | null;
    }[]>`
      SELECT c.id, c.status, c.issued_at, c.expires_at,
        (c.document->'assurance'->>'level')::int AS assurance, u.email AS owner_email,
        rev.created_at AS revoked_at, actor.email AS revoked_by_email,
        rev.source AS revocation_source, rev.reason AS revocation_reason
      FROM credentials c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN LATERAL (
        SELECT credential_id, revoked_by, source, reason, created_at
        FROM credential_revocations WHERE credential_id = c.id
        ORDER BY created_at DESC LIMIT 1
      ) rev ON true
      LEFT JOIN users actor ON actor.id = rev.revoked_by
      WHERE (${search} = '' OR c.id::text ILIKE ${pattern} OR u.email ILIKE ${pattern})
        AND (${filterStatus} = 'all'
          OR (${filterStatus} = 'revoked' AND c.status = 'revoked')
          OR (${filterStatus} = 'expired' AND c.status = 'active' AND c.expires_at <= ${ctx.app.now()})
          OR (${filterStatus} = 'active' AND c.status = 'active' AND c.expires_at > ${ctx.app.now()}))
      ORDER BY c.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
    const totals = await ctx.app.db<{ total: string }[]>`
      SELECT count(*)::text AS total FROM credentials c JOIN users u ON u.id = c.user_id
      WHERE (${search} = '' OR c.id::text ILIKE ${pattern} OR u.email ILIKE ${pattern})
        AND (${filterStatus} = 'all'
          OR (${filterStatus} = 'revoked' AND c.status = 'revoked')
          OR (${filterStatus} = 'expired' AND c.status = 'active' AND c.expires_at <= ${ctx.app.now()})
          OR (${filterStatus} = 'active' AND c.status = 'active' AND c.expires_at > ${ctx.app.now()}))`
    return json({
      credentials: rows.map((r) => ({
        id: r.id, status: r.status === 'revoked' ? 'revoked' : r.expires_at <= ctx.app.now() ? 'expired' : 'active',
        issuedAt: r.issued_at, expiresAt: r.expires_at, assurance: r.assurance, holderEmail: r.owner_email,
        revocation: r.revoked_at ? { revokedAt: r.revoked_at, revokedBy: r.revoked_by_email, source: r.revocation_source, reason: r.revocation_reason } : null,
      })),
      page, pageSize, total: Number(totals[0]?.total ?? 0),
    })
  })

  router.post('/api/v1/issuer/credentials/:id/revoke', async (ctx) => {
    const actor = requireUser(ctx, 'issuer', 'admin')
    const id = uuid(ctx.params.id)
    const body = await readBody(ctx, revokeSchema)
    const rows = await ctx.app.db<CredentialRow[]>`SELECT * FROM credentials WHERE id = ${id}`
    const row = rows[0]
    if (!row) throw new HttpError(404, 'not_found', 'Credential not found.')
    await revokeCredential(ctx.app, row, actor.id, actor.role === 'admin' ? 'admin' : 'issuer', body.reason ?? null)
    await audit(ctx.app, actor.id, actor.role === 'admin' ? 'admin.credential_revoked' : 'issuer.credential_revoked', { credentialId: id }, ctx.ip)
    await notify.credentialRevoked(ctx.app, row.user_id, 'an issuer or administrator')
    return json({ ok: true })
  })

  router.post('/api/v1/contact', async (ctx) => {
    limit(ctx, 'contact', 5, 60 * 60 * 1000)
    const body = await readBody(ctx, contactSchema)
    await ctx.app.db`INSERT INTO contact_messages (name, email, message) VALUES (${body.name}, ${body.email}, ${body.message})`
    return json({ ok: true }, 201)
  })

  router.get('/api/v1/health', async (ctx) => {
    await ctx.app.db`SELECT 1`
    return json({ ok: true, time: ctx.app.now().toISOString() })
  })

  // Development convenience only: lets you read emailed one-time links without a mail provider.
  router.get('/api/v1/dev/outbox', (ctx) => {
    if (ctx.app.config.env === 'production' || ctx.app.config.mailer !== 'dev' || process.env.ENABLE_DEV_OUTBOX !== 'true') throw new HttpError(404, 'not_found', 'Not found.')
    const mailer = ctx.app.mailer as { outbox?: { to: string; kind: string; token: string; subject: string }[] }
    const email = ctx.url.searchParams.get('email')?.toLowerCase()
    const items = (mailer.outbox ?? []).filter((m) => m.to === email).slice(-5).reverse()
    return json({ messages: items.map((m) => ({ kind: m.kind, subject: m.subject, token: m.token })) })
  })
}

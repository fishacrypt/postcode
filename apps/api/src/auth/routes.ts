import { z } from 'zod'
import {
  forgotPasswordSchema,
  loginSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '@pp/validation'
import { randomToken } from '@pp/crypto/server'
import {
  HttpError,
  json,
  limit,
  readBody,
  requireUser,
  sessionCookie,
  SESSION_COOKIE,
  type Ctx,
  type Router,
} from '../http'
import {
  audit,
  createSession,
  destroySession,
  hashOneTimeToken,
  refreshSession,
  SESSION_TTL_SECONDS,
} from '../security/session'
import { notify } from '../services/notifications'
import type { SessionUser } from '../context'

const MAX_FAILED = 5
const LOCK_MINUTES = 15
const EMAIL_TOKEN_HOURS = 24
const RESET_TOKEN_MINUTES = 30

let dummyHash: Promise<string> | null = null
/** Argon2id with explicit parameters (OWASP minimum profile: 19 MiB memory, 2 iterations). */
const ARGON2 = { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 } as const
const hashPassword = (password: string): Promise<string> => Bun.password.hash(password, ARGON2)
const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword('postcodeproof-timing-equaliser'))

interface UserRow {
  id: string
  email: string
  password_hash: string
  role: SessionUser['role']
  display_name: string | null
  email_verified_at: Date | null
  failed_logins: number
  locked_until: Date | null
}

export const publicUser = (u: Pick<SessionUser, 'id' | 'email' | 'displayName' | 'role' | 'emailVerified'>) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  emailVerified: u.emailVerified,
})

async function sendVerificationEmail(ctx: Ctx, userId: string, email: string): Promise<void> {
  const token = randomToken(32)
  const expires = new Date(ctx.app.now().getTime() + EMAIL_TOKEN_HOURS * 3600_000)
  await ctx.app.db`DELETE FROM email_verification_tokens WHERE user_id = ${userId} AND used_at IS NULL`
  await ctx.app.db`
    INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashOneTimeToken(ctx.app, 'verify-email', token)}, ${expires})`
  await ctx.app.mailer.send({
    to: email,
    kind: 'verify-email',
    token,
    subject: 'Verify your PostcodeProof email',
    text: `Open this link to verify your email address. It expires in ${EMAIL_TOKEN_HOURS} hours.\n/verify-email#${token}`,
  })
}

async function startSession(ctx: Ctx, userId: string): Promise<void> {
  const token = await createSession(ctx.app, userId, ctx.req.headers.get('user-agent'))
  ctx.responseCookies.push(sessionCookie(ctx, token, SESSION_TTL_SECONDS))
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/v1/auth/register', async (ctx) => {
    limit(ctx, 'register', 10, 60 * 60 * 1000)
    const body = await readBody(ctx, registerSchema)
    if (body.role === 'business' && !body.businessName) {
      throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { businessName: 'Enter your business name.' })
    }
    const hash = await hashPassword(body.password)
    const id = crypto.randomUUID()
    const created = await ctx.app.db.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO users (id, email, password_hash, role) VALUES (${id}, ${body.email}, ${hash}, ${body.role})
        ON CONFLICT (email) DO NOTHING RETURNING id`
      if (!rows[0]) return false
      await tx`INSERT INTO user_profiles (user_id, display_name) VALUES (${id}, ${body.displayName})`
      if (body.role === 'business') {
        await tx`INSERT INTO businesses (owner_user_id, name, contact_email) VALUES (${id}, ${body.businessName ?? body.displayName}, ${body.email})`
      }
      return true
    })
    if (!created) throw new HttpError(409, 'email_in_use', 'An account with this email already exists.', { email: 'Already registered.' })
    await startSession(ctx, id)
    await sendVerificationEmail(ctx, id, body.email)
    await audit(ctx.app, id, 'account.registered', { role: body.role }, ctx.ip)
    return json({ user: publicUser({ id, email: body.email, displayName: body.displayName, role: body.role, emailVerified: false }) }, 201)
  })

  router.post('/api/v1/auth/login', async (ctx) => {
    limit(ctx, 'login-ip', 20, 15 * 60 * 1000)
    const body = await readBody(ctx, loginSchema)
    limit(ctx, `login-email:${body.email}`, 10, 15 * 60 * 1000)
    const rows = await ctx.app.db<UserRow[]>`
      SELECT u.id, u.email, u.password_hash, u.role, p.display_name, u.email_verified_at, u.failed_logins, u.locked_until
      FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.email = ${body.email} AND u.status = 'active' LIMIT 1`
    const user = rows[0]
    const now = ctx.app.now()
    if (user?.locked_until && user.locked_until > now) {
      throw new HttpError(429, 'account_locked', 'Too many failed attempts. Try again in a few minutes.')
    }
    const ok = await Bun.password.verify(body.password, user?.password_hash ?? (await getDummyHash()))
    if (!user || !ok) {
      if (user) {
        const lock = user.failed_logins + 1 >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
        await ctx.app.db`UPDATE users SET failed_logins = ${lock ? 0 : user.failed_logins + 1}, locked_until = ${lock} WHERE id = ${user.id}`
        await audit(ctx.app, user.id, lock ? 'auth.account_locked' : 'auth.login_failed', {}, ctx.ip)
        if (lock) await notify.securityAlert(ctx.app, user.id, 'Your account was locked for 15 minutes after repeated failed sign-ins')
      }
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.')
    }
    await ctx.app.db`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`
    await startSession(ctx, user.id)
    await audit(ctx.app, user.id, 'auth.login', {}, ctx.ip)
    return json({
      user: publicUser({
        id: user.id, email: user.email, displayName: user.display_name ?? user.email, role: user.role,
        emailVerified: user.email_verified_at !== null,
      }),
    })
  })

  router.post('/api/v1/auth/logout', async (ctx) => {
    if (ctx.user) {
      await destroySession(ctx.app, ctx.user.sessionId)
      await audit(ctx.app, ctx.user.id, 'auth.logout', {}, ctx.ip)
    }
    ctx.responseCookies.push(`${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
    return json({ ok: true })
  })

  router.post('/api/v1/auth/refresh', async (ctx) => {
    const user = requireUser(ctx)
    limit(ctx, 'refresh', 30, 60 * 60 * 1000, true)
    const token = await refreshSession(ctx.app, user.sessionId)
    ctx.responseCookies.push(sessionCookie(ctx, token, SESSION_TTL_SECONDS))
    return json({ user: publicUser(user) })
  })

  router.get('/api/v1/auth/me', (ctx) => json({ user: ctx.user ? publicUser(ctx.user) : null }))

  router.post('/api/v1/auth/verify-email', async (ctx) => {
    limit(ctx, 'verify-email', 20, 60 * 60 * 1000)
    const body = await readBody(ctx, tokenSchema)
    const rows = await ctx.app.db<{ id: string; user_id: string }[]>`
      UPDATE email_verification_tokens SET used_at = ${ctx.app.now()}
      WHERE token_hash = ${hashOneTimeToken(ctx.app, 'verify-email', body.token)} AND used_at IS NULL AND expires_at > ${ctx.app.now()}
      RETURNING id, user_id`
    const row = rows[0]
    if (!row) throw new HttpError(400, 'invalid_token', 'This link is invalid or has expired.')
    await ctx.app.db`UPDATE users SET email_verified_at = ${ctx.app.now()} WHERE id = ${row.user_id}`
    await audit(ctx.app, row.user_id, 'account.email_verified', {}, ctx.ip)
    return json({ ok: true })
  })

  router.post('/api/v1/auth/resend-verification', async (ctx) => {
    const user = requireUser(ctx)
    limit(ctx, 'resend-verification', 3, 60 * 60 * 1000, true)
    if (!user.emailVerified) await sendVerificationEmail(ctx, user.id, user.email)
    return json({ ok: true })
  })

  // Always answers 200 so the endpoint cannot be used to discover which emails have accounts.
  router.post('/api/v1/auth/forgot-password', async (ctx) => {
    limit(ctx, 'forgot-ip', 10, 60 * 60 * 1000)
    const body = await readBody(ctx, forgotPasswordSchema)
    limit(ctx, `forgot-email:${body.email}`, 3, 60 * 60 * 1000)
    const rows = await ctx.app.db<{ id: string }[]>`SELECT id FROM users WHERE email = ${body.email} AND status = 'active'`
    const user = rows[0]
    if (user) {
      const token = randomToken(32)
      const expires = new Date(ctx.app.now().getTime() + RESET_TOKEN_MINUTES * 60_000)
      await ctx.app.db`DELETE FROM password_reset_tokens WHERE user_id = ${user.id} AND used_at IS NULL`
      await ctx.app.db`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${hashOneTimeToken(ctx.app, 'reset-password', token)}, ${expires})`
      await ctx.app.mailer.send({
        to: body.email,
        kind: 'reset-password',
        token,
        subject: 'Reset your PostcodeProof password',
        text: `Open this link to choose a new password. It expires in ${RESET_TOKEN_MINUTES} minutes.\n/reset-password#${token}`,
      })
      await audit(ctx.app, user.id, 'auth.reset_requested', {}, ctx.ip)
    }
    return json({ ok: true })
  })

  router.post('/api/v1/auth/reset-password', async (ctx) => {
    limit(ctx, 'reset-ip', 10, 60 * 60 * 1000)
    const body = await readBody(ctx, resetPasswordSchema)
    const hash = await hashPassword(body.password)
    const rows = await ctx.app.db<{ user_id: string }[]>`
      UPDATE password_reset_tokens SET used_at = ${ctx.app.now()}
      WHERE token_hash = ${hashOneTimeToken(ctx.app, 'reset-password', body.token)} AND used_at IS NULL AND expires_at > ${ctx.app.now()}
      RETURNING user_id`
    const row = rows[0]
    if (!row) throw new HttpError(400, 'invalid_token', 'This link is invalid or has expired.')
    await ctx.app.db`UPDATE users SET password_hash = ${hash}, failed_logins = 0, locked_until = NULL WHERE id = ${row.user_id}`
    // Recovery ends every session: whoever held the old password or a stolen cookie is signed out.
    await ctx.app.db`DELETE FROM sessions WHERE user_id = ${row.user_id}`
    await audit(ctx.app, row.user_id, 'auth.password_reset', {}, ctx.ip)
    await notify.securityAlert(ctx.app, row.user_id, 'Your password was reset and all sessions were signed out')
    return json({ ok: true })
  })

  router.put('/api/v1/account/profile', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readBody(ctx, profileUpdateSchema)
    await ctx.app.db`
      INSERT INTO user_profiles (user_id, display_name) VALUES (${user.id}, ${body.displayName})
      ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`
    await audit(ctx.app, user.id, 'account.profile_updated', {}, ctx.ip)
    return json({ user: publicUser({ ...user, displayName: body.displayName }) })
  })

  router.post('/api/v1/account/password', async (ctx) => {
    const user = requireUser(ctx)
    limit(ctx, 'password-change', 5, 15 * 60 * 1000, true)
    const body = await readBody(ctx, passwordChangeSchema)
    const rows = await ctx.app.db<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`
    const current = rows[0]
    if (!current || !(await Bun.password.verify(body.currentPassword, current.password_hash))) {
      throw new HttpError(403, 'invalid_credentials', 'Your current password is incorrect.', { currentPassword: 'Incorrect password.' })
    }
    await ctx.app.db`UPDATE users SET password_hash = ${await hashPassword(body.newPassword)} WHERE id = ${user.id}`
    await ctx.app.db`DELETE FROM sessions WHERE user_id = ${user.id} AND id <> ${user.sessionId}`
    await audit(ctx.app, user.id, 'account.password_changed', {}, ctx.ip)
    await notify.securityAlert(ctx.app, user.id, 'Your password was changed and your other sessions were signed out')
    return json({ ok: true })
  })

  router.post('/api/v1/account/delete', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readBody(ctx, z.object({ password: z.string().min(1).max(128) }))
    const rows = await ctx.app.db<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`
    const current = rows[0]
    if (!current || !(await Bun.password.verify(body.password, current.password_hash))) {
      throw new HttpError(403, 'invalid_credentials', 'Your password is incorrect.', { password: 'Incorrect password.' })
    }
    await audit(ctx.app, null, 'account.deleted', { role: user.role })
    await ctx.app.db`DELETE FROM users WHERE id = ${user.id}`
    ctx.responseCookies.push(`${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
    return json({ ok: true })
  })

  router.get('/api/v1/security/sessions', async (ctx) => {
    const user = requireUser(ctx)
    const rows = await ctx.app.db<{ id: string; created_at: Date; last_seen_at: Date; user_agent: string | null }[]>`
      SELECT id, created_at, last_seen_at, user_agent FROM sessions
      WHERE user_id = ${user.id} AND expires_at > ${ctx.app.now()} ORDER BY created_at DESC`
    return json({
      sessions: rows.map((r) => ({
        id: r.id, createdAt: r.created_at, lastSeenAt: r.last_seen_at, userAgent: r.user_agent, current: r.id === user.sessionId,
      })),
    })
  })

  router.delete('/api/v1/security/sessions/:id', async (ctx) => {
    const user = requireUser(ctx)
    const id = z.string().uuid().safeParse(ctx.params.id)
    if (!id.success) throw new HttpError(404, 'not_found', 'Session not found.')
    await ctx.app.db`DELETE FROM sessions WHERE id = ${id.data} AND user_id = ${user.id}`
    await audit(ctx.app, user.id, 'security.session_revoked', {}, ctx.ip)
    return json({ ok: true })
  })

  router.get('/api/v1/security/events', async (ctx) => {
    const user = requireUser(ctx)
    const rows = await ctx.app.db<{ id: string; action: string; created_at: Date }[]>`
      SELECT id::text, action, created_at FROM audit_logs WHERE user_id = ${user.id} ORDER BY id DESC LIMIT 50`
    return json({ events: rows.map((r) => ({ id: r.id, action: r.action, createdAt: r.created_at })) })
  })
}

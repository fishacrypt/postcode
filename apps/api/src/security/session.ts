import { randomToken, sha256Hex } from '@pp/crypto/server'
import type { AppContext, Role, SessionUser } from '../context'

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
export const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

export function hashSessionToken(app: AppContext, token: string): string {
  return sha256Hex(`${app.config.pepper}:session:${token}`)
}

/** One-time tokens (email verification, password reset): only the hash is stored. */
export function hashOneTimeToken(app: AppContext, purpose: string, token: string): string {
  return sha256Hex(`${app.config.pepper}:${purpose}:${token}`)
}

export async function createSession(app: AppContext, userId: string, userAgent: string | null): Promise<string> {
  const token = randomToken(32)
  const expires = new Date(app.now().getTime() + SESSION_TTL_SECONDS * 1000)
  await app.db`
    INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, created_at, last_seen_at)
    VALUES (${userId}, ${hashSessionToken(app, token)}, ${expires}, ${userAgent?.slice(0, 200) ?? null}, ${app.now()}, ${app.now()})`
  return token
}

interface SessionRow {
  session_id: string
  id: string
  email: string
  display_name: string | null
  role: Role
  email_verified_at: Date | null
  last_seen_at: Date
}

export async function loadSession(app: AppContext, token: string): Promise<SessionUser | null> {
  if (token.length < 20 || token.length > 200) return null
  const now = app.now()
  const rows = await app.db<SessionRow[]>`
    SELECT s.id AS session_id, u.id, u.email, p.display_name, u.role, u.email_verified_at, s.last_seen_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.status = 'active'
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE s.token_hash = ${hashSessionToken(app, token)} AND s.expires_at > ${now}
    LIMIT 1`
  const row = rows[0]
  if (!row) return null
  if (now.getTime() - row.last_seen_at.getTime() > IDLE_TIMEOUT_MS) {
    await app.db`DELETE FROM sessions WHERE id = ${row.session_id}`
    return null
  }
  if (now.getTime() - row.last_seen_at.getTime() > 60_000) {
    await app.db`UPDATE sessions SET last_seen_at = ${now} WHERE id = ${row.session_id}`
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? row.email,
    role: row.role,
    emailVerified: row.email_verified_at !== null,
    sessionId: row.session_id,
  }
}

export async function destroySession(app: AppContext, sessionId: string): Promise<void> {
  await app.db`DELETE FROM sessions WHERE id = ${sessionId}`
}

/** Rotates the session token: the old token stops working immediately. */
export async function refreshSession(app: AppContext, sessionId: string): Promise<string> {
  const token = randomToken(32)
  const expires = new Date(app.now().getTime() + SESSION_TTL_SECONDS * 1000)
  await app.db`
    UPDATE sessions SET token_hash = ${hashSessionToken(app, token)}, expires_at = ${expires}, last_seen_at = ${app.now()}
    WHERE id = ${sessionId}`
  return token
}

export function ipHash(app: AppContext, ip: string): string {
  return sha256Hex(`${app.config.pepper}:ip:${ip}`).slice(0, 32)
}

export async function audit(
  app: AppContext,
  userId: string | null,
  action: string,
  meta: Record<string, string | number | boolean | null> = {},
  ip: string | null = null,
): Promise<void> {
  await app.db`
    INSERT INTO audit_logs (user_id, action, meta, ip_hash, actor_role)
    VALUES (${userId}, ${action}, ${JSON.stringify(meta)}::text::jsonb, ${ip ? ipHash(app, ip) : null},
            (SELECT role FROM users WHERE id = ${userId}))`
}

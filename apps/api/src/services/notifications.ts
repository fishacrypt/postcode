import type { AppContext } from '../context'

/**
 * Notification helpers. Messages never contain addresses, tokens other than the one-time link the message exists
 * to deliver, or any claim values. Delivery failures are swallowed on purpose: a mail outage must not block the
 * action that triggered it. They are counted in the audit log instead.
 */
async function safeSend(app: AppContext, userId: string, kind: string, subject: string, text: string): Promise<void> {
  try {
    const rows = await app.db<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`
    const to = rows[0]?.email
    if (!to) return
    await app.mailer.send({ to, kind, subject, text })
  } catch {
    await app.db`INSERT INTO audit_logs (user_id, action, meta) VALUES (${userId}, 'notification.failed', ${JSON.stringify({ kind })}::text::jsonb)`
  }
}

export const notify = {
  credentialIssued: (app: AppContext, userId: string, expiresAt: Date) =>
    safeSend(app, userId, 'credential-issued', 'Your PostcodeProof credential was issued',
      `A new address credential was issued on your account. It expires on ${expiresAt.toISOString().slice(0, 10)}. If this was not you, revoke it and change your password.`),
  credentialRevoked: (app: AppContext, userId: string, by: 'you' | 'an issuer or administrator') =>
    safeSend(app, userId, 'credential-revoked', 'A PostcodeProof credential was revoked',
      `A credential on your account was revoked by ${by}. Verification links for it no longer work.`),
  consentGranted: (app: AppContext, userId: string, business: string, fieldCount: number) =>
    safeSend(app, userId, 'consent-granted', 'You shared address details with a business',
      `You approved ${business} to read ${fieldCount} field(s) of your credential for 24 hours. You can withdraw access under Privacy and consent.`),
  securityAlert: (app: AppContext, userId: string, what: string) =>
    safeSend(app, userId, 'security-alert', 'Security alert for your PostcodeProof account',
      `${what}. If you did not do this, reset your password immediately.`),
}

/** Sends one reminder per credential that expires within `days`. Run daily, for example from cron. */
export async function sendExpiryReminders(app: AppContext, days = 14): Promise<number> {
  const horizon = new Date(app.now().getTime() + days * 86400_000)
  const rows = await app.db<{ id: string; user_id: string; expires_at: Date }[]>`
    UPDATE credentials SET expiry_notified_at = ${app.now()}
    WHERE status = 'active' AND expiry_notified_at IS NULL AND expires_at > ${app.now()} AND expires_at <= ${horizon}
    RETURNING id, user_id, expires_at`
  for (const r of rows) {
    await safeSend(app, r.user_id, 'credential-expiring', 'Your PostcodeProof credential expires soon',
      `A credential on your account expires on ${r.expires_at.toISOString().slice(0, 10)}. Renew it from My Credentials to keep verification links working.`)
  }
  return rows.length
}

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sendExpiryReminders } from '../../apps/api/src/services/notifications'
import { ADDRESS, Client, createTestApp, PASSWORD, registerUser, type TestApp } from '../helpers'

let app: TestApp
let admin: Client
let holder: Client
let issuer: Client
const consent = { accepted: true, statementVersion: '1' }

async function promote(email: string, role: string): Promise<void> {
  await app.db`UPDATE users SET role = ${role} WHERE email = ${email}`
}

beforeAll(async () => {
  app = await createTestApp({ staticProvider: true })
  admin = await registerUser(app, 'admin@example.com')
  await promote('admin@example.com', 'admin')
  issuer = await registerUser(app, 'issuer@example.com')
  await promote('issuer@example.com', 'issuer')
  // Role changes end sessions in the app flow; here we promote directly, so sign in again.
  await admin.post('/api/v1/auth/login', { email: 'admin@example.com', password: PASSWORD })
  await issuer.post('/api/v1/auth/login', { email: 'issuer@example.com', password: PASSWORD })
  holder = await registerUser(app, 'holder@example.com')
})
afterAll(async () => {
  await app.close()
})

describe('administration', () => {
  test('there is no public path to administrator rights', async () => {
    const c = new Client(app)
    const res = await c.post('/api/v1/auth/register', { email: 'sneaky@example.com', password: PASSWORD, displayName: 'S', role: 'admin' })
    expect(res.status).toBe(422)
    expect((await holder.get('/api/v1/admin/health')).status).toBe(403)
    expect((await issuer.get('/api/v1/admin/users')).status).toBe(403)
  })

  test('health reports configuration without exposing secrets', async () => {
    const res = await admin.get<Record<string, unknown>>('/api/v1/admin/health')
    expect(res.status).toBe(200)
    expect(res.body.database).toBe('ok')
    expect(res.body.postcodeDataset).toBe('loaded')
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/private|secret|pepper|0x[0-9a-f]{64}/i)
  })

  test('issuers see credential metadata only and can revoke; holders are notified', async () => {
    const a = await holder.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)
    const c = await holder.post<{ credential: { id: string } }>('/api/v1/credentials', { addressId: a.body.address.id, consent })
    expect(app.mailer.outbox.some((m) => m.to === 'holder@example.com' && m.kind === 'credential-issued')).toBe(true)
    const list = await issuer.get<{ credentials: Record<string, unknown>[] }>('/api/v1/issuer/credentials')
    expect(JSON.stringify(list.body)).not.toContain('Example Street')
    expect((await issuer.post(`/api/v1/issuer/credentials/${c.body.credential.id}/revoke`, { reason: 'test' })).status).toBe(200)
    expect(app.mailer.outbox.some((m) => m.to === 'holder@example.com' && m.kind === 'credential-revoked')).toBe(true)
    const events = await admin.get<{ events: { action: string; actorRole: string | null }[] }>('/api/v1/admin/audit')
    const rev = events.body.events.find((e) => e.action === 'issuer.credential_revoked')
    expect(rev?.actorRole).toBe('issuer')
  })

  test('audit log separates user, business, issuer and admin actors', async () => {
    await admin.post(`/api/v1/admin/users/${(await holder.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id}/status`, { status: 'active' })
    const events = (await admin.get<{ events: { actorRole: string | null }[] }>('/api/v1/admin/audit')).body.events
    const roles = new Set(events.map((e) => e.actorRole))
    expect(roles.has('user')).toBe(true)
    expect(roles.has('admin')).toBe(true)
  })

  test('suspending a business revokes its keys and blocks sign-in access', async () => {
    const biz = await registerUser(app, 'shop@example.com', { role: 'business', businessName: 'Shop' })
    await biz.post('/api/v1/businesses/api-keys', { name: 'k' })
    const list = await admin.get<{ businesses: { id: string; name: string; activeKeys: number }[] }>('/api/v1/admin/businesses')
    const shop = list.body.businesses.find((b) => b.name === 'Shop')
    expect(shop?.activeKeys).toBe(1)
    expect((await admin.post(`/api/v1/admin/businesses/${shop?.id}/status`, { status: 'suspended' })).status).toBe(200)
    const after = await admin.get<{ businesses: { id: string; activeKeys: number }[] }>('/api/v1/admin/businesses')
    expect(after.body.businesses.find((b) => b.id === shop?.id)?.activeKeys).toBe(0)
    expect((await biz.post('/api/v1/businesses/verification-requests', { reference: 'r', purpose: 'p', requestedFields: ['state'] })).status).toBe(403)
  })

  test('suspended users are signed out and cannot sign in', async () => {
    const victim = await registerUser(app, 'victim@example.com')
    const id = (await victim.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id
    await admin.post(`/api/v1/admin/users/${id}/status`, { status: 'suspended' })
    expect((await victim.get<{ user: unknown }>('/api/v1/auth/me')).body.user).toBeNull()
    expect((await new Client(app).post('/api/v1/auth/login', { email: 'victim@example.com', password: PASSWORD })).status).toBe(401)
  })
})

describe('notifications', () => {
  test('expiry reminders are sent once, and never contain address values', async () => {
    const u = await registerUser(app, 'expiring@example.com')
    const a = await u.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)
    await u.post('/api/v1/credentials', { addressId: a.body.address.id, consent })
    app.clock.now = new Date(app.clock.now.getTime() + 355 * 86400_000)
    const ctx = { db: app.db, config: app.config, provider: { id: 'x', isAvailable: () => Promise.resolve(true), lookup: () => Promise.resolve(null) }, limiter: undefined as never, mailer: app.mailer, now: () => app.clock.now }
    expect(await sendExpiryReminders(ctx)).toBeGreaterThanOrEqual(1)
    expect(await sendExpiryReminders(ctx)).toBe(0)
    const mail = app.mailer.outbox.filter((m) => m.to === 'expiring@example.com' && m.kind === 'credential-expiring')
    expect(mail.length).toBe(1)
    expect(JSON.stringify(mail)).not.toContain('Example Street')
  })

  test('password reset mail carries the token but the audit log and database never do', async () => {
    const u = await registerUser(app, 'reset2@example.com')
    await u.post('/api/v1/auth/forgot-password', { email: 'reset2@example.com' })
    const token = app.mailer.outbox.filter((m) => m.kind === 'reset-password').at(-1)?.token ?? ''
    expect(token.length).toBeGreaterThan(20)
    const dump = JSON.stringify(await app.db<unknown[]>`SELECT * FROM audit_logs`) + JSON.stringify(await app.db<unknown[]>`SELECT * FROM password_reset_tokens`)
    expect(dump).not.toContain(token)
  })
})

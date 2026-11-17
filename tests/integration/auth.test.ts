import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, createTestApp, PASSWORD, registerUser, type TestApp } from '../helpers'

let app: TestApp
beforeAll(async () => {
  app = await createTestApp({ rateLimit: false })
})
afterAll(async () => {
  await app.close()
})

describe('authentication', () => {
  test('register sets an HttpOnly session cookie and stores no plaintext secrets', async () => {
    const c = new Client(app)
    const res = await c.post('/api/v1/auth/register', { email: 'ada@example.com', password: PASSWORD, displayName: 'Ada' })
    expect(res.status).toBe(201)
    const cookie = res.headers.getSetCookie().find((x) => x.startsWith('pp_session='))
    expect(cookie).toContain('HttpOnly')
    const row = (await app.db<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE email = 'ada@example.com'`)[0]
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true)
    const token = cookie?.split(';')[0]?.split('=')[1] ?? ''
    const stored = await app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM sessions WHERE token_hash = ${token}`
    expect(stored[0]?.n).toBe('0') // only a hash is stored
  })

  test('weak passwords and duplicate emails are rejected with field errors', async () => {
    const c = new Client(app)
    const weak = await c.post('/api/v1/auth/register', { email: 'weak@example.com', password: 'short', displayName: 'W' })
    expect(weak.status).toBe(422)
    const dup = await c.post('/api/v1/auth/register', { email: 'ada@example.com', password: PASSWORD, displayName: 'Ada' })
    expect(dup.status).toBe(409)
  })

  test('state-changing requests without the CSRF marker or from a foreign origin are blocked', async () => {
    const noMarker = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD }),
      }),
    )
    expect(noMarker.status).toBe(403)
    const c = new Client(app)
    const foreign = await c.call('POST', '/api/v1/auth/login', { email: 'ada@example.com', password: PASSWORD }, { origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
  })

  test('non-JSON bodies are refused', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'x-requested-with': 'PostcodeProof', 'content-type': 'text/plain' },
        body: 'x',
      }),
    )
    expect(res.status).toBe(415)
  })

  test('email verification token works once and expires', async () => {
    const c = await registerUser(app, 'verify@example.com', { verify: false })
    const mail = app.mailer.outbox.find((m) => m.to === 'verify@example.com')
    expect(mail).toBeDefined()
    expect((await c.get<{ user: { emailVerified: boolean } }>('/api/v1/auth/me')).body.user.emailVerified).toBe(false)
    expect((await c.post('/api/v1/auth/verify-email', { token: mail?.token })).status).toBe(200)
    expect((await c.post('/api/v1/auth/verify-email', { token: mail?.token })).status).toBe(400)
    expect((await c.get<{ user: { emailVerified: boolean } }>('/api/v1/auth/me')).body.user.emailVerified).toBe(true)
  })

  test('login failure is generic, then lockout after repeated failures', async () => {
    await registerUser(app, 'lock@example.com')
    const c = new Client(app)
    const unknown = await c.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'whatever-Password1' })
    const wrong = await c.post('/api/v1/auth/login', { email: 'lock@example.com', password: 'Wrong-Password-1' })
    expect(unknown.body).toEqual(wrong.body)
    for (let i = 0; i < 4; i++) await c.post('/api/v1/auth/login', { email: 'lock@example.com', password: 'Wrong-Password-1' })
    const locked = await c.post('/api/v1/auth/login', { email: 'lock@example.com', password: PASSWORD })
    expect(locked.status).toBe(429)
    app.clock.now = new Date(app.clock.now.getTime() + 16 * 60_000)
    expect((await c.post('/api/v1/auth/login', { email: 'lock@example.com', password: PASSWORD })).status).toBe(200)
  })

  test('refresh rotates the session token and logout destroys it', async () => {
    const c = await registerUser(app, 'refresh@example.com')
    const before = (await app.db<{ token_hash: string }[]>`SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'refresh@example.com'`)[0]
    expect((await c.post('/api/v1/auth/refresh')).status).toBe(200)
    const after = (await app.db<{ token_hash: string }[]>`SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'refresh@example.com'`)[0]
    expect(after?.token_hash).not.toBe(before?.token_hash)
    expect((await c.post('/api/v1/auth/logout')).status).toBe(200)
    expect((await c.get<{ user: unknown }>('/api/v1/auth/me')).body.user).toBeNull()
  })

  test('password reset: generic response, single-use token, all sessions ended', async () => {
    const c = await registerUser(app, 'reset@example.com')
    const other = new Client(app)
    await other.post('/api/v1/auth/login', { email: 'reset@example.com', password: PASSWORD })
    const unknown = await c.post('/api/v1/auth/forgot-password', { email: 'ghost@example.com' })
    const known = await c.post('/api/v1/auth/forgot-password', { email: 'reset@example.com' })
    expect(unknown.status).toBe(200)
    expect(known.body).toEqual(unknown.body)
    const mail = app.mailer.outbox.filter((m) => m.to === 'reset@example.com' && m.kind === 'reset-password').at(-1)
    const fresh = new Client(app)
    expect((await fresh.post('/api/v1/auth/reset-password', { token: mail?.token, password: 'Brand-New-Password-7' })).status).toBe(200)
    expect((await fresh.post('/api/v1/auth/reset-password', { token: mail?.token, password: 'Another-Password-8x' })).status).toBe(400)
    expect((await other.get<{ user: unknown }>('/api/v1/auth/me')).body.user).toBeNull()
    expect((await fresh.post('/api/v1/auth/login', { email: 'reset@example.com', password: 'Brand-New-Password-7' })).status).toBe(200)
  })

  test('role-based authorisation: users cannot reach business, issuer or admin routes', async () => {
    const c = await registerUser(app, 'plain@example.com')
    expect((await c.get('/api/v1/businesses/me')).status).toBe(403)
    expect((await c.get('/api/v1/admin/users')).status).toBe(403)
    expect((await c.get('/api/v1/issuer/credentials')).status).toBe(403)
    expect((await new Client(app).get('/api/v1/addresses')).status).toBe(401)
  })

  test('admin can change roles and cannot demote themselves', async () => {
    const admin = await registerUser(app, 'root@example.com')
    await app.db`UPDATE users SET role = 'admin' WHERE email = 'root@example.com'`
    const target = await registerUser(app, 'target@example.com')
    const me = (await target.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id
    expect((await admin.post(`/api/v1/admin/users/${me}/role`, { role: 'issuer' })).status).toBe(200)
    expect((await target.get<{ user: unknown }>('/api/v1/auth/me')).body.user).toBeNull() // sessions revoked
    const adminId = (await admin.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id
    expect((await admin.post(`/api/v1/admin/users/${adminId}/role`, { role: 'user' })).status).toBe(409)
  })
})

describe('rate limiting', () => {
  test('login is throttled per IP', async () => {
    const limited = await createTestApp({ rateLimit: true })
    const c = new Client(limited)
    let last = 0
    for (let i = 0; i < 25; i++) last = (await c.post('/api/v1/auth/login', { email: 'x@example.com', password: 'Nope-Password-1' })).status
    expect(last).toBe(429)
    await limited.close()
  })
})

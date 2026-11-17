import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ADDRESS, Client, createTestApp, registerUser, type TestApp } from '../helpers'

let app: TestApp
let user: Client

beforeAll(async () => {
  app = await createTestApp({ staticProvider: true })
  user = await registerUser(app, 'sec@example.com')
})
afterAll(async () => {
  await app.close()
})

describe('injection and malformed input', () => {
  test('SQL metacharacters are treated as data in every text field', async () => {
    const payload = "x'); DROP TABLE users; --"
    const res = await user.post('/api/v1/addresses', { ...ADDRESS, city: payload, street: payload, district: payload })
    expect(res.status).toBe(201)
    const users = await app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM users`
    expect(Number(users[0]?.n)).toBeGreaterThan(0)
    const login = await new Client(app).post('/api/v1/auth/login', { email: "admin'--@example.com", password: 'whatever-Password1' })
    expect([401, 422]).toContain(login.status)
  })

  test('invalid JSON, wrong types and oversized bodies are rejected without leaking internals', async () => {
    const bad = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'x-requested-with': 'PostcodeProof', 'content-type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(bad.status).toBe(400)
    const typed = await user.post('/api/v1/addresses', { ...ADDRESS, postcode: { $ne: null } })
    expect(typed.status).toBe(422)
    const huge = await user.post('/api/v1/addresses', { ...ADDRESS, additionalInfo: 'a'.repeat(200_000) })
    expect([413, 422]).toContain(huge.status)
  })

  test('malformed identifiers return 404 rather than a server error', async () => {
    expect((await user.get('/api/v1/addresses/not-a-uuid')).status).toBe(404)
    expect((await user.get("/api/v1/credentials/1' OR '1'='1")).status).toBe(404)
  })

  test('server errors never include stack traces or SQL', async () => {
    const res = await new Client(app).get('/api/v1/nope')
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|SELECT|stack/i)
  })
})

describe('transport and header hygiene', () => {
  test('responses are not cacheable, are nosniff and send no CORS grants', async () => {
    const res = await new Client(app).get('/api/v1/auth/me')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('a cross-site preflight gets no permissions', async () => {
    const res = await app.handle(new Request('http://localhost/api/v1/addresses', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('the session cookie is HttpOnly and never readable from script', async () => {
    const res = await new Client(app).call('POST', '/api/v1/auth/login', { email: 'sec@example.com', password: 'Correct-Horse-9-Battery' })
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('pp_session=')) ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/')
  })
})

describe('secrets at rest', () => {
  test('no plaintext tokens, keys or passwords are stored', async () => {
    const c = await registerUser(app, 'store@example.com', { role: 'business', businessName: 'Store Ltd' })
    const key = (await c.post<{ key: string }>('/api/v1/businesses/api-keys', { name: 'k' })).body.key
    const dump = JSON.stringify({
      users: await app.db<unknown[]>`SELECT * FROM users`,
      sessions: await app.db<unknown[]>`SELECT * FROM sessions`,
      keys: await app.db<unknown[]>`SELECT * FROM business_api_keys`,
      evt: await app.db<unknown[]>`SELECT * FROM email_verification_tokens`,
    })
    expect(dump).not.toContain(key)
    expect(dump).not.toContain('Correct-Horse-9-Battery')
    for (const m of app.mailer.outbox) expect(dump).not.toContain(m.token)
  })

  test('audit and verification logs never contain address values', async () => {
    const dump = JSON.stringify({ audit: await app.db<unknown[]>`SELECT * FROM audit_logs`, logs: await app.db<unknown[]>`SELECT * FROM verification_logs` })
    expect(dump).not.toContain('Example Street')
    expect(dump).not.toContain('DROP TABLE')
  })

  test('the registry-facing data model contains no personal fields', async () => {
    const cols = await app.db<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'credential_anchors'`
    const names = cols.map((c) => c.column_name)
    for (const forbidden of ['street', 'postal', 'email', 'phone', 'latitude', 'longitude', 'gps']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false)
    }
  })
})

describe('no unrestricted address lookup', () => {
  test('there is no route that searches addresses by postcode, name or email', async () => {
    for (const path of ['/api/v1/addresses/search?postcode=100001', '/api/v1/lookup?email=sec@example.com', '/api/v1/postcodes/100001/addresses']) {
      const res = await user.get(path)
      expect(res.status).toBe(404)
    }
  })
})

describe('client address handling', () => {
  test('a spoofed X-Forwarded-For header cannot escape the login rate limit', async () => {
    const limited = await createTestApp({ rateLimit: true })
    try {
      let blocked = false
      for (let i = 0; i < 25; i++) {
        const res = await limited.handle(
          new Request('http://localhost/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-requested-with': 'PostcodeProof', 'x-forwarded-for': `198.51.100.${i}` },
            body: JSON.stringify({ email: `nobody${i}@example.com`, password: 'Wrong-Password-1' }),
          }),
        )
        if (res.status === 429) blocked = true
      }
      expect(limited.config.trustProxy).toBe(false)
      expect(blocked).toBe(true)
    } finally {
      await limited.close()
    }
  })
})

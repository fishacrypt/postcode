import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ADDRESS, Client, createTestApp, registerUser, type TestApp } from '../helpers'

let app: TestApp
let holder: Client
let biz: Client
let otherBiz: Client
let credentialId = ''
let apiKey = ''
let requestId = ''
let code = ''

const consent = { accepted: true, statementVersion: '1' }

interface ApiBody {
  request: { id: string; code: string }
  disclosed: { field: string }[]
  status: string
}

async function api(method: string, path: string, body?: unknown, key = apiKey) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  )
  return { status: res.status, body: (await res.json()) as ApiBody }
}

beforeAll(async () => {
  app = await createTestApp({ staticProvider: true })
  holder = await registerUser(app, 'holder@example.com')
  const a = await holder.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)
  const c = await holder.post<{ credential: { id: string } }>('/api/v1/credentials', { addressId: a.body.address.id, consent })
  credentialId = c.body.credential.id
  biz = await registerUser(app, 'ops@shop.example', { role: 'business', businessName: 'Shop Ltd' })
  otherBiz = await registerUser(app, 'ops@other.example', { role: 'business', businessName: 'Other Ltd' })
})
afterAll(async () => {
  await app.close()
})

describe('business accounts and API keys', () => {
  test('a business profile exists and can be updated', async () => {
    const me = await biz.get<{ business: { name: string } }>('/api/v1/businesses/me')
    expect(me.body.business.name).toBe('Shop Ltd')
    expect((await biz.patch('/api/v1/businesses/me', { name: 'Shop Limited', website: 'https://shop.example', contactEmail: 'ops@shop.example' })).status).toBe(200)
  })

  test('holders cannot use business endpoints', async () => {
    expect((await holder.get('/api/v1/businesses/me')).status).toBe(403)
    expect((await holder.post('/api/v1/businesses/api-keys', { name: 'x' })).status).toBe(403)
  })

  test('keys are shown once and stored only as hashes', async () => {
    const res = await biz.post<{ key: string; apiKey: { id: string } }>('/api/v1/businesses/api-keys', { name: 'Checkout', scopes: ['verification:create', 'verification:read'] })
    expect(res.status).toBe(201)
    apiKey = res.body.key
    expect(apiKey.startsWith('pp_live_')).toBe(true)
    const rows = await app.db<{ key_hash: string; prefix: string }[]>`SELECT key_hash, prefix FROM business_api_keys`
    expect(rows.some((r) => r.key_hash.includes(apiKey))).toBe(false)
    const list = JSON.stringify((await biz.get('/api/v1/businesses/api-keys')).body)
    expect(list).not.toContain(apiKey)
  })

  test('invalid keys are rejected and scopes are enforced', async () => {
    expect((await api('GET', '/api/v1/businesses/verification-requests', undefined, 'pp_live_' + 'x'.repeat(43))).status).toBe(401)
    const narrow = await biz.post<{ key: string }>('/api/v1/businesses/api-keys', { name: 'Read only', scopes: ['verification:read'] })
    const denied = await api('POST', '/api/v1/businesses/verification-requests', { reference: 'o-1', purpose: 'Delivery check', requestedFields: ['state'] }, narrow.body.key)
    expect(denied.status).toBe(403)
  })
})

describe('consent-based verification', () => {
  test('a business creates a request through the API', async () => {
    const res = await api('POST', '/api/v1/businesses/verification-requests', { reference: 'order-1001', purpose: 'Confirm delivery area', requestedFields: ['state', 'lga', 'postcode'] })
    expect(res.status).toBe(201)
    requestId = res.body.request.id
    code = res.body.request.code
    const stored = await app.db<{ code_hash: string }[]>`SELECT code_hash FROM verification_requests`
    expect(JSON.stringify(stored)).not.toContain(code)
  })

  test('nothing is disclosed before the holder consents', async () => {
    const res = await api('POST', '/api/v1/verify/disclosure', { requestId })
    expect(res.status).toBe(404)
  })

  test('the holder sees what is requested, and cannot share more than was asked', async () => {
    const preview = await holder.post<{ request: { business: string; requestedFields: { field: string }[] } }>('/api/v1/verify/requests/preview', { code })
    expect(preview.body.request.business).toBe('Shop Limited')
    expect(preview.body.request.requestedFields.map((f) => f.field)).toEqual(['state', 'lga', 'postcode'])
    const tooMuch = await holder.post('/api/v1/verify/consent', { code, approve: true, fields: ['state', 'street'], credentialId, acknowledgeSensitive: true })
    expect(tooMuch.status).toBe(422)
  })

  test('the holder can narrow the disclosure, and the business receives only that', async () => {
    const ok = await holder.post('/api/v1/verify/consent', { code, approve: true, fields: ['state', 'lga'], credentialId })
    expect(ok.status).toBe(200)
    const res = await api('POST', '/api/v1/verify/disclosure', { requestId })
    expect(res.status).toBe(200)
    expect(res.body.disclosed.map((d) => d.field).sort()).toEqual(['lga', 'state'])
    expect(JSON.stringify(res.body)).not.toContain('Example Street')
    expect(res.body.status).toBe('valid')
    expect((await holder.post('/api/v1/verify/consent', { code, approve: true, fields: ['state'], credentialId })).status).toBe(404) // code is single use
  })

  test('another business cannot read the disclosure', async () => {
    const k = await otherBiz.post<{ key: string }>('/api/v1/businesses/api-keys', { name: 'Other', scopes: ['verification:read'] })
    expect((await api('POST', '/api/v1/verify/disclosure', { requestId }, k.body.key)).status).toBe(404)
  })

  test('the holder sees who checked, and the business sees its history without addresses', async () => {
    const mine = JSON.stringify((await holder.get('/api/v1/verification-history')).body)
    expect(mine).toContain('Shop Limited')
    expect(mine).not.toContain('Example Street')
    const consents = JSON.stringify((await holder.get('/api/v1/consents')).body)
    expect(consents).toContain('Confirm delivery area')
  })

  test('revoking the credential closes disclosure', async () => {
    await holder.post(`/api/v1/credentials/${credentialId}/revoke`, {})
    const res = await api('POST', '/api/v1/verify/disclosure', { requestId })
    expect(res.status).toBe(410)
  })

  test('declined requests share nothing', async () => {
    const r = await api('POST', '/api/v1/businesses/verification-requests', { reference: 'order-1002', purpose: 'Address check', requestedFields: ['state'] })
    expect((await holder.post('/api/v1/verify/consent', { code: r.body.request.code, approve: false, fields: [] })).status).toBe(200)
    expect((await api('POST', '/api/v1/verify/disclosure', { requestId: r.body.request.id })).status).toBe(404)
  })

  test('revoked keys stop working and usage is recorded', async () => {
    const usage = await biz.get<{ keys: { calls30d: number }[] }>('/api/v1/businesses/usage')
    expect(usage.body.keys.some((k) => k.calls30d > 0)).toBe(true)
    const keys = (await biz.get<{ apiKeys: { id: string; name: string }[] }>('/api/v1/businesses/api-keys')).body.apiKeys
    const id = keys.find((k) => k.name === 'Checkout')?.id
    expect((await biz.del(`/api/v1/businesses/api-keys/${id}`)).status).toBe(200)
    expect((await api('GET', '/api/v1/businesses/verification-requests')).status).toBe(401)
    expect((await otherBiz.del(`/api/v1/businesses/api-keys/${id}`)).status).toBe(404)
  })

  test('API keys require a verified email to create', async () => {
    const fresh = await registerUser(app, 'new@shop.example', { role: 'business', businessName: 'New Ltd', verify: false })
    expect((await fresh.post('/api/v1/businesses/api-keys', { name: 'x' })).status).toBe(403)
  })
})

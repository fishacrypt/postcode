import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { recoverTypedDataAddress, type Hex } from 'viem'
import { ADDRESS, Client, createTestApp, PASSWORD, registerUser, type TestApp } from '../helpers'

let app: TestApp
let alice: Client
let bob: Client
let addressId: string
let credentialId: string

interface AddressRes { address: { id: string; assuranceLevel: number; validation: { dataset: { status: string }; proofOfResidence: string } } }
interface CredRes { credential: { id: string; status: string; renewable: boolean; assurance: { level: number; proofOfResidence: string } }; document: { commitments: Record<string, string> }; signature: string }
interface LinkRes { link: { id: string; token: string; path: string } }
interface VerifyRes { status: string; disclosed: { field: string; value: string }[]; assurance: { level: number }; notice: string }

const consent = { accepted: true, statementVersion: '1' }

beforeAll(async () => {
  app = await createTestApp({ staticProvider: true, registry: true })
  alice = await registerUser(app, 'alice@example.com')
  bob = await registerUser(app, 'bob@example.com')
})
afterAll(async () => {
  await app.close()
})

describe('addresses', () => {
  test('creating an address validates in layers and never claims residence', async () => {
    const res = await alice.post<AddressRes>('/api/v1/addresses', ADDRESS)
    expect(res.status).toBe(201)
    addressId = res.body.address.id
    expect(res.body.address.validation.dataset.status).toBe('matched')
    expect(res.body.address.assuranceLevel).toBe(2)
    expect(res.body.address.validation.proofOfResidence).toBe('not_established')
  })

  test('sensitive fields are encrypted at rest', async () => {
    const row = (await app.db<{ sensitive_blob: Uint8Array }[]>`SELECT sensitive_blob FROM addresses WHERE id = ${addressId}`)[0]
    expect(Buffer.from(row?.sensitive_blob ?? []).includes(Buffer.from('Example Street'))).toBe(false)
  })

  test('an LGA from another state and malformed postcodes are rejected', async () => {
    expect((await alice.post('/api/v1/addresses', { ...ADDRESS, lga: 'Aba North' })).status).toBe(422)
    expect((await alice.post('/api/v1/addresses', { ...ADDRESS, postcode: '12345' })).status).toBe(422)
  })

  test('another user cannot read, change, validate or delete the address', async () => {
    expect((await bob.get(`/api/v1/addresses/${addressId}`)).status).toBe(404)
    expect((await bob.patch(`/api/v1/addresses/${addressId}`, ADDRESS)).status).toBe(404)
    expect((await bob.post(`/api/v1/addresses/${addressId}/validate`)).status).toBe(404)
    expect((await bob.del(`/api/v1/addresses/${addressId}`)).status).toBe(404)
    expect(((await bob.get<{ addresses: unknown[] }>('/api/v1/addresses')).body.addresses).length).toBe(0)
  })

  test('a recent accurate GPS fix lifts assurance to level 3; a stale one does not', async () => {
    const fix = { latitude: 6.6, longitude: 3.35, accuracyMeters: 20, capturedAt: app.clock.now.toISOString() }
    const ok = await alice.post<{ validation: { assuranceLevel: number } }>(`/api/v1/addresses/${addressId}/gps-confirmation`, { gps: fix })
    expect(ok.body.validation.assuranceLevel).toBe(3)
    const stale = await alice.post<{ validation: { assuranceLevel: number } }>(`/api/v1/addresses/${addressId}/gps-confirmation`, {
      gps: { ...fix, capturedAt: new Date(app.clock.now.getTime() - 3600_000).toISOString() },
    })
    expect(stale.body.validation.assuranceLevel).toBe(2)
    const abroad = await alice.post<{ validation: { assuranceLevel: number } }>(`/api/v1/addresses/${addressId}/gps-confirmation`, {
      gps: { ...fix, latitude: 51.5, longitude: -0.1 },
    })
    expect(abroad.body.validation.assuranceLevel).toBe(2)
  })
})

describe('credential issuance', () => {
  test('requires a verified email and explicit consent', async () => {
    const unverified = await registerUser(app, 'unverified@example.com', { verify: false })
    const a = await unverified.post<AddressRes>('/api/v1/addresses', ADDRESS)
    expect((await unverified.post('/api/v1/credentials', { addressId: a.body.address.id, consent })).status).toBe(403)
    expect((await alice.post('/api/v1/credentials', { addressId, consent: { accepted: false, statementVersion: '1' } })).status).toBe(422)
  })

  test('issues a signed credential that commits to claims without exposing them', async () => {
    const res = await alice.post<CredRes>('/api/v1/credentials', { addressId, consent })
    expect(res.status).toBe(201)
    credentialId = res.body.credential.id
    expect(res.body.credential.assurance.proofOfResidence).toBe('not_established')
    const full = await alice.get<CredRes>(`/api/v1/credentials/${credentialId}`)
    expect(JSON.stringify(full.body.document)).not.toContain('Example Street')
    expect(Object.keys(full.body.document.commitments)).toContain('street')
    expect((await alice.post('/api/v1/credentials', { addressId, consent })).status).toBe(409)
  })

  test("another user cannot see or revoke someone else's credential", async () => {
    expect((await bob.get(`/api/v1/credentials/${credentialId}`)).status).toBe(404)
    expect((await bob.post(`/api/v1/credentials/${credentialId}/revoke`, {})).status).toBe(404)
    expect((await bob.post(`/api/v1/credentials/${credentialId}/links`, { fields: ['state'] })).status).toBe(404)
  })

  test('an address with an active credential cannot be deleted', async () => {
    expect((await alice.del(`/api/v1/addresses/${addressId}`)).status).toBe(409)
  })
})

describe('verification links', () => {
  let token = ''
  test('a link discloses only the chosen fields and never the street', async () => {
    const link = await alice.post<LinkRes>(`/api/v1/credentials/${credentialId}/links`, { fields: ['country', 'state'], expiresInHours: 1 })
    expect(link.status).toBe(201)
    expect(link.body.link.path).toBe(`/verify#${link.body.link.token}`)
    token = link.body.link.token
    const stored = await app.db<{ token_hash: string }[]>`SELECT token_hash FROM verification_tokens`
    expect(stored.some((r) => r.token_hash === token)).toBe(false)
    const res = await new Client(app).post<VerifyRes>('/api/v1/verify/link', { token })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('valid')
    expect(res.body.disclosed.map((d) => d.field).sort()).toEqual(['country', 'state'])
    expect(JSON.stringify(res.body)).not.toContain('Example Street')
    expect(res.body.notice).toContain('does not prove')
  })

  test('street-level fields need explicit acknowledgement', async () => {
    const no = await alice.post(`/api/v1/credentials/${credentialId}/links`, { fields: ['street'] })
    expect(no.status).toBe(422)
    const yes = await alice.post<LinkRes>(`/api/v1/credentials/${credentialId}/links`, { fields: ['street'], acknowledgeSensitive: true })
    expect(yes.status).toBe(201)
  })

  test('unknown tokens get the same generic answer as expired ones', async () => {
    const unknown = await new Client(app).post('/api/v1/verify/link', { token: 'x'.repeat(43) })
    expect(unknown.status).toBe(404)
    const short = await alice.post<LinkRes>(`/api/v1/credentials/${credentialId}/links`, { fields: ['state'], expiresInHours: 1 })
    app.clock.now = new Date(app.clock.now.getTime() + 2 * 3600_000)
    const expired = await new Client(app).post('/api/v1/verify/link', { token: short.body.link.token })
    expect(expired.status).toBe(404)
    expect(expired.body).toEqual(unknown.body)
    app.clock.now = new Date(app.clock.now.getTime() - 2 * 3600_000)
  })

  test('single-use links stop working after the allowed uses (replay control)', async () => {
    const once = await alice.post<LinkRes>(`/api/v1/credentials/${credentialId}/links`, { fields: ['state'], maxUses: 1 })
    expect((await new Client(app).post('/api/v1/verify/link', { token: once.body.link.token })).status).toBe(200)
    expect((await new Client(app).post('/api/v1/verify/link', { token: once.body.link.token })).status).toBe(404)
  })

  test('holder can revoke a link, and verification is logged without addresses', async () => {
    const l = await alice.post<LinkRes>(`/api/v1/credentials/${credentialId}/links`, { fields: ['state'] })
    expect((await alice.del(`/api/v1/links/${l.body.link.id}`)).status).toBe(200)
    expect((await new Client(app).post('/api/v1/verify/link', { token: l.body.link.token })).status).toBe(404)
    const logs = JSON.stringify(await app.db`SELECT * FROM verification_logs`)
    expect(logs).not.toContain('Example Street')
    expect(logs).not.toContain(token)
  })

  test('presentations verify offline and detect tampering', async () => {
    const pres = (await alice.get<{ document: Record<string, unknown>; signature: string; disclosures: { field: string; value: string; salt: string }[] }>(
      `/api/v1/credentials/${credentialId}/presentation?fields=state,lga`,
    )).body
    const ok = await new Client(app).post<VerifyRes & { checks: { disclosuresMatch: boolean } }>('/api/v1/verify/credential', pres)
    expect(ok.body.status).toBe('valid')
    expect(ok.body.checks.disclosuresMatch).toBe(true)
    const forged = structuredClone(pres)
    if (forged.disclosures[0]) forged.disclosures[0].value = 'Kano'
    const bad = await new Client(app).post<{ disclosed: unknown[]; checks: { disclosuresMatch: boolean } }>('/api/v1/verify/credential', forged)
    expect(bad.body.checks.disclosuresMatch).toBe(false)
    expect(bad.body.disclosed.length).toBe(1)
    const tampered = structuredClone(pres)
    ;(tampered.document as { expiresAt: string }).expiresAt = '2099-01-01T00:00:00.000Z'
    const t = await new Client(app).post<{ status: string }>('/api/v1/verify/credential', tampered)
    expect(t.body.status).toBe('invalid')
  })
})

describe('anchoring', () => {
  test('returns an EIP-712 attestation bound to chain, registry, holder and credential', async () => {
    const holder = '0x1111111111111111111111111111111111111111'
    const res = await alice.post<{ attestation: { registry: Hex; chainId: number; credentialId: Hex; commitment: Hex; expiresAt: string; deadline: string; signature: Hex } }>(
      `/api/v1/credentials/${credentialId}/anchor`,
      { holder },
    )
    expect(res.status).toBe(200)
    const a = res.body.attestation
    const signer = await recoverTypedDataAddress({
      domain: { name: 'PostcodeProof Credential Registry', version: '1', chainId: a.chainId, verifyingContract: a.registry },
      types: {
        Attestation: [
          { name: 'credentialId', type: 'bytes32' },
          { name: 'commitment', type: 'bytes32' },
          { name: 'holder', type: 'address' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'deadline', type: 'uint64' },
        ],
      },
      primaryType: 'Attestation',
      message: { credentialId: a.credentialId, commitment: a.commitment, holder, expiresAt: BigInt(a.expiresAt), deadline: BigInt(a.deadline) },
      signature: a.signature,
    })
    expect(signer.toLowerCase()).toBe(app.config.signer.address.toLowerCase())
    // A different holder recovers a different signer, so the signature cannot be reused by another wallet.
    const other = await recoverTypedDataAddress({
      domain: { name: 'PostcodeProof Credential Registry', version: '1', chainId: a.chainId, verifyingContract: a.registry },
      types: { Attestation: [
        { name: 'credentialId', type: 'bytes32' }, { name: 'commitment', type: 'bytes32' }, { name: 'holder', type: 'address' },
        { name: 'expiresAt', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
      ] },
      primaryType: 'Attestation',
      message: { credentialId: a.credentialId, commitment: a.commitment, holder: '0x2222222222222222222222222222222222222222', expiresAt: BigInt(a.expiresAt), deadline: BigInt(a.deadline) },
      signature: a.signature,
    })
    expect(other.toLowerCase()).not.toBe(signer.toLowerCase())
  })

  test('is unavailable until a registry address is configured', async () => {
    const bare = await createTestApp({ staticProvider: true })
    const c = await registerUser(bare, 'bare@example.com')
    const a = await c.post<AddressRes>('/api/v1/addresses', ADDRESS)
    const cr = await c.post<CredRes>('/api/v1/credentials', { addressId: a.body.address.id, consent })
    expect((await c.post(`/api/v1/credentials/${cr.body.credential.id}/anchor`, { holder: '0x1111111111111111111111111111111111111111' })).status).toBe(503)
    await bare.close()
    app = await createTestApp({ staticProvider: true, registry: true }) // restore for remaining tests
    alice = await registerUser(app, 'alice@example.com')
    const a2 = await alice.post<AddressRes>('/api/v1/addresses', ADDRESS)
    addressId = a2.body.address.id
    credentialId = (await alice.post<CredRes>('/api/v1/credentials', { addressId, consent })).body.credential.id
  })
})

describe('lifecycle', () => {
  test('revoked credentials fail verification and links stop working', async () => {
    const link = await alice.post<LinkRes>(`/api/v1/credentials/${credentialId}/links`, { fields: ['state'] })
    expect((await alice.post(`/api/v1/credentials/${credentialId}/revoke`, { reason: 'test' })).status).toBe(200)
    expect((await new Client(app).post('/api/v1/verify/link', { token: link.body.link.token })).status).toBe(404)
    expect((await alice.post(`/api/v1/credentials/${credentialId}/revoke`, {})).status).toBe(409)
    expect((await alice.post(`/api/v1/credentials/${credentialId}/anchor`, { holder: '0x1111111111111111111111111111111111111111' })).status).toBe(409)
  })

  test('expired credentials are not valid and become renewable', async () => {
    const a = await alice.post<AddressRes>('/api/v1/addresses', { ...ADDRESS, street: '5 Other Road' })
    const cr = await alice.post<CredRes>('/api/v1/credentials', { addressId: a.body.address.id, consent })
    const link = await alice.post<LinkRes>(`/api/v1/credentials/${cr.body.credential.id}/links`, { fields: ['state'], expiresInHours: 700 })
    expect(cr.body.credential.renewable).toBe(false)
    app.clock.now = new Date(app.clock.now.getTime() + 366 * 86400_000)
    await alice.post('/api/v1/auth/login', { email: 'alice@example.com', password: PASSWORD }) // the old session has expired too
    const got = await alice.get<CredRes>(`/api/v1/credentials/${cr.body.credential.id}`)
    expect(got.body.credential.status).toBe('expired')
    expect(got.body.credential.renewable).toBe(true)
    const stale = await new Client(app).post('/api/v1/verify/link', { token: link.body.link.token })
    expect(stale.status).toBe(404)
    const renewed = await alice.post<CredRes>(`/api/v1/credentials/${cr.body.credential.id}/renew`)
    expect(renewed.status).toBe(201)
    expect(renewed.body.credential.status).toBe('active')
  })

  test('deleting an address wipes encrypted claim values from non-active credentials', async () => {
    // credentialId was revoked above and its address has no other active credential.
    expect((await alice.del(`/api/v1/addresses/${addressId}`)).status).toBe(200)
    const after = await app.db<{ claims_blob: unknown; status: string }[]>`SELECT claims_blob, status FROM credentials WHERE id = ${credentialId}`
    expect(after[0]?.status).toBe('revoked')
    expect(after[0]?.claims_blob).toBeNull()
  })
})

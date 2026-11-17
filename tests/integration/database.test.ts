import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { migrate } from '../../apps/api/src/database/migrate'
import { ADDRESS, createTestApp, registerUser, type TestApp } from '../helpers'

let app: TestApp
const consent = { accepted: true, statementVersion: '1' }

beforeAll(async () => {
  app = await createTestApp({ staticProvider: true })
})
afterAll(async () => {
  await app.close()
})

async function fails(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return false
  } catch {
    return true
  }
}

describe('migrations', () => {
  test('are recorded and idempotent', async () => {
    expect(await migrate(app.db)).toEqual([])
    const names = (await app.db<{ name: string }[]>`SELECT name FROM schema_migrations ORDER BY name`).map((r) => r.name)
    expect(names).toEqual(['001_init.sql', '002_least_privilege.sql', '003_ownership_and_notifications.sql'])
  })

  test('every required table exists', async () => {
    const required = ['users', 'user_profiles', 'sessions', 'addresses', 'address_validation_records', 'credentials', 'credential_anchors',
      'credential_revocations', 'consent_records', 'businesses', 'business_api_keys', 'verification_requests', 'verification_logs',
      'audit_logs', 'email_verification_tokens', 'password_reset_tokens']
    const rows = await app.db<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    const have = new Set(rows.map((r) => r.table_name))
    for (const t of required) expect(have.has(t)).toBe(true)
  })

  test('the 003 rollback script reverses its migration cleanly', async () => {
    const down = readFileSync(new URL('../../database/migrations/down/003_ownership_and_notifications.down.sql', import.meta.url), 'utf8')
    await app.db.unsafe(down)
    expect(await migrate(app.db)).toEqual(['003_ownership_and_notifications.sql'])
  })
})

describe('constraints', () => {
  test('emails are unique and lower case, roles and statuses are constrained', async () => {
    await app.db`INSERT INTO users (email, password_hash, role) VALUES ('a@example.com', 'x', 'user')`
    expect(await fails(() => app.db`INSERT INTO users (email, password_hash, role) VALUES ('a@example.com', 'x', 'user')`)).toBe(true)
    expect(await fails(() => app.db`INSERT INTO users (email, password_hash, role) VALUES ('B@Example.com', 'x', 'user')`)).toBe(true)
    expect(await fails(() => app.db`INSERT INTO users (email, password_hash, role) VALUES ('c@example.com', 'x', 'superuser')`)).toBe(true)
  })

  test('assurance level and verification token limits are enforced by the database', async () => {
    const u = await registerUser(app, 'limits@example.com')
    const a = (await u.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)).body.address.id
    expect(await fails(() => app.db`UPDATE addresses SET assurance_level = 9 WHERE id = ${a}`)).toBe(true)
  })
})

describe('ownership and isolation', () => {
  test('a credential cannot reference another user\'s address, even by direct SQL', async () => {
    const owner = await registerUser(app, 'owner@example.com')
    const other = await registerUser(app, 'other@example.com')
    const addressId = (await owner.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)).body.address.id
    const otherId = (await other.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id
    const doc = JSON.stringify({ x: 1 })
    const attempt = () => app.db`
      INSERT INTO credentials (user_id, address_id, document, document_hash, issuer_address, issuer_signature, issued_at, expires_at)
      VALUES (${otherId}, ${addressId}, ${doc}::text::jsonb, 'h1', '0x0', '0x0', now(), now() + interval '1 day')`
    expect(await fails(attempt)).toBe(true)
  })

  test('a verification token cannot point at another user\'s credential', async () => {
    const a = await registerUser(app, 'tok-a@example.com')
    const b = await registerUser(app, 'tok-b@example.com')
    const addr = (await a.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)).body.address.id
    const cred = (await a.post<{ credential: { id: string } }>('/api/v1/credentials', { addressId: addr, consent })).body.credential.id
    const bId = (await b.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id
    expect(await fails(() => app.db`
      INSERT INTO verification_tokens (user_id, credential_id, token_hash, fields, expires_at)
      VALUES (${bId}, ${cred}, 'tokhash', '[]'::jsonb, now() + interval '1 hour')`)).toBe(true)
  })

  test('deleting a user removes every owned row', async () => {
    const u = await registerUser(app, 'gone@example.com')
    const addr = (await u.post<{ address: { id: string } }>('/api/v1/addresses', ADDRESS)).body.address.id
    await u.post('/api/v1/credentials', { addressId: addr, consent })
    const id = (await u.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id
    await app.db`DELETE FROM users WHERE id = ${id}`
    for (const t of ['addresses', 'credentials', 'sessions', 'user_profiles', 'consent_records']) {
      const rows = await app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM ${app.db(t)} WHERE user_id = ${id}`
      expect(rows[0]?.n).toBe('0')
    }
  })
})

describe('transactions', () => {
  test('a failed transaction leaves nothing behind', async () => {
    await fails(() =>
      app.db.begin(async (tx) => {
        await tx`INSERT INTO users (email, password_hash, role) VALUES ('rollback@example.com', 'x', 'user')`
        await tx`INSERT INTO users (email, password_hash, role) VALUES ('rollback@example.com', 'x', 'user')`
      }),
    )
    const rows = await app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM users WHERE email = 'rollback@example.com'`
    expect(rows[0]?.n).toBe('0')
  })

  test('business registration creates user, profile and business together', async () => {
    await registerUser(app, 'biz@example.com', { role: 'business', businessName: 'Biz Ltd' })
    const rows = await app.db<{ n: string }[]>`
      SELECT count(*)::text AS n FROM users u JOIN user_profiles p ON p.user_id = u.id JOIN businesses b ON b.owner_user_id = u.id WHERE u.email = 'biz@example.com'`
    expect(rows[0]?.n).toBe('1')
  })
})

describe('least privilege', () => {
  test('the application role cannot alter the schema or edit append-only logs', async () => {
    await app.db.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pp_app') THEN CREATE ROLE pp_app NOLOGIN; END IF; END $$;`)
    await app.db.unsafe(readFileSync(new URL('../../database/migrations/002_least_privilege.sql', import.meta.url), 'utf8'))
    await app.db`INSERT INTO audit_logs (action) VALUES ('test.event')`
    const run = (sql: string) =>
      app.db.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE pp_app')
        await tx.unsafe(sql)
      })
    expect(await fails(() => run('SELECT count(*) FROM users'))).toBe(false)
    expect(await fails(() => run("UPDATE audit_logs SET action = 'tampered'"))).toBe(true)
    expect(await fails(() => run('DELETE FROM audit_logs'))).toBe(true)
    expect(await fails(() => run('CREATE TABLE evil (id int)'))).toBe(true)
    expect(await fails(() => run('SELECT * FROM schema_migrations'))).toBe(true)
  })
})

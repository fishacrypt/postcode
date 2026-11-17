import { readFileSync } from 'node:fs'
import { generatePrivateKey } from 'viem/accounts'
import type { PostcodeProvider, PostcodeRecord } from '@pp/address'
import { createHandler } from '../apps/api/src/app'
import { loadConfig, type Config } from '../apps/api/src/config'
import { createDb, type Db } from '../apps/api/src/database/db'
import { migrate } from '../apps/api/src/database/migrate'
import { RateLimiter } from '../apps/api/src/security/ratelimit'
import { DevMailer } from '../apps/api/src/services/mailer'
import { DbPostcodeProvider } from '../apps/api/src/postcodes/provider'

/** TEST FIXTURE ONLY. These rows are invented for tests and never loaded into a real database. */
export const FIXTURE_RECORDS: Record<string, PostcodeRecord> = {
  '100001': { postcode: '100001', state: 'Lagos', lga: 'Ikeja', area: 'Fixture area', sourceId: 'test-fixture' },
}

export class StaticProvider implements PostcodeProvider {
  readonly id = 'static-fixture'
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }
  lookup(_c: string, postcode: string): Promise<PostcodeRecord | null> {
    return Promise.resolve(FIXTURE_RECORDS[postcode] ?? null)
  }
}

function envFromDotenv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m?.[1]) out[m[1]] = m[2] ?? ''
    }
  } catch {
    // CI supplies the variables directly.
  }
  return out
}

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postcodeproof_test'

export interface TestApp {
  db: Db
  config: Config
  mailer: DevMailer
  clock: { now: Date }
  handle: (req: Request, ip?: string) => Promise<Response>
  close: () => Promise<void>
}

export async function createTestApp(opts: { staticProvider?: boolean; rateLimit?: boolean; registry?: boolean } = {}): Promise<TestApp> {
  const base = { ...envFromDotenv(), ...process.env } as Record<string, string | undefined>
  const config = loadConfig({
    ...base,
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    ISSUER_PRIVATE_KEY: generatePrivateKey(),
    VITE_REGISTRY_ADDRESS: opts.registry ? '0x00000000000000000000000000000000000000aa' : '',
    ANCHOR_CHAIN_ID: '5042002',
    ALLOWED_ORIGINS: 'https://app.test',
  })
  const db = createDb(TEST_DB_URL)
  await db.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate(db)
  const mailer = new DevMailer()
  const clock = { now: new Date('2026-11-17T10:00:00Z') }
  const handle = createHandler({
    db,
    config,
    provider: opts.staticProvider ? new StaticProvider() : new DbPostcodeProvider(db),
    limiter: new RateLimiter(opts.rateLimit ?? false),
    mailer,
    now: () => clock.now,
  })
  return { db, config, mailer, clock, handle: (req, ip) => handle(req, ip ?? '203.0.113.7'), close: () => db.close() }
}

/** A tiny cookie-jar client that sends the CSRF marker like the web app does. */
export class Client {
  private cookie = ''
  constructor(private readonly app: TestApp, private readonly ip = '203.0.113.7') {}

  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const h: Record<string, string> = { 'x-requested-with': 'PostcodeProof', origin: 'https://app.test', ...headers }
    if (body !== undefined) h['content-type'] = 'application/json'
    if (this.cookie) h.cookie = this.cookie
    const res = await this.app.handle(
      new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
      this.ip,
    )
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('pp_session='))
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? ''
      this.cookie = pair.endsWith('=') ? '' : pair
    }
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as T, headers: res.headers }
  }
  get = <T = Record<string, unknown>>(path: string) => this.call<T>('GET', path)
  post = <T = Record<string, unknown>>(path: string, body?: unknown) => this.call<T>('POST', path, body ?? {})
  patch = <T = Record<string, unknown>>(path: string, body: unknown) => this.call<T>('PATCH', path, body)
  del = <T = Record<string, unknown>>(path: string) => this.call<T>('DELETE', path)
}

export const PASSWORD = 'Correct-Horse-9-Battery'

export async function registerUser(
  app: TestApp,
  email: string,
  opts: { role?: 'user' | 'business'; verify?: boolean; businessName?: string } = {},
): Promise<Client> {
  const c = new Client(app)
  const res = await c.post('/api/v1/auth/register', {
    email,
    password: PASSWORD,
    displayName: 'Test Person',
    role: opts.role ?? 'user',
    businessName: opts.businessName,
  })
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`)
  if (opts.verify !== false) {
    const mail = app.mailer.outbox.filter((m) => m.to === email && m.kind === 'verify-email').at(-1)
    if (!mail) throw new Error('no verification email')
    await c.post('/api/v1/auth/verify-email', { token: mail.token })
  }
  return c
}

export const ADDRESS = {
  country: 'NG',
  state: 'Lagos',
  lga: 'Ikeja',
  city: 'Ikeja',
  district: 'Fixture district',
  street: '12 Example Street',
  buildingNumber: '12',
  postcode: '100001',
}

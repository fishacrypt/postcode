import { z } from 'zod'
import { EnvKeyring, type KeyProvider } from '@pp/crypto/server'
import { LocalKeySigner, type IssuerSigner } from './security/signer'

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  /** Versioned keys: "1:<64 hex>,2:<64 hex>". Takes precedence over APP_ENCRYPTION_KEY. */
  APP_ENCRYPTION_KEYS: z.string().optional(),
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters').optional(),
  APP_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(255).optional(),
  APP_HASH_PEPPER: z.string().min(32, 'APP_HASH_PEPPER must be at least 32 characters'),
  ISSUER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'ISSUER_PRIVATE_KEY must be a 0x-prefixed 32-byte key'),
  ALLOWED_ORIGINS: z.string().default(''),
  SESSION_COOKIE_MODE: z.enum(['standard', 'embedded']).optional(),
  VITE_REGISTRY_ADDRESS: addr.optional().or(z.literal('')),
  ANCHOR_CHAIN_ID: z.coerce.number().int().default(5042002),
  MAILER: z.enum(['dev', 'webhook', 'resend']).optional(),
  MAIL_WEBHOOK_URL: z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional()
),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().default('onboarding@resend.dev'),
  /** Required in Resend's unverified-domain testing mode; all messages are routed here. */
  RESEND_TEST_TO: z.string().email().optional(),
  APP_BASE_URL: z.string().url().optional(),
  /** Set to true only behind a reverse proxy you control that appends the client address to X-Forwarded-For. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Extra issuer addresses whose signatures are still accepted (after a key rotation). */
  TRUSTED_ISSUER_ADDRESSES: z.string().default(''),
})

export interface Config {
  port: number
  env: 'development' | 'test' | 'production'
  databaseUrl: string
  pepper: string
  allowedOrigins: string[]
  /** `embedded` allows the session cookie inside a cross-site preview frame. Never used in production. */
  cookieMode: 'standard' | 'embedded'
  registryAddress: `0x${string}` | null
  anchorChainId: number
  keys: KeyProvider
  signer: IssuerSigner
  trustedIssuers: string[]
  mailer: 'dev' | 'webhook' | 'resend'
  mailWebhookUrl: string | null
  resendApiKey: string | null
  resendFromEmail: string
  resendTestTo: string | null
  appBaseUrl: string | null
  trustProxy: boolean
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === 'string' && v.includes('CHANGE_ME')) throw new Error(`Invalid environment: ${k} still holds a CHANGE_ME placeholder`)
  }
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${detail}`)
  }
  const e = parsed.data
  const env = e.NODE_ENV
  const cookieMode = e.SESSION_COOKIE_MODE ?? (env === 'production' ? 'standard' : 'embedded')
  const mailer = e.MAILER ?? (env === 'production' ? 'resend' : 'dev')
  if (env === 'production') {
    if (cookieMode === 'embedded') throw new Error('SESSION_COOKIE_MODE=embedded is not allowed in production')
    if (e.ALLOWED_ORIGINS.trim() === '') throw new Error('ALLOWED_ORIGINS must be set in production')
    if (mailer === 'dev') throw new Error('MAILER=dev is not allowed in production')
  }
  if (mailer === 'webhook' && !e.MAIL_WEBHOOK_URL) throw new Error('MAIL_WEBHOOK_URL is required for MAILER=webhook')
  if (mailer === 'resend' && !e.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required for MAILER=resend')
  if (mailer === 'resend' && !e.RESEND_TEST_TO) throw new Error('RESEND_TEST_TO is required for Resend testing mode')
  const spec = e.APP_ENCRYPTION_KEYS ?? (e.APP_ENCRYPTION_KEY ? `1:${e.APP_ENCRYPTION_KEY}` : '')
  if (!spec) throw new Error('Set APP_ENCRYPTION_KEYS (or APP_ENCRYPTION_KEY) to a 32-byte key')
  const versions = spec.split(',').map((s) => Number(s.split(':')[0]))
  const current = e.APP_ENCRYPTION_KEY_VERSION ?? Math.max(...versions)
  const signer = new LocalKeySigner(e.ISSUER_PRIVATE_KEY as `0x${string}`)
  return {
    port: e.PORT,
    env,
    databaseUrl: e.DATABASE_URL,
    pepper: e.APP_HASH_PEPPER,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    cookieMode,
    registryAddress: e.VITE_REGISTRY_ADDRESS ? (e.VITE_REGISTRY_ADDRESS as `0x${string}`) : null,
    anchorChainId: e.ANCHOR_CHAIN_ID,
    keys: new EnvKeyring(spec, current),
    signer,
    trustProxy: e.TRUST_PROXY === 'true',
    trustedIssuers: [signer.address, ...e.TRUSTED_ISSUER_ADDRESSES.split(',').map((a) => a.trim()).filter(Boolean)].map((a) => a.toLowerCase()),
    mailer,
    mailWebhookUrl: e.MAIL_WEBHOOK_URL ?? null,
    resendApiKey: e.RESEND_API_KEY ?? null,
    resendFromEmail: e.RESEND_FROM_EMAIL,
    resendTestTo: e.RESEND_TEST_TO ?? null,
    appBaseUrl: e.APP_BASE_URL ?? null,
  }
}

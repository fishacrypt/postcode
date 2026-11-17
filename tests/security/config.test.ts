import { describe, expect, test } from 'bun:test'
import { generatePrivateKey } from 'viem/accounts'
import { loadConfig } from '../../apps/api/src/config'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  APP_ENCRYPTION_KEY: 'a'.repeat(64),
  APP_HASH_PEPPER: 'p'.repeat(40),
  ISSUER_PRIVATE_KEY: generatePrivateKey(),
}
const prod = { ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.example', MAILER: 'webhook', MAIL_WEBHOOK_URL: 'https://mail.example/send' }

describe('environment validation', () => {
  test('a complete production configuration loads with safe defaults', () => {
    const c = loadConfig(prod)
    expect(c.cookieMode).toBe('standard')
    expect(c.trustProxy).toBe(false)
    expect(c.mailer).toBe('webhook')
  })
  test('production refuses unsafe settings', () => {
    expect(() => loadConfig({ ...prod, SESSION_COOKIE_MODE: 'embedded' })).toThrow(/embedded/)
    expect(() => loadConfig({ ...prod, ALLOWED_ORIGINS: '' })).toThrow(/ALLOWED_ORIGINS/)
    expect(() => loadConfig({ ...prod, MAILER: 'dev' })).toThrow(/MAILER=dev/)
    expect(() => loadConfig({ ...prod, MAIL_WEBHOOK_URL: undefined })).toThrow(/MAIL_WEBHOOK_URL/)
  })
  test('weak or malformed secrets are rejected with a message that never echoes them', () => {
    for (const bad of [{ APP_HASH_PEPPER: 'short' }, { ISSUER_PRIVATE_KEY: '0x1234' }, { APP_ENCRYPTION_KEY: 'zz' }]) {
      try {
        loadConfig({ ...base, ...bad })
        throw new Error('should have thrown')
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        expect(msg).toContain('Invalid environment')
        expect(msg).not.toContain(Object.values(bad)[0] as string)
      }
    }
  })
  test('placeholder values from .env.example are not accepted', () => {
    expect(() => loadConfig({ ...base, APP_ENCRYPTION_KEY: 'CHANGE_ME_64_HEX_CHARACTERS' })).toThrow()
    expect(() => loadConfig({ ...base, ISSUER_PRIVATE_KEY: 'CHANGE_ME_0X_PRIVATE_KEY' })).toThrow()
  })
})

describe('placeholders', () => {
  test('any CHANGE_ME value anywhere in the environment stops start-up', () => {
    expect(() => loadConfig({ ...base, MAIL_WEBHOOK_URL: 'CHANGE_ME_HTTPS_URL_OF_YOUR_EMAIL_SERVICE' })).toThrow(/CHANGE_ME/)
    expect(() => loadConfig({ ...base, APP_HASH_PEPPER: 'CHANGE_ME_AT_LEAST_32_RANDOM_CHARACTERS' })).toThrow(/CHANGE_ME/)
  })
})

/**
 * Re-encrypts stored blobs with the current encryption key version.
 *
 * 1. Add the new key:   APP_ENCRYPTION_KEYS="1:<old>,2:<new>"   (the highest version is used for new writes)
 * 2. Deploy, then run:  bun run keys:rotate [--dry-run]
 * 3. When `remaining on old versions` is 0 everywhere, the old key can be retired from the environment.
 *
 * Each row is decrypted with its recorded version and re-encrypted with the current one in a single transaction,
 * so a failure never leaves a row unreadable.
 */
import { decrypt, encrypt, blobKeyVersion } from '@pp/crypto/server'
import { loadConfig } from '../config'
import { createDb } from '../database/db'

const config = loadConfig()
const dry = process.argv.includes('--dry-run')
const db = createDb(config.databaseUrl)
const current = config.keys.currentVersion

let moved = 0
const addresses = await db<{ id: string; user_id: string; sensitive_blob: Uint8Array }[]>`SELECT id, user_id, sensitive_blob FROM addresses`
for (const row of addresses) {
  if (blobKeyVersion(row.sensitive_blob) === current) continue
  const aad = `address:${row.id}:${row.user_id}`
  const { blob, keyVersion } = encrypt(config.keys, decrypt(config.keys, row.sensitive_blob, aad), aad)
  if (!dry) await db`UPDATE addresses SET sensitive_blob = ${blob}, encryption_key_version = ${keyVersion} WHERE id = ${row.id}`
  moved++
}
const creds = await db<{ id: string; user_id: string; claims_blob: Uint8Array }[]>`SELECT id, user_id, claims_blob FROM credentials WHERE claims_blob IS NOT NULL`
for (const row of creds) {
  if (blobKeyVersion(row.claims_blob) === current) continue
  const aad = `credential:${row.id}:${row.user_id}`
  const { blob, keyVersion } = encrypt(config.keys, decrypt(config.keys, row.claims_blob, aad), aad)
  if (!dry) await db`UPDATE credentials SET claims_blob = ${blob}, encryption_key_version = ${keyVersion} WHERE id = ${row.id}`
  moved++
}
const left = await db<{ n: string }[]>`
  SELECT (SELECT count(*) FROM addresses WHERE encryption_key_version <> ${current})
       + (SELECT count(*) FROM credentials WHERE claims_blob IS NOT NULL AND encryption_key_version <> ${current}) AS n`
console.log(`${dry ? 'Would re-encrypt' : 'Re-encrypted'} ${moved} rows. Remaining on old versions: ${dry ? moved : (left[0]?.n ?? '0')}`)
await db.close()

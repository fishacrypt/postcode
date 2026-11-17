import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Server-only primitives. Never import this file from browser code. */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function randomSalt(): string {
  return randomBytes(16).toString('hex')
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function hmacHex(key: string, input: string): string {
  return createHmac('sha256', key).update(input, 'utf8').digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function parseKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Encryption key must be 32 bytes encoded as 64 hex characters')
  return Buffer.from(hex, 'hex')
}

/**
 * Key management abstraction. The default implementation reads keys from the environment.
 * A KMS-backed implementation can replace it without touching callers: only `currentVersion`
 * and `key(version)` are used.
 */
export interface KeyProvider {
  readonly currentVersion: number
  key(version: number): Buffer
}

export class EnvKeyring implements KeyProvider {
  private readonly keys = new Map<number, Buffer>()

  /**
   * @param spec comma separated "version:hex" pairs, for example "1:ab..,2:cd..".
   * @param current the version used for new writes. Older versions stay readable until rotated out.
   */
  constructor(spec: string, readonly currentVersion: number) {
    for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [version, hex] = entry.split(':')
      const n = Number(version)
      if (!Number.isInteger(n) || n < 1 || n > 255 || !hex) throw new Error('Invalid encryption key entry')
      this.keys.set(n, parseKey(hex))
    }
    if (!this.keys.has(currentVersion)) throw new Error('The current encryption key version is not configured')
  }

  key(version: number): Buffer {
    const k = this.keys.get(version)
    if (!k) throw new Error('Unknown encryption key version')
    return k
  }
}

export class DecryptionError extends Error {
  constructor() {
    super('Unable to decrypt data')
  }
}

/**
 * AES-256-GCM with a fresh random 96-bit nonce per message (collision risk is negligible below 2^32 messages per key;
 * rotate keys long before that). Layout: keyVersion(1) | nonce(12) | tag(16) | ciphertext.
 * `aad` binds the ciphertext to its row, so a blob cannot be moved between rows or owners.
 */
export function encrypt(keys: KeyProvider, plaintext: string, aad: string): { blob: Buffer; keyVersion: number } {
  const keyVersion = keys.currentVersion
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.key(keyVersion), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { blob: Buffer.concat([Buffer.from([keyVersion]), iv, cipher.getAuthTag(), body]), keyVersion }
}

/** Throws a generic DecryptionError for every failure so callers cannot leak details. */
export function decrypt(keys: KeyProvider, blob: Uint8Array, aad: string): string {
  try {
    const buf = Buffer.from(blob)
    if (buf.length < 29) throw new DecryptionError()
    const version = buf[0]
    const decipher = createDecipheriv('aes-256-gcm', keys.key(version), buf.subarray(1, 13))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(buf.subarray(13, 29))
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8')
  } catch {
    throw new DecryptionError()
  }
}

export function blobKeyVersion(blob: Uint8Array): number {
  return blob[0] ?? 0
}

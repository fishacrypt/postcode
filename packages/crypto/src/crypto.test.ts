import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { canonicalJson, claimCommitment, hashCanonical } from './index'
import { DecryptionError, EnvKeyring, blobKeyVersion, decrypt, encrypt } from './server'

const hex = () => randomBytes(32).toString('hex')

describe('canonical hashing and commitments', () => {
  test('key order does not matter', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}')
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }))
  })
  test('commitments depend on field, value and salt', () => {
    const base = claimCommitment('state', 'Lagos', 'salt1')
    expect(claimCommitment('state', 'Lagos', 'salt1')).toBe(base)
    expect(claimCommitment('lga', 'Lagos', 'salt1')).not.toBe(base)
    expect(claimCommitment('state', 'Kano', 'salt1')).not.toBe(base)
    expect(claimCommitment('state', 'Lagos', 'salt2')).not.toBe(base)
  })
})

describe('AES-256-GCM envelope', () => {
  const keys = new EnvKeyring(`1:${hex()}`, 1)

  test('round trips and uses a fresh nonce each time', () => {
    const a = encrypt(keys, 'secret street', 'row:1')
    const b = encrypt(keys, 'secret street', 'row:1')
    expect(decrypt(keys, a.blob, 'row:1')).toBe('secret street')
    expect(a.blob.subarray(1, 13).equals(b.blob.subarray(1, 13))).toBe(false)
    expect(a.blob.includes(Buffer.from('secret street'))).toBe(false)
  })

  test('tampering with ciphertext, tag, nonce or version is detected', () => {
    const { blob } = encrypt(keys, 'secret street', 'row:1')
    for (const index of [1, 14, 30, blob.length - 1]) {
      const copy = Buffer.from(blob)
      copy[index] = (copy[index] ?? 0) ^ 0x01
      expect(() => decrypt(keys, copy, 'row:1')).toThrow(DecryptionError)
    }
    const wrongVersion = Buffer.from(blob)
    wrongVersion[0] = 9
    expect(() => decrypt(keys, wrongVersion, 'row:1')).toThrow(DecryptionError)
    expect(() => decrypt(keys, blob.subarray(0, 20), 'row:1')).toThrow(DecryptionError)
  })

  test('a blob cannot be moved to another row (AAD binding)', () => {
    const { blob } = encrypt(keys, 'secret street', 'row:1')
    expect(() => decrypt(keys, blob, 'row:2')).toThrow(DecryptionError)
  })

  test('errors never reveal plaintext or key material', () => {
    const { blob } = encrypt(keys, 'secret street', 'row:1')
    try {
      decrypt(keys, blob, 'row:2')
    } catch (e) {
      expect(String((e as Error).message)).toBe('Unable to decrypt data')
    }
  })

  test('key rotation: old data stays readable, new data uses the new version', () => {
    const k1 = hex()
    const old = encrypt(new EnvKeyring(`1:${k1}`, 1), 'legacy', 'row:1')
    const rotated = new EnvKeyring(`1:${k1},2:${hex()}`, 2)
    expect(blobKeyVersion(old.blob)).toBe(1)
    expect(decrypt(rotated, old.blob, 'row:1')).toBe('legacy')
    const fresh = encrypt(rotated, 'new', 'row:1')
    expect(fresh.keyVersion).toBe(2)
    expect(blobKeyVersion(fresh.blob)).toBe(2)
    expect(() => decrypt(new EnvKeyring(`1:${k1}`, 1), fresh.blob, 'row:1')).toThrow(DecryptionError)
  })

  test('invalid key configuration is rejected', () => {
    expect(() => new EnvKeyring('1:abc', 1)).toThrow()
    expect(() => new EnvKeyring(`1:${hex()}`, 2)).toThrow()
  })
})

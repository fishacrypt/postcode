import { keccak256, stringToBytes, type Hex } from 'viem'

/** Isomorphic helpers (browser and Bun). Server-only primitives live in ./server. */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** Deterministic JSON: sorted keys, no whitespace, finite numbers only. */
export function canonicalJson(value: Json): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number')
      return JSON.stringify(value)
    default:
      break
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

export function hashCanonical(value: Json): Hex {
  return keccak256(stringToBytes(canonicalJson(value)))
}

const CLAIM_DOMAIN = 'postcodeproof.claim.v1'

/**
 * Salted commitment to one claim. The salt is per claim, so revealing one claim
 * says nothing about the others, and a hash alone cannot be brute-forced from a short value.
 */
export function claimCommitment(field: string, value: string, salt: string): Hex {
  return hashCanonical([CLAIM_DOMAIN, field, salt, value])
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Truncate a long identifier for display, never for comparison. */
export function shortHash(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

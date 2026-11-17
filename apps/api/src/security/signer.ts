import { privateKeyToAccount } from 'viem/accounts'
import type { Hex, TypedDataDefinition } from 'viem'

/**
 * Signing abstraction. The local implementation holds the issuer key in process memory.
 * A KMS/HSM-backed implementation can replace it without changing callers.
 */
export interface IssuerSigner {
  readonly address: `0x${string}`
  /** EIP-191 signature over a 32-byte digest. */
  signDigest(digest: Hex): Promise<Hex>
  signTypedData(data: TypedDataDefinition): Promise<Hex>
}

export class LocalKeySigner implements IssuerSigner {
  private readonly account

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey)
  }

  get address(): `0x${string}` {
    return this.account.address
  }

  signDigest(digest: Hex): Promise<Hex> {
    return this.account.signMessage({ message: { raw: digest } })
  }

  signTypedData(data: TypedDataDefinition): Promise<Hex> {
    return this.account.signTypedData(data)
  }
}

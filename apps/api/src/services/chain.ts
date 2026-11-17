import { createPublicClient, http, keccak256, parseAbi, parseEventLogs, stringToBytes, type Hex } from 'viem'
import { getChain } from '@/onchain-facts'
import type { Config } from '../config'

export const REGISTRY_ABI = parseAbi([
  'function statusOf(bytes32 credentialId) view returns (uint8)',
  'event CommitmentRegistered(bytes32 indexed credentialId, bytes32 indexed commitment, address indexed holder, address issuer, uint64 expiresAt)',
])

/** On-chain credential id: keccak256 of the credential UUID string. */
export const onchainId = (credentialId: string): Hex => keccak256(stringToBytes(credentialId))

/**
 * RPC resolution. Prefers a per-chain RPC_URL_<chain> override, then the provisioned RPC proxy,
 * then the public RPC listed in the onchain registry. Never logs the resolved URL (it can carry a token).
 */
export function resolveRpcUrl(chainId: number): string {
  const chain = getChain(chainId)
  if (!chain) throw new Error('Unsupported chain')
  const key = chain.name.replace(/\s+/g, '_')
  const override = process.env[`RPC_URL_${key}`]
  if (override) return override
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
  if (process.env.RPC_PROXY_BASE_URL && proxyChains.includes(key)) {
    return `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${key}?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
  }
  const url = chain.rpcUrls[0]
  if (!url) throw new Error('No RPC URL available')
  return url
}

export type OnchainStatus = 'none' | 'active' | 'expired' | 'revoked' | 'unknown'
const STATUS_NAMES: readonly OnchainStatus[] = ['none', 'active', 'expired', 'revoked']

function client(config: Config) {
  return createPublicClient({ transport: http(resolveRpcUrl(config.anchorChainId), { timeout: 8000 }) })
}

/** Reads the registry. Any failure is reported as "unknown", never as active. */
export async function onchainStatus(config: Config, credentialId: string): Promise<OnchainStatus> {
  if (!config.registryAddress) return 'unknown'
  try {
    const value = await client(config).readContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'statusOf',
      args: [onchainId(credentialId)],
    })
    return STATUS_NAMES[Number(value)] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Confirms that `txHash` is a successful registration of exactly this credential by this holder. */
export async function confirmAnchorTx(
  config: Config,
  txHash: Hex,
  expected: { credentialId: string; commitment: Hex; holder: string },
): Promise<boolean> {
  if (!config.registryAddress) return false
  try {
    const receipt = await client(config).getTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') return false
    const logs = parseEventLogs({ abi: REGISTRY_ABI, eventName: 'CommitmentRegistered', logs: receipt.logs })
    return logs.some(
      (l) =>
        l.address.toLowerCase() === config.registryAddress?.toLowerCase() &&
        l.args.credentialId === onchainId(expected.credentialId) &&
        l.args.commitment === expected.commitment &&
        l.args.holder.toLowerCase() === expected.holder.toLowerCase(),
    )
  } catch {
    return false
  }
}

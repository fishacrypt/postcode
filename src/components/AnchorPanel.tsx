import { useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { ConnectKitButton } from 'connectkit'
import { parseAbi, type Hex } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/config'
import { Button, ErrorNote } from '@/components/ui'
import { api, errorMessage, type Credential } from '@/lib/api'
import { buildTxExplorerUrl, requireChain } from '@/onchain-facts'

const REGISTRY = (import.meta.env.VITE_REGISTRY_ADDRESS ?? '') as string
const CHAIN_ID = 5042002 as const
const ABI = parseAbi([
  'function registerCommitment(bytes32 credentialId, bytes32 commitment, uint64 expiresAt, uint64 deadline, address issuer, bytes signature)',
])

interface Attestation {
  registry: Hex
  chainId: number
  credentialId: Hex
  commitment: Hex
  expiresAt: string
  deadline: string
  issuer: Hex
  signature: Hex
}

/** Optional onchain anchoring. Only a hash, an identifier, your wallet and the expiry go onchain. */
export function AnchorPanel({ credential }: { credential: Credential }) {
  const qc = useQueryClient()
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const chain = requireChain(CHAIN_ID)

  if (credential.anchor.status === 'anchored') {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-ok">Anchored onchain</p>
        <a className="inline-flex min-h-11 items-center gap-1 text-accent" href={buildTxExplorerUrl(credential.anchor.chainId, credential.anchor.txHash)} target="_blank" rel="noopener noreferrer">
          View transaction <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
    )
  }
  if (!REGISTRY) {
    return <p className="text-sm text-mute">Onchain anchoring is not enabled yet. Credentials work fully without it.</p>
  }

  const anchor = async () => {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
      const { attestation } = await api.post<{ attestation: Attestation }>(`/credentials/${credential.id}/anchor`, { holder: address })
      const hash = await writeContractAsync({
        address: attestation.registry,
        abi: ABI,
        functionName: 'registerCommitment',
        args: [attestation.credentialId, attestation.commitment, BigInt(attestation.expiresAt), BigInt(attestation.deadline), attestation.issuer, attestation.signature],
        chainId: CHAIN_ID,
      })
      await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID })
      await api.post(`/credentials/${credential.id}/anchor`, { holder: address, txHash: hash })
      toast.success('Credential anchored.')
      await qc.invalidateQueries({ queryKey: ['credentials'] })
    } catch (e) {
      setError(e)
      if (!/rejected|denied/i.test(errorMessage(e))) toast.error('Anchoring did not complete.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mute">
        Anchor a hash of this credential on {chain.name} so anyone can check its status. Fees are paid in USDC, which is also the network gas token on Arc.
      </p>
      <ConnectKitButton.Custom>
        {({ isConnected, show }) =>
          isConnected ? (
            <Button loading={busy} onClick={() => void anchor()}>Anchor credential</Button>
          ) : (
            <Button variant="secondary" onClick={show}>Connect wallet</Button>
          )
        }
      </ConnectKitButton.Custom>
      <ErrorNote error={error ? new Error(/rejected|denied/i.test(errorMessage(error)) ? 'You cancelled the request.' : 'The transaction could not be completed. Check your balance and try again.') : null} />
    </div>
  )
}

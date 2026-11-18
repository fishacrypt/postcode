import { useState, type ChangeEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileUp, ShieldAlert, XCircle } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Badge, Card, ErrorNote, Spinner, formatDate, statusTone } from '@/components/ui'
import { api, ApiError, ASSURANCE_LABELS } from '@/lib/api'

interface Result {
  status: 'valid' | 'expired' | 'revoked' | 'invalid' | 'unavailable'
  reference: string
  issuedAt: string
  expiresAt: string
  issuer: { name: string; address: string }
  assurance: { level: number; label: string; gpsFix: boolean; datasetMatch: boolean }
  onchain: string | null
  notice: string
  disclosed: { field: string; label: string; value: string; sensitive: boolean }[]
  checks?: { signatureValid: boolean; issuerTrusted: boolean; credentialRecordFound?: boolean; disclosuresMatch: boolean }
  linkExpiresAt?: string
}

const STATUS_COPY: Record<Result['status'], { title: string; icon: typeof CheckCircle2; tone: string }> = {
  valid: { title: 'Credential is valid', icon: CheckCircle2, tone: 'text-ok' },
  expired: { title: 'Credential has expired', icon: AlertTriangle, tone: 'text-warn' },
  revoked: { title: 'Credential was revoked', icon: XCircle, tone: 'text-bad' },
  invalid: { title: 'Credential could not be authenticated', icon: ShieldAlert, tone: 'text-bad' },
  unavailable: { title: 'Verification temporarily unavailable', icon: AlertTriangle, tone: 'text-warn' },
}

export function VerifyPage() {
  // The link token lives in the URL fragment, so it never reaches a server log or referrer.
  const token = window.location.hash.replace(/^#/, '')
  const [uploaded, setUploaded] = useState<Result | null>(null)
  const [uploadError, setUploadError] = useState<unknown>(null)
  const link = useQuery({
    queryKey: ['verify-link', token],
    enabled: token.length > 0,
    queryFn: () => api.post<Result>('/verify/link', { token }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    try {
      if (file.size > 60_000) throw new Error('This file is too large to be a credential presentation.')
      const body = JSON.parse(await file.text()) as unknown
      setUploaded(await api.post<Result>('/verify/credential', body))
    } catch (err) {
      setUploaded(null)
      setUploadError(err instanceof SyntaxError ? new Error('This file is not valid JSON.') : err)
    }
  }

  const result = uploaded ?? link.data
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-8">
      <Logo />
      <h1 className="text-3xl font-semibold tracking-tight">Verify a credential</h1>

      {token && link.isLoading && !uploaded && <Spinner label="Checking credential" />}
      {token && link.error && !uploaded && (
        <Card className="space-y-2">
          <p className="flex items-center gap-2 font-semibold text-bad"><XCircle className="h-5 w-5" aria-hidden /> Link unavailable</p>
          <p className="text-sm text-mute">
            {link.error instanceof ApiError && link.error.status === 404
              ? 'This verification link is invalid, expired, used up or was revoked by the holder.'
              : 'We could not check this link right now. Try again shortly.'}
          </p>
        </Card>
      )}

      {result && <ResultCard result={result} />}

      <Card className="space-y-3">
        <h2 className="font-semibold">Have a credential file instead?</h2>
        <p className="text-sm text-mute">Upload a downloaded presentation to check its signature and any disclosed fields.</p>
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-canvas px-4 text-sm font-medium hover:bg-soft">
          <FileUp className="h-4 w-4" aria-hidden /> Choose a .json file
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
        <ErrorNote error={uploadError} />
      </Card>
      {!token && !result && <p className="text-sm text-mute">Open a verification link or QR code you were given to see its result here.</p>}
    </div>
  )
}

function ResultCard({ result }: { result: Result }) {
  const copy = STATUS_COPY[result.status]
  const Icon = copy.icon
  return (
    <Card className="space-y-5" aria-live="polite">
      <div className={`flex items-center gap-3 ${copy.tone}`}>
        <Icon className="h-7 w-7" aria-hidden />
        <h2 className="text-xl font-semibold">{copy.title}</h2>
      </div>
      {result.checks && !result.checks.disclosuresMatch && (
        <p className="rounded-xl border border-bad/20 bg-bad/5 p-3 text-sm text-bad">Some disclosed values do not match the credential and were not shown.</p>
      )}
      {result.checks && result.checks.credentialRecordFound === false && (
        <p className="rounded-xl border border-bad/20 bg-bad/5 p-3 text-sm text-bad">The credential is not present in the issuing registry database. Its signature alone is not sufficient to establish current validity.</p>
      )}
      {result.disclosed.length > 0 ? (
        <dl className="divide-y divide-line rounded-xl border border-line">
          {result.disclosed.map((d) => (
            <div key={d.field} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-mute">{d.label}</dt>
              <dd className="text-right font-medium">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-mute">{result.status === 'valid' ? 'The holder has not shared any address fields.' : result.status === 'unavailable' ? 'The issuing registry could not be reached to confirm the current status. Try again later.' : 'No fields are shown for this credential.'}</p>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Meta label="Status"><Badge tone={statusTone(result.status)}>{result.status}</Badge></Meta>
        <Meta label="Reference"><span className="font-mono">{result.reference}</span></Meta>
        <Meta label="Issued">{formatDate(result.issuedAt)}</Meta>
        <Meta label="Expires">{formatDate(result.expiresAt)}</Meta>
        <Meta label="Assurance">{ASSURANCE_LABELS[result.assurance.level] ?? result.assurance.label}</Meta>
        <Meta label="Onchain registry">{result.onchain ?? 'Not anchored'}</Meta>
      </dl>
      <p className="rounded-xl bg-soft p-3 text-xs text-ink">{result.notice}</p>
    </Card>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.06em] text-mute">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}

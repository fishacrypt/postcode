import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Copy, Download, FileBadge2, Link2, RefreshCw, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { AnchorPanel } from '@/components/AnchorPanel'
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, formatDate, statusTone } from '@/components/ui'
import { api, ASSURANCE_LABELS, CLAIM_LABELS, errorMessage, SENSITIVE, type Address, type ClaimField, type Credential } from '@/lib/api'
import { buildShareLink } from '@/lib/share'

const FIELD_ORDER = Object.keys(CLAIM_LABELS) as ClaimField[]

export function CredentialsPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['credentials'], queryFn: () => api.get<{ credentials: Credential[] }>('/credentials') })
  const [issue, setIssue] = useState(false)
  const [active, setActive] = useState<{ kind: 'share' | 'download' | 'details' | 'revoke'; credential: Credential } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['credentials'] })
  const renew = useMutation({
    mutationFn: (id: string) => api.post(`/credentials/${id}/renew`),
    onSuccess: () => { toast.success('Credential renewed.'); void refresh() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <>
      <PageHeader title="My credentials" subtitle="A credential shows that your address was validated and signed. It is not proof of residence." action={<Button onClick={() => setIssue(true)}><FileBadge2 className="h-4 w-4" aria-hidden /> Issue credential</Button>} />
      {list.isLoading && <Spinner />}
      <ErrorNote error={list.error} />
      {list.data?.credentials.length === 0 && (
        <EmptyState icon={<FileBadge2 className="h-6 w-6" />} title="No credentials yet" body="Validate an address, then issue a credential you can share selectively." action={<Button onClick={() => setIssue(true)}>Issue your first credential</Button>} />
      )}
      <div className="space-y-4">
        {list.data?.credentials.map((c) => (
          <Card key={c.id} className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Address credential</p>
                <p className="font-mono text-xs text-mute">{c.id}</p>
              </div>
              <Badge tone={statusTone(c.status)}>{c.status}</Badge>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Issuer">{c.issuer.name}</Info>
              <Info label="Issued">{formatDate(c.issuedAt)}</Info>
              <Info label="Expires">{formatDate(c.expiresAt)}</Info>
              <Info label="Assurance">{ASSURANCE_LABELS[c.assurance.level]}</Info>
              <Info label="Onchain"><Badge tone={statusTone(c.anchor.status)}>{c.anchor.status === 'anchored' ? 'Anchored' : 'Not anchored'}</Badge></Info>
              <Info label="Covers">{c.address ? `${c.address.lga}, ${c.address.state} ${c.address.postcode}` : 'Address deleted'}</Info>
            </dl>
            {c.addressChanged && c.status === 'active' && <p className="rounded-xl bg-warn/10 p-3 text-xs text-warn">The address changed after this credential was issued. Renew it so it matches.</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setActive({ kind: 'details', credential: c })}>View</Button>
              {c.status === 'active' && (
                <>
                  <Button variant="secondary" onClick={() => setActive({ kind: 'share', credential: c })}><Link2 className="h-4 w-4" aria-hidden /> Share or QR</Button>
                  <Button variant="secondary" onClick={() => setActive({ kind: 'download', credential: c })}><Download className="h-4 w-4" aria-hidden /> Download</Button>
                </>
              )}
              {c.renewable && <Button variant="secondary" loading={renew.isPending} onClick={() => renew.mutate(c.id)}><RefreshCw className="h-4 w-4" aria-hidden /> Renew</Button>}
              {c.status === 'active' && <Button variant="ghost" onClick={() => setActive({ kind: 'revoke', credential: c })}><ShieldOff className="h-4 w-4" aria-hidden /> Revoke</Button>}
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={issue} onClose={() => setIssue(false)} title="Issue a credential"><IssueForm onDone={() => { setIssue(false); void refresh() }} /></Dialog>
      <Dialog open={active !== null} onClose={() => setActive(null)} title={active ? { share: 'Share or generate a QR code', download: 'Download credential', details: 'Credential details', revoke: 'Revoke credential' }[active.kind] : ''}>
        {active?.kind === 'share' && <ShareForm credential={active.credential} />}
        {active?.kind === 'download' && <DownloadForm credential={active.credential} />}
        {active?.kind === 'details' && <Details credential={active.credential} />}
        {active?.kind === 'revoke' && <RevokeForm credential={active.credential} onDone={() => { setActive(null); void refresh() }} />}
      </Dialog>
    </>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-[0.06em] text-mute">{label}</dt><dd className="mt-0.5 font-medium">{children}</dd></div>
}

function IssueForm({ onDone }: { onDone: () => void }) {
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<{ addresses: Address[] }>('/addresses') })
  const [addressId, setAddressId] = useState('')
  const [agreed, setAgreed] = useState(false)
  const chosen = addresses.data?.addresses.find((a) => a.id === addressId)
  const issue = useMutation({
    mutationFn: () => api.post('/credentials', { addressId, consent: { accepted: true, statementVersion: '1' } }),
    onSuccess: () => { toast.success('Credential issued.'); onDone() },
  })
  return (
    <div className="space-y-4">
      <Field label="Address">
        <Select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
          <option value="">Choose an address</option>
          {addresses.data?.addresses.map((a) => <option key={a.id} value={a.id}>{a.buildingNumber} {a.street}, {a.city} ({a.postcode})</option>)}
        </Select>
      </Field>
      {chosen && <p className="text-sm text-mute">Assurance: <strong>{ASSURANCE_LABELS[chosen.assuranceLevel]}</strong>. {chosen.assuranceLevel < 2 && 'This credential will say the postcode was checked for format only.'}</p>}
      <label className="flex gap-3 rounded-xl bg-canvas p-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I consent to PostcodeProof issuing a signed credential for this address and storing its values encrypted. Nothing is shared with anyone until I create a link or approve a request.</span>
      </label>
      <ErrorNote error={issue.error} />
      <Button className="w-full" disabled={!addressId || !agreed} loading={issue.isPending} onClick={() => issue.mutate()}>Issue credential</Button>
    </div>
  )
}

function FieldPicker({ credential, value, onChange }: { credential: Credential; value: ClaimField[]; onChange: (v: ClaimField[]) => void }) {
  void credential
  const toggle = (f: ClaimField) => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f])
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium">What to reveal</legend>
      {FIELD_ORDER.map((f) => (
        <label key={f} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-canvas">
          <input type="checkbox" className="h-4 w-4" checked={value.includes(f)} onChange={() => toggle(f)} />
          <span className="flex-1">{CLAIM_LABELS[f]}</span>
          {SENSITIVE.includes(f) && <Badge tone="warn">Identifies your home</Badge>}
        </label>
      ))}
    </fieldset>
  )
}

function ShareForm({ credential }: { credential: Credential }) {
  const [fields, setFields] = useState<ClaimField[]>(['country', 'state'])
  const [hours, setHours] = useState('24')
  const [singleUse, setSingleUse] = useState(false)
  const [label, setLabel] = useState('')
  const [ack, setAck] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const sensitive = fields.some((f) => SENSITIVE.includes(f))
  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ link: { token: string } }>(`/credentials/${credential.id}/links`, {
        fields, expiresInHours: Number(hours), label: label || undefined, maxUses: singleUse ? 1 : undefined, acknowledgeSensitive: ack,
      })
      return `${await buildShareLink('/verify')}#${res.link.token}`
    },
    onSuccess: (url) => setLink(url),
  })
  const qrQuery = useQuery({ queryKey: ['qr', link], enabled: link !== null, queryFn: () => QRCode.toDataURL(link ?? '', { margin: 1, width: 260 }), staleTime: Infinity })
  const qr = qrQuery.data ?? null

  if (link) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-mute">This link is shown once. Anyone who has it can see only the fields you chose, until it expires or you revoke it from Privacy and consent.</p>
        {qr && <img src={qr} alt="QR code for the verification link" className="mx-auto h-56 w-56 rounded-xl border border-line" />}
        <div className="flex gap-2">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Verification link" />
          <Button variant="secondary" aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('Link copied.'))}><Copy className="h-4 w-4" aria-hidden /></Button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <FieldPicker credential={credential} value={fields} onChange={setFields} />
      {sensitive && (
        <label className="flex gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand that street-level details identify my exact home and anyone with this link can read them.</span>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Link expires after">
          <Select value={hours} onChange={(e) => setHours(e.target.value)}>
            <option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option>
          </Select>
        </Field>
        <Field label="Label (only you see it)"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="For example: Bank onboarding" /></Field>
      </div>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} /> Single use. The link stops working after one check.</label>
      <ErrorNote error={create.error} />
      <Button className="w-full" disabled={fields.length === 0 || (sensitive && !ack)} loading={create.isPending} onClick={() => create.mutate()}>Create link and QR code</Button>
    </div>
  )
}

function DownloadForm({ credential }: { credential: Credential }) {
  const [fields, setFields] = useState<ClaimField[]>([])
  const [ack, setAck] = useState(false)
  const sensitive = fields.some((f) => SENSITIVE.includes(f))
  const download = useMutation({
    mutationFn: async () => {
      const q = new URLSearchParams({ fields: fields.join(','), acknowledgeSensitive: String(ack) })
      const data = await api.get<unknown>(`/credentials/${credential.id}/presentation?${q.toString()}`)
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `postcodeproof-credential-${credential.id.slice(0, 8)}.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => toast.success('Credential file downloaded.'),
  })
  return (
    <div className="space-y-4">
      <p className="text-sm text-mute">The file contains the signed credential. Pick the fields to include as readable values. With none selected, it proves only that a credential exists.</p>
      <FieldPicker credential={credential} value={fields} onChange={setFields} />
      {sensitive && <label className="flex gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I understand this file will contain my street-level details.</span></label>}
      <ErrorNote error={download.error} />
      <Button className="w-full" disabled={sensitive && !ack} loading={download.isPending} onClick={() => download.mutate()}>Download</Button>
    </div>
  )
}

function Details({ credential }: { credential: Credential }) {
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <Info label="Status"><Badge tone={statusTone(credential.status)}>{credential.status}</Badge></Info>
        <Info label="Type">{credential.type}</Info>
        <Info label="Issuer address"><span className="break-all font-mono text-xs">{credential.issuer.address}</span></Info>
        <Info label="Credential hash"><span className="break-all font-mono text-xs">{credential.credentialHash}</span></Info>
        <Info label="Dataset match">{credential.assurance.datasetMatch ? 'Yes' : 'No'}</Info>
        <Info label="Device location fix">{credential.assurance.gpsFix ? 'Yes' : 'No'}</Info>
      </dl>
      <p className="rounded-xl bg-soft p-3 text-xs">Proof of residence: not established. This credential confirms a validated address, not where you live.</p>
      <div className="border-t border-line pt-4">
        <p className="mb-2 font-semibold">Onchain anchoring</p>
        <AnchorPanel credential={credential} />
      </div>
    </div>
  )
}

function RevokeForm({ credential, onDone }: { credential: Credential; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const revoke = useMutation({
    mutationFn: () => api.post(`/credentials/${credential.id}/revoke`, { reason: reason || undefined }),
    onSuccess: () => { toast.success('Credential revoked.'); onDone() },
  })
  return (
    <div className="space-y-4">
      <p className="text-sm text-mute">Revoking stops every link and request from working immediately. This cannot be undone, but you can issue a new credential.</p>
      <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      <ErrorNote error={revoke.error} />
      <Button variant="danger" className="w-full" loading={revoke.isPending} onClick={() => revoke.mutate()}>Revoke credential</Button>
    </div>
  )
}

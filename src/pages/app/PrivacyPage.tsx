import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, History, Link2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, formatDateTime, statusTone } from '@/components/ui'
import { api, CLAIM_LABELS, SENSITIVE, type ClaimField, type Credential } from '@/lib/api'

interface Preview {
  request: { business: string; purpose: string; reference: string; requestedFields: { field: ClaimField; label: string; sensitive: boolean }[]; expiresAt: string }
}

export function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy and consent" subtitle="Decide what businesses can see, and review everything you have shared." />
      <div className="space-y-6">
        <RequestCard />
        <LinksCard />
        <ConsentLog />
      </div>
    </>
  )
}

function RequestCard() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [chosen, setChosen] = useState<ClaimField[]>([])
  const [credentialId, setCredentialId] = useState('')
  const [ack, setAck] = useState(false)
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: () => api.get<{ credentials: Credential[] }>('/credentials') })
  const active = credentials.data?.credentials.filter((c) => c.status === 'active') ?? []
  const preview = useMutation({
    mutationFn: () => api.post<Preview>('/verify/requests/preview', { code }),
    onSuccess: (r) => { setChosen(r.request.requestedFields.filter((f) => !f.sensitive).map((f) => f.field)); setAck(false) },
  })
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post('/verify/consent', { code, approve, fields: approve ? chosen : [], credentialId: credentialId || active[0]?.id, acknowledgeSensitive: ack }),
    onSuccess: (_r, approve) => {
      toast.success(approve ? 'Shared with the business.' : 'Request declined.')
      preview.reset(); setCode('')
      void qc.invalidateQueries({ queryKey: ['consents'] })
    },
  })
  const req = preview.data?.request
  const sensitiveChosen = chosen.some((f) => SENSITIVE.includes(f))
  return (
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Answer a business request</h2>
      <p className="text-sm text-mute">A business gives you a code. Enter it to see exactly who is asking, why, and which fields they want.</p>
      {!req ? (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); preview.mutate() }}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Request code" maxLength={12} aria-label="Request code" className="font-mono tracking-widest" />
          <Button type="submit" loading={preview.isPending} disabled={code.trim().length < 6}>Review request</Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-canvas p-4 text-sm">
            <p><strong>{req.business}</strong> is asking to confirm your address credential.</p>
            <p className="mt-1 text-mute">Purpose: {req.purpose} (reference {req.reference})</p>
          </div>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">Choose what to share (you can share less than requested)</legend>
            {req.requestedFields.map((f) => (
              <label key={f.field} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-canvas">
                <input type="checkbox" className="h-4 w-4" checked={chosen.includes(f.field)} onChange={() => setChosen((c) => (c.includes(f.field) ? c.filter((x) => x !== f.field) : [...c, f.field]))} />
                <span className="flex-1">{CLAIM_LABELS[f.field]}</span>
                {f.sensitive && <Badge tone="warn">Identifies your home</Badge>}
              </label>
            ))}
          </fieldset>
          {sensitiveChosen && (
            <label className="flex gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I understand this business will see my street-level details.</span>
            </label>
          )}
          <Field label="Credential to use">
            <Select value={credentialId || active[0]?.id || ''} onChange={(e) => setCredentialId(e.target.value)}>
              {active.length === 0 && <option value="">No active credential</option>}
              {active.map((c) => <option key={c.id} value={c.id}>{c.address ? `${c.address.lga}, ${c.address.state}` : 'Credential'} (expires {new Date(c.expiresAt).toLocaleDateString('en-GB')})</option>)}
            </Select>
          </Field>
          <p className="text-xs text-mute">The business can read your approved fields for 24 hours. You can withdraw access below.</p>
          <ErrorNote error={decide.error} />
          <div className="flex flex-wrap gap-2">
            <Button loading={decide.isPending} disabled={chosen.length === 0 || active.length === 0 || (sensitiveChosen && !ack)} onClick={() => decide.mutate(true)}>Share selected fields</Button>
            <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Decline</Button>
            <Button variant="ghost" onClick={() => preview.reset()}>Back</Button>
          </div>
        </div>
      )}
      <ErrorNote error={preview.error} />
    </Card>
  )
}

interface LinkRow { id: string; label: string | null; fields: ClaimField[]; useCount: number; maxUses: number | null; expiresAt: string; state: 'active' | 'expired' | 'revoked' }

function LinksCard() {
  const qc = useQueryClient()
  const links = useQuery({ queryKey: ['links'], queryFn: () => api.get<{ links: LinkRow[] }>('/links') })
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/links/${id}`),
    onSuccess: () => { toast.success('Access withdrawn.'); void qc.invalidateQueries({ queryKey: ['links'] }) },
  })
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-accent" aria-hidden /> Verification links and approvals</h2>
      {links.isLoading && <Spinner />}
      {links.data?.links.length === 0 && <EmptyState icon={<Eye className="h-6 w-6" />} title="No links yet" body="Links you create from a credential, and approvals you give businesses, appear here." />}
      <ul className="divide-y divide-line">
        {links.data?.links.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{l.label ?? 'Verification link'}</p>
              <p className="text-xs text-mute">{l.fields.map((f) => CLAIM_LABELS[f]).join(', ')} · {l.useCount}{l.maxUses ? `/${l.maxUses}` : ''} uses · expires {formatDateTime(l.expiresAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(l.state)}>{l.state}</Badge>
              {l.state === 'active' && <Button variant="secondary" loading={revoke.isPending && revoke.variables === l.id} onClick={() => revoke.mutate(l.id)}>Withdraw</Button>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ConsentLog() {
  const consents = useQuery({
    queryKey: ['consents'],
    queryFn: () => api.get<{ consents: { id: string; kind: string; decision: string; recipient: string | null; purpose: string | null; fields: ClaimField[]; createdAt: string }[] }>('/consents'),
  })
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-accent" aria-hidden /> Consent history</h2>
      {consents.data?.consents.length === 0 && <p className="text-sm text-mute">No consent decisions yet.</p>}
      <ul className="divide-y divide-line text-sm">
        {consents.data?.consents.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div>
              <p className="font-medium">{c.recipient ?? 'You'} {c.purpose ? `· ${c.purpose}` : ''}</p>
              <p className="text-xs text-mute">{c.kind.replaceAll('_', ' ')}{c.fields.length ? `: ${c.fields.map((f) => CLAIM_LABELS[f] ?? f).join(', ')}` : ''}</p>
            </div>
            <div className="flex items-center gap-2"><Badge tone={statusTone(c.decision === 'granted' ? 'approved' : c.decision === 'declined' ? 'declined' : 'expired')}>{c.decision}</Badge><span className="text-xs text-mute">{formatDateTime(c.createdAt)}</span></div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

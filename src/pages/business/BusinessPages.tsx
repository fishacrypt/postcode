import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner, Textarea, formatDate, formatDateTime, statusTone } from '@/components/ui'
import { api, ApiError, CLAIM_LABELS, SENSITIVE, type ClaimField } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const REQUESTABLE: ClaimField[] = ['country', 'state', 'lga', 'city', 'postcode']

interface Req { id: string; reference: string; purpose: string; requestedFields: ClaimField[]; status: string; codeHint: string; expiresAt: string; decidedAt: string | null; createdAt: string }

export function BusinessOverview() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const reqs = useQuery({ queryKey: ['b-requests'], queryFn: () => api.get<{ requests: Req[] }>('/businesses/verification-requests') })
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<{ id: string; code: string; reference: string } | null>(null)
  const [openDisclosure, setOpenDisclosure] = useState<string | null>(null)
  return (
    <>
      <PageHeader title={`Verification requests`} subtitle={`Ask holders for specific fields, with their consent. Signed in as ${user?.displayName ?? ''}.`} action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> New request</Button>} />
      {reqs.isLoading && <Spinner />}
      {reqs.data?.requests.length === 0 && <EmptyState icon={<Send className="h-6 w-6" />} title="No requests yet" body="Create a request, then give the one-time code to the person you want to verify." action={<Button onClick={() => setOpen(true)}>Create a request</Button>} />}
      <div className="space-y-3">
        {reqs.data?.requests.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{r.reference}</p>
              <p className="text-sm text-mute">{r.purpose}</p>
              <p className="mt-1 text-xs text-mute">{r.requestedFields.map((f) => CLAIM_LABELS[f]).join(', ')} · created {formatDateTime(r.createdAt)} · code {r.codeHint}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              {r.status === 'approved' && <Button variant="secondary" onClick={() => setOpenDisclosure(r.id)}>View result</Button>}
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={open} onClose={() => { setOpen(false); setCreated(null) }} title={created ? 'Request created' : 'New verification request'}>
        {created ? (
          <div className="space-y-4 text-sm">
            <p>Give this code to the holder. It is shown once and expires with the request.</p>
            <div className="flex items-center justify-between rounded-xl bg-canvas p-4">
              <span className="font-mono text-2xl tracking-[0.2em]">{created.code}</span>
              <Button variant="secondary" aria-label="Copy code" onClick={() => void navigator.clipboard.writeText(created.code).then(() => toast.success('Code copied.'))}><Copy className="h-4 w-4" aria-hidden /></Button>
            </div>
            <p className="text-mute">The holder enters it under Privacy and consent in their PostcodeProof account.</p>
          </div>
        ) : (
          <NewRequest onCreated={(r) => { setCreated(r); void qc.invalidateQueries({ queryKey: ['b-requests'] }) }} />
        )}
      </Dialog>
      <Dialog open={openDisclosure !== null} onClose={() => setOpenDisclosure(null)} title="Approved disclosure">
        {openDisclosure && <Disclosure requestId={openDisclosure} />}
      </Dialog>
    </>
  )
}

function NewRequest({ onCreated }: { onCreated: (r: { id: string; code: string; reference: string }) => void }) {
  const [reference, setReference] = useState('')
  const [purpose, setPurpose] = useState('')
  const [fields, setFields] = useState<ClaimField[]>(['country', 'state'])
  const m = useMutation({
    mutationFn: () => api.post<{ request: { id: string; code: string; reference: string } }>('/businesses/verification-requests', { reference, purpose, requestedFields: fields, expiresInHours: 72 }),
    onSuccess: (r) => onCreated(r.request),
  })
  const f = m.error instanceof ApiError ? m.error.fields : {}
  return (
    <div className="space-y-4">
      <Field label="Your reference" error={f.reference}><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="Order or customer id" /></Field>
      <Field label="Purpose shown to the holder" error={f.purpose}><Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} placeholder="Why do you need this?" /></Field>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">Fields to request</legend>
        {REQUESTABLE.map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-canvas">
            <input type="checkbox" className="h-4 w-4" checked={fields.includes(k)} onChange={() => setFields((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))} />
            {CLAIM_LABELS[k]}
          </label>
        ))}
        <p className="text-xs text-mute">Street-level fields are not requested by default. Only ask for the minimum you need.</p>
      </fieldset>
      <ErrorNote error={m.error && Object.keys(f).length === 0 ? m.error : null} />
      <Button className="w-full" loading={m.isPending} disabled={!reference.trim() || !purpose.trim() || fields.length === 0 || fields.some((x) => SENSITIVE.includes(x))} onClick={() => m.mutate()}>Create request</Button>
    </div>
  )
}

function Disclosure({ requestId }: { requestId: string }) {
  const q = useQuery({
    queryKey: ['disclosure', requestId],
    queryFn: () => api.post<{ status: string; disclosed: { field: string; label: string; value: string }[]; assurance: { label: string }; notice: string; availableUntil: string }>('/verify/disclosure', { requestId }),
    retry: false,
    refetchOnWindowFocus: false,
  })
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorNote error={q.error} />
  const d = q.data
  if (!d) return null
  return (
    <div className="space-y-4 text-sm">
      <p>Credential status: <Badge tone={statusTone(d.status)}>{d.status}</Badge></p>
      <dl className="divide-y divide-line rounded-xl border border-line">
        {d.disclosed.map((x) => <div key={x.field} className="flex justify-between gap-4 px-4 py-3"><dt className="text-mute">{x.label}</dt><dd className="font-medium">{x.value}</dd></div>)}
      </dl>
      <p className="text-xs text-mute">Available until {formatDateTime(d.availableUntil)}. {d.notice}</p>
    </div>
  )
}

interface Key { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null }
const SCOPES = [
  ['verification:create', 'Create verification requests'],
  ['verification:read', 'Read requests and approved disclosures'],
  ['credential:verify', 'Verify presentation files'],
] as const

export function ApiKeysPage() {
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['b-keys'], queryFn: () => api.get<{ apiKeys: Key[] }>('/businesses/api-keys') })
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['verification:create', 'verification:read'])
  const [shown, setShown] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => api.post<{ key: string }>('/businesses/api-keys', { name, scopes }),
    onSuccess: (r) => { setShown(r.key); setName(''); void qc.invalidateQueries({ queryKey: ['b-keys'] }) },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/businesses/api-keys/${id}`),
    onSuccess: () => { toast.success('Key revoked.'); void qc.invalidateQueries({ queryKey: ['b-keys'] }) },
  })
  return (
    <>
      <PageHeader title="API keys" subtitle="Keys authenticate your server. They are shown once and stored only as hashes." />
      {shown && (
        <Card className="mb-6 space-y-3 border-warn/40 bg-warn/5">
          <p className="text-sm font-semibold">Copy your key now. You will not see it again.</p>
          <div className="flex gap-2"><Input readOnly value={shown} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="New API key" /><Button variant="secondary" aria-label="Copy key" onClick={() => void navigator.clipboard.writeText(shown).then(() => toast.success('Key copied.'))}><Copy className="h-4 w-4" aria-hidden /></Button></div>
          <Button variant="ghost" onClick={() => setShown(null)}>I have saved it</Button>
        </Card>
      )}
      <Card className="mb-6 space-y-4">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-accent" aria-hidden /> Create a key</h2>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Checkout server" /></Field>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Permissions</legend>
          {SCOPES.map(([id, label]) => (
            <label key={id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4" checked={scopes.includes(id)} onChange={() => setScopes((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))} />{label}</label>
          ))}
        </fieldset>
        <ErrorNote error={create.error} />
        <Button loading={create.isPending} disabled={!name.trim() || scopes.length === 0} onClick={() => create.mutate()}>Create key</Button>
      </Card>
      <Card>
        <ul className="divide-y divide-line text-sm">
          {keys.data?.apiKeys.length === 0 && <li className="py-3 text-mute">No keys yet.</li>}
          {keys.data?.apiKeys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{k.name} <span className="font-mono text-xs text-mute">{k.prefix}…</span></p>
                <p className="text-xs text-mute">{k.scopes.join(', ')} · created {formatDate(k.createdAt)} · {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : 'never used'}</p>
              </div>
              {k.revokedAt ? <Badge tone="bad">revoked</Badge> : <Button variant="secondary" loading={revoke.isPending && revoke.variables === k.id} onClick={() => { if (window.confirm('Revoke this key? Servers using it will stop working.')) revoke.mutate(k.id) }}>Revoke</Button>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

export function UsagePage() {
  const q = useQuery({ queryKey: ['b-usage'], queryFn: () => api.get<{ keys: { id: string; name: string; prefix: string; calls24h: number; calls30d: number }[]; daily: { day: string; calls: number }[] }>('/businesses/usage') })
  const history = useQuery({ queryKey: ['b-history'], queryFn: () => api.get<{ history: { id: string; channel: string; outcome: string; fields: string[]; createdAt: string }[] }>('/businesses/history') })
  const max = Math.max(1, ...(q.data?.daily.map((d) => d.calls) ?? [1]))
  return (
    <>
      <PageHeader title="Usage and history" subtitle="API calls per key and your verification history." />
      {q.isLoading && <Spinner />}
      <div className="space-y-6">
        <Card className="space-y-3">
          <h2 className="font-semibold">Calls in the last 14 days</h2>
          {q.data?.daily.length ? (
            <div className="flex h-32 items-end gap-1" role="img" aria-label="Daily API calls">
              {q.data.daily.map((d) => <div key={d.day} title={`${d.day}: ${d.calls}`} className="flex-1 rounded-t bg-accent/70" style={{ height: `${Math.max(6, (d.calls / max) * 100)}%` }} />)}
            </div>
          ) : <p className="text-sm text-mute">No API calls yet.</p>}
          <ul className="divide-y divide-line text-sm">
            {q.data?.keys.map((k) => <li key={k.id} className="flex justify-between py-2"><span>{k.name} <span className="font-mono text-xs text-mute">{k.prefix}…</span></span><span className="text-mute">{k.calls24h} today · {k.calls30d} in 30 days</span></li>)}
          </ul>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Verification history</h2>
          {history.data?.history.length === 0 && <p className="text-sm text-mute">No disclosures read yet.</p>}
          <ul className="divide-y divide-line text-sm">
            {history.data?.history.map((h) => <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{h.fields.map((f) => CLAIM_LABELS[f as ClaimField] ?? f).join(', ') || 'No fields'}</span><span className="flex items-center gap-2"><Badge tone={statusTone(h.outcome)}>{h.outcome}</Badge><span className="text-xs text-mute">{formatDateTime(h.createdAt)}</span></span></li>)}
          </ul>
        </Card>
      </div>
    </>
  )
}

export function BusinessProfile() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['b-me'], queryFn: () => api.get<{ business: { name: string; website: string | null; contactEmail: string | null; description: string | null } }>('/businesses/me') })
  const [form, setForm] = useState<{ name: string; website: string; contactEmail: string; description: string } | null>(null)
  const current = form ?? (q.data ? { name: q.data.business.name, website: q.data.business.website ?? '', contactEmail: q.data.business.contactEmail ?? '', description: q.data.business.description ?? '' } : null)
  const save = useMutation({ mutationFn: () => api.patch('/businesses/me', current), onSuccess: () => { toast.success('Profile saved.'); void qc.invalidateQueries({ queryKey: ['b-me'] }) } })
  const fields = save.error instanceof ApiError ? save.error.fields : {}
  if (!current) return <Spinner />
  const set = (k: keyof typeof current, v: string) => setForm({ ...current, [k]: v })
  return (
    <>
      <PageHeader title="Business profile" subtitle="Shown to holders when you request verification." />
      <Card className="space-y-4">
        <Field label="Business name" error={fields.name}><Input value={current.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Website" error={fields.website}><Input value={current.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
        <Field label="Contact email" error={fields.contactEmail}><Input value={current.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
        <Field label="Description" error={fields.description}><Textarea value={current.description} onChange={(e) => set('description', e.target.value)} maxLength={400} /></Field>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
      </Card>
    </>
  )
}

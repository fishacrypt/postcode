import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { GpsButton, ValidationPanel } from '@/components/ValidationPanel'
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea, formatDate } from '@/components/ui'
import { api, ApiError, ASSURANCE_LABELS, errorMessage, type Address, type Gps, type Validation } from '@/lib/api'

interface FormState {
  state: string
  lga: string
  city: string
  district: string
  street: string
  buildingNumber: string
  unit: string
  postcode: string
  additionalInfo: string
}
const EMPTY: FormState = { state: '', lga: '', city: '', district: '', street: '', buildingNumber: '', unit: '', postcode: '', additionalInfo: '' }

export function AddressPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<{ addresses: Address[] }>('/addresses') })
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/addresses/${id}`),
    onSuccess: () => {
      toast.success('Address deleted.')
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      void qc.invalidateQueries({ queryKey: ['credentials'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <>
      <PageHeader
        title="My address"
        subtitle="Add the address you want to turn into a credential. Street-level details are encrypted before they are stored."
        action={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden /> Add address</Button>}
      />
      {list.isLoading && <Spinner />}
      <ErrorNote error={list.error} />
      {list.data && list.data.addresses.length === 0 && (
        <EmptyState icon={<MapPin className="h-6 w-6" />} title="No address yet" body="Add your Nigerian address to validate it and create a credential." action={<Button onClick={() => setEditing('new')}>Add your address</Button>} />
      )}
      <div className="space-y-4">
        {list.data?.addresses.map((a) => (
          <Card key={a.id} className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{a.buildingNumber} {a.street}{a.unit ? `, ${a.unit}` : ''}</p>
                <p className="text-sm text-mute">{[a.district, a.city, a.lga, a.state].filter(Boolean).join(', ')}</p>
                <p className="mt-1 font-mono text-sm">{a.postcode}</p>
              </div>
              <Badge tone={a.assuranceLevel >= 2 ? 'ok' : 'warn'}>Level {a.assuranceLevel}: {ASSURANCE_LABELS[a.assuranceLevel]}</Badge>
            </div>
            {a.validation && <ValidationPanel validation={a.validation} />}
            <p className="text-xs text-mute">Updated {formatDate(a.updatedAt)}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(a)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
              <RevalidateButton id={a.id} />
              <Button variant="ghost" loading={remove.isPending} onClick={() => { if (window.confirm('Delete this address? Active credentials must be revoked first.')) remove.mutate(a.id) }}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add address' : 'Edit address'}>
        {editing && <AddressForm key={editing === 'new' ? 'new' : editing.id} address={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}

function RevalidateButton({ id }: { id: string }) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: () => api.post(`/addresses/${id}/validate`),
    onSuccess: () => { toast.success('Validation updated.'); void qc.invalidateQueries({ queryKey: ['addresses'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return <Button variant="secondary" loading={m.isPending} onClick={() => m.mutate()}><ShieldCheck className="h-4 w-4" aria-hidden /> Re-validate</Button>
}

function AddressForm({ address, onDone }: { address: Address | null; onDone: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(
    address ? { state: address.state, lga: address.lga, city: address.city, district: address.district ?? '', street: address.street, buildingNumber: address.buildingNumber, unit: address.unit ?? '', postcode: address.postcode, additionalInfo: address.additionalInfo ?? '' } : EMPTY,
  )
  const [gps, setGps] = useState<Gps | null>(null)
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const states = useQuery({ queryKey: ['states'], queryFn: () => api.get<{ states: { code: string; name: string }[] }>('/geo/NG/states'), staleTime: Infinity })
  const stateCode = states.data?.states.find((s) => s.name === form.state)?.code
  const lgas = useQuery({
    queryKey: ['lgas', stateCode],
    enabled: Boolean(stateCode),
    queryFn: () => api.get<{ lgas: string[] }>(`/geo/NG/states/${stateCode}/lgas`),
    staleTime: Infinity,
  })
  const postcode = form.postcode.replace(/\s/g, '')
  const live = useQuery({
    queryKey: ['postcode', form.postcode, form.state, form.lga],
    enabled: postcode.length >= 6,
    queryFn: () => api.get<{ validation: Validation }>(`/postcodes/${encodeURIComponent(form.postcode)}?state=${encodeURIComponent(form.state)}&lga=${encodeURIComponent(form.lga)}`),
    staleTime: 30_000,
    retry: false,
  })

  const save = useMutation({
    mutationFn: () => {
      const payload = { country: 'NG', ...form, gps: gps ?? undefined }
      return address ? api.patch<{ address: Address }>(`/addresses/${address.id}`, payload) : api.post<{ address: Address }>('/addresses', payload)
    },
    onSuccess: () => {
      toast.success(address ? 'Address updated.' : 'Address saved and validated.')
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      onDone()
    },
  })
  const fields = save.error instanceof ApiError ? save.error.fields : {}
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Country"><Input value="Nigeria" disabled readOnly /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="State" error={fields.state}>
          <Select required value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, lga: '' }))}>
            <option value="">Choose a state</option>
            {states.data?.states.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Local Government Area" error={fields.lga}>
          <Select required value={form.lga} disabled={!stateCode} onChange={(e) => set('lga', e.target.value)}>
            <option value="">{stateCode ? 'Choose an LGA' : 'Choose a state first'}</option>
            {lgas.data?.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
        <Field label="City or town" error={fields.city}><Input required value={form.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" /></Field>
        <Field label="District or neighbourhood" error={fields.district}><Input value={form.district} onChange={(e) => set('district', e.target.value)} /></Field>
        <Field label="Street" error={fields.street}><Input required value={form.street} onChange={(e) => set('street', e.target.value)} autoComplete="address-line1" /></Field>
        <Field label="Building number" error={fields.buildingNumber}><Input required value={form.buildingNumber} onChange={(e) => set('buildingNumber', e.target.value)} /></Field>
        <Field label="Apartment or unit" error={fields.unit}><Input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
        <Field label="Postcode" error={fields.postcode} hint="6 digits, or the 11-character digital postcode (for example FC 02 A09 DB 09).">
          <Input required value={form.postcode} onChange={(e) => set('postcode', e.target.value)} autoComplete="postal-code" />
        </Field>
      </div>
      <Field label="Additional information" error={fields.additionalInfo}><Textarea value={form.additionalInfo} onChange={(e) => set('additionalInfo', e.target.value)} maxLength={240} /></Field>
      {live.data && <ValidationPanel validation={live.data.validation} />}
      <GpsButton onFix={(g) => { setGps(g); toast.success(`Location captured (about ${g.accuracyMeters} m). It is saved when you save the address.`) }} />
      {gps && <p className="text-xs text-mute">Location fix ready, accurate to about {gps.accuracyMeters} m.</p>}
      <ErrorNote error={save.error && Object.keys(fields).length === 0 ? save.error : null} />
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} className="flex-1">{address ? 'Save changes' : 'Save and validate'}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

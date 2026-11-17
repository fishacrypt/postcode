import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner, formatDateTime, statusTone } from '@/components/ui'
import { api, ApiError, CLAIM_LABELS, type ClaimField } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { actionLabel } from './OverviewPage'

const formValue = (f: FormData, k: string): string => {
  const v = f.get(k)
  return typeof v === 'string' ? v : ''
}

export function HistoryPage() {
  const q = useQuery({
    queryKey: ['verification-history'],
    queryFn: () => api.get<{ history: { id: string; channel: string; outcome: string; fields: ClaimField[]; business: string | null; createdAt: string }[] }>('/verification-history'),
  })
  const CHANNEL: Record<string, string> = { public_link: 'Verification link', presentation: 'Credential file', business_api: 'Business API', business_dashboard: 'Business dashboard' }
  return (
    <>
      <PageHeader title="Verification history" subtitle="Every time someone checked one of your credentials. Addresses are never recorded here." />
      {q.isLoading && <Spinner />}
      {q.data?.history.length === 0 && <EmptyState icon={<ScanSearch className="h-6 w-6" />} title="No verifications yet" body="When someone opens one of your links or a business reads an approved disclosure, it appears here." />}
      <Card className={q.data?.history.length ? '' : 'hidden'}>
        <ul className="divide-y divide-line text-sm">
          {q.data?.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium">{h.business ?? CHANNEL[h.channel] ?? h.channel}</p>
                <p className="text-xs text-mute">{h.fields.length ? `Saw: ${h.fields.map((f) => CLAIM_LABELS[f] ?? f).join(', ')}` : 'No address fields shown'}</p>
              </div>
              <div className="flex items-center gap-2"><Badge tone={statusTone(h.outcome)}>{h.outcome}</Badge><span className="text-xs text-mute">{formatDateTime(h.createdAt)}</span></div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

export function SecurityPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ sessions: { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean }[] }>('/security/sessions') })
  const events = useQuery({ queryKey: ['security-events'], queryFn: () => api.get<{ events: { id: string; action: string; createdAt: string }[] }>('/security/events') })
  const end = useMutation({
    mutationFn: (id: string) => api.del(`/security/sessions/${id}`),
    onSuccess: () => { toast.success('Session signed out.'); void qc.invalidateQueries({ queryKey: ['sessions'] }) },
  })
  const resend = useMutation({ mutationFn: () => api.post('/auth/resend-verification'), onSuccess: () => toast.success('Verification email sent.') })
  return (
    <>
      <PageHeader title="Security" subtitle="Manage your password, sessions and review account events." />
      <div className="space-y-6">
        {!user?.emailVerified && (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Your email is not verified yet.</p>
            <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>Resend verification email</Button>
          </Card>
        )}
        <PasswordForm />
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold"><Laptop className="h-4 w-4 text-accent" aria-hidden /> Active sessions</h2>
          <ul className="divide-y divide-line text-sm">
            {sessions.data?.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{(s.userAgent ?? 'Unknown device').slice(0, 70)}</p>
                  <p className="text-xs text-mute">Signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastSeenAt)}</p>
                </div>
                {s.current ? <Badge tone="ok">This device</Badge> : <Button variant="secondary" loading={end.isPending && end.variables === s.id} onClick={() => end.mutate(s.id)}>Sign out</Button>}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Security events</h2>
          <ul className="divide-y divide-line text-sm">
            {events.data?.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5"><span>{actionLabel(e.action)}</span><span className="text-xs text-mute">{formatDateTime(e.createdAt)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

function PasswordForm() {
  const [done, setDone] = useState(false)
  const m = useMutation({
    mutationFn: (f: FormData) => api.post('/account/password', { currentPassword: formValue(f, 'current'), newPassword: formValue(f, 'next') }),
    onSuccess: () => { setDone(true); toast.success('Password changed. Other sessions were signed out.') },
  })
  const fields = m.error instanceof ApiError ? m.error.fields : {}
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setDone(false); m.mutate(new FormData(e.currentTarget)) }
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Change password</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password" error={fields.currentPassword}><Input name="current" type="password" required autoComplete="current-password" /></Field>
        <Field label="New password" error={fields.newPassword} hint="At least 12 characters with upper case, lower case and a number."><Input name="next" type="password" required minLength={12} autoComplete="new-password" /></Field>
        <div className="sm:col-span-2">
          <ErrorNote error={m.error && Object.keys(fields).length === 0 ? m.error : null} />
          <Button type="submit" loading={m.isPending} disabled={done}>{done ? 'Password changed' : 'Change password'}</Button>
        </div>
      </form>
    </Card>
  )
}

export function SettingsPage() {
  const { user, refresh, signOut } = useAuth()
  const [name, setName] = useState(user?.displayName ?? '')
  const save = useMutation({ mutationFn: () => api.put('/account/profile', { displayName: name }), onSuccess: () => { toast.success('Profile saved.'); void refresh() } })
  const remove = useMutation({
    mutationFn: (password: string) => api.post('/account/delete', { password }),
    onSuccess: () => { toast.success('Account deleted.'); void signOut() },
  })
  const [password, setPassword] = useState('')
  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile and account." />
      <div className="space-y-6">
        <Card className="space-y-4">
          <h2 className="font-semibold">Profile</h2>
          <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Email"><Input value={user?.email ?? ''} readOnly disabled /></Field>
          <ErrorNote error={save.error} />
          <Button loading={save.isPending} disabled={!name.trim() || name === user?.displayName} onClick={() => save.mutate()}>Save profile</Button>
        </Card>
        <Card className="space-y-4 border-bad/30">
          <h2 className="font-semibold text-bad">Delete account</h2>
          <p className="text-sm text-mute">Deletes your account, addresses, credentials and links. Revoke any active credential first. This cannot be undone.</p>
          <Field label="Confirm with your password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <ErrorNote error={remove.error} />
          <Button variant="danger" disabled={!password} loading={remove.isPending} onClick={() => { if (window.confirm('Delete your account permanently?')) remove.mutate(password) }}>Delete my account</Button>
        </Card>
      </div>
    </>
  )
}

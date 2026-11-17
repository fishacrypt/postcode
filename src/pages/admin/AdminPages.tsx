import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge, Button, Card, ErrorNote, PageHeader, Select, Spinner, formatDateTime, statusTone } from '@/components/ui'
import { api, errorMessage, type Role } from '@/lib/api'
import { actionLabel } from '@/pages/app/OverviewPage'

export function AdminUsers() {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<{ users: { id: string; email: string; role: Role; status: string; emailVerified: boolean; createdAt: string }[] }>('/admin/users') })
  const role = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api.post(`/admin/users/${v.id}/role`, { role: v.role }),
    onSuccess: () => { toast.success('Role updated. Their sessions were ended.'); void qc.invalidateQueries({ queryKey: ['admin-users'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const status = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'suspended' }) => api.post(`/admin/users/${v.id}/status`, { status: v.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <>
      <PageHeader title="Users" subtitle="Assign roles and suspend accounts. Every change is written to the audit log." />
      {users.isLoading && <Spinner />}
      <ErrorNote error={users.error} />
      <Card>
        <ul className="divide-y divide-line text-sm">
          {users.data?.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="truncate font-medium">{u.email}</p><p className="text-xs text-mute">{u.emailVerified ? 'Email verified' : 'Email unverified'} · joined {formatDateTime(u.createdAt)}</p></div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(u.status === 'active' ? 'active' : 'revoked')}>{u.status}</Badge>
                <Select className="w-32" aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => role.mutate({ id: u.id, role: e.target.value as Role })}>
                  {['user', 'business', 'issuer', 'admin'].map((r) => <option key={r}>{r}</option>)}
                </Select>
                <Button variant="secondary" onClick={() => status.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}>{u.status === 'active' ? 'Suspend' : 'Restore'}</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

export function AdminBusinesses() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin-businesses'], queryFn: () => api.get<{ businesses: { id: string; name: string; status: string; ownerEmail: string; activeKeys: number; requests: number; createdAt: string }[] }>('/admin/businesses') })
  const status = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'suspended' }) => api.post(`/admin/businesses/${v.id}/status`, { status: v.status }),
    onSuccess: () => { toast.success('Business updated.'); void qc.invalidateQueries({ queryKey: ['admin-businesses'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <>
      <PageHeader title="Businesses" subtitle="Suspending a business revokes all of its API keys immediately." />
      {q.isLoading && <Spinner />}
      <Card>
        <ul className="divide-y divide-line text-sm">
          {q.data?.businesses.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="font-medium">{b.name}</p><p className="text-xs text-mute">{b.ownerEmail} · {b.activeKeys} active keys · {b.requests} requests</p></div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(b.status === 'active' ? 'active' : 'revoked')}>{b.status}</Badge>
                <Button variant="secondary" onClick={() => status.mutate({ id: b.id, status: b.status === 'active' ? 'suspended' : 'active' })}>{b.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

export function AdminSystem() {
  const health = useQuery({ queryKey: ['admin-health'], queryFn: () => api.get<{ database: string; latestMigration: string | null; postcodeDataset: string; registry: string; mailer: string; encryptionKeyVersion: number; counts: { users: number; credentials: number; activeCredentials: number; sessions: number } }>('/admin/health') })
  const activity = useQuery({ queryKey: ['admin-activity'], queryFn: () => api.get<{ activity: { day: string; channel: string; outcome: string; count: number }[] }>('/admin/verification-activity') })
  const h = health.data
  return (
    <>
      <PageHeader title="System and activity" subtitle="Configuration state and verification activity. No personal data is shown." />
      {health.isLoading && <Spinner />}
      {h && (
        <Card className="mb-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Database', h.database], ['Latest migration', h.latestMigration ?? 'none'], ['Postcode dataset', h.postcodeDataset],
              ['Onchain registry', h.registry], ['Email delivery', h.mailer === 'dev' ? 'development mode' : h.mailer], ['Encryption key version', String(h.encryptionKeyVersion)],
              ['Accounts', String(h.counts.users)], ['Active credentials', `${h.counts.activeCredentials} of ${h.counts.credentials}`], ['Live sessions', String(h.counts.sessions)],
            ].map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-[0.06em] text-mute">{k}</dt><dd className="mt-0.5 font-medium">{v}</dd></div>)}
          </dl>
        </Card>
      )}
      <Card className="space-y-3">
        <h2 className="font-semibold">Verification activity, last 14 days</h2>
        {activity.data?.activity.length === 0 && <p className="text-sm text-mute">No verification activity.</p>}
        <ul className="divide-y divide-line text-sm">
          {activity.data?.activity.map((a) => <li key={`${a.day}${a.channel}${a.outcome}`} className="flex justify-between py-2"><span>{a.day} · {a.channel.replaceAll('_', ' ')}</span><span className="flex items-center gap-2"><Badge tone={statusTone(a.outcome)}>{a.outcome}</Badge>{a.count}</span></li>)}
        </ul>
      </Card>
    </>
  )
}

export function AdminAudit() {
  const q = useQuery({ queryKey: ['admin-audit'], queryFn: () => api.get<{ events: { id: string; userId: string | null; actorRole: string | null; action: string; createdAt: string }[] }>('/admin/audit') })
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only security and account events. Contains no address data." />
      {q.isLoading && <Spinner />}
      <Card>
        <ul className="divide-y divide-line text-sm">
          {q.data?.events.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{actionLabel(e.action)} <Badge>{e.actorRole ?? 'system'}</Badge> <span className="font-mono text-xs text-mute">{e.userId?.slice(0, 8)}</span></span><span className="text-xs text-mute">{formatDateTime(e.createdAt)}</span></li>)}
        </ul>
      </Card>
    </>
  )
}

export function IssuerCredentials() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['issuer-creds'], queryFn: () => api.get<{ credentials: { id: string; status: string; issuedAt: string; expiresAt: string; assurance: number }[] }>('/issuer/credentials') })
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/issuer/credentials/${id}/revoke`, { reason: 'Revoked by issuer review' }),
    onSuccess: () => { toast.success('Credential revoked.'); void qc.invalidateQueries({ queryKey: ['issuer-creds'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <>
      <PageHeader title="Issued credentials" subtitle="Metadata only. Issuers never see address values. Revoke a credential that was issued in error or used to deceive." />
      {q.isLoading && <Spinner />}
      <Card>
        <ul className="divide-y divide-line text-sm">
          {q.data?.credentials.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="font-mono text-xs">{c.id}</p><p className="text-xs text-mute">Level {c.assurance} · issued {formatDateTime(c.issuedAt)}</p></div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                {c.status === 'active' && <Button variant="secondary" loading={revoke.isPending && revoke.variables === c.id} onClick={() => { if (window.confirm('Revoke this credential?')) revoke.mutate(c.id) }}>Revoke</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

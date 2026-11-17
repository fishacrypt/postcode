import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileBadge2, History, MapPin, ShieldCheck, UserCheck } from 'lucide-react'
import { Badge, Card, PageHeader, Spinner, formatDateTime, statusTone } from '@/components/ui'
import { api, ASSURANCE_LABELS, type Address, type Credential } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.account_locked': 'Account temporarily locked',
  'auth.password_reset': 'Password reset',
  'account.registered': 'Account created',
  'account.email_verified': 'Email verified',
  'account.password_changed': 'Password changed',
  'account.profile_updated': 'Profile updated',
  'address.created': 'Address added',
  'address.updated': 'Address updated',
  'address.deleted': 'Address deleted',
  'address.gps_confirmed': 'Device location confirmed',
  'credential.issued': 'Credential issued',
  'credential.revoked': 'Credential revoked',
  'credential.renewed': 'Credential renewed',
  'credential.anchored': 'Credential anchored onchain',
  'credential.downloaded': 'Credential file downloaded',
  'verification_link.created': 'Verification link created',
  'verification_link.revoked': 'Verification link revoked',
  'consent.granted': 'Consent granted to a business',
  'security.session_revoked': 'Session signed out',
}
export const actionLabel = (a: string): string => ACTION_LABELS[a] ?? a

export function OverviewPage() {
  const { user } = useAuth()
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<{ addresses: Address[] }>('/addresses') })
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: () => api.get<{ credentials: Credential[] }>('/credentials') })
  const events = useQuery({ queryKey: ['security-events'], queryFn: () => api.get<{ events: { id: string; action: string; createdAt: string }[] }>('/security/events') })

  if (addresses.isLoading || credentials.isLoading) return <Spinner />
  const a = addresses.data?.addresses ?? []
  const c = credentials.data?.credentials ?? []
  const activeCred = c.find((x) => x.status === 'active')
  const bestAssurance = a.length ? Math.max(...a.map((x) => x.assuranceLevel)) : null

  return (
    <>
      <PageHeader title={`Welcome, ${user?.displayName.split(' ')[0] ?? ''}`} subtitle="Your address credentials at a glance." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatusCard icon={<MapPin />} label="Address" value={a.length ? `${a.length} saved` : 'None yet'} sub={bestAssurance === null ? 'Add an address to begin' : ASSURANCE_LABELS[bestAssurance]} to="/app/address" />
        <StatusCard icon={<FileBadge2 />} label="Credential" value={activeCred ? 'Active' : c.length ? 'None active' : 'Not issued'} sub={activeCred ? `Expires ${new Date(activeCred.expiresAt).toLocaleDateString('en-GB')}` : 'Issue one from a validated address'} tone={activeCred ? 'active' : undefined} to="/app/credentials" />
        <StatusCard icon={<UserCheck />} label="Email" value={user?.emailVerified ? 'Verified' : 'Not verified'} sub={user?.emailVerified ? 'You can issue credentials' : 'Verify to issue credentials'} tone={user?.emailVerified ? 'active' : 'pending'} to="/app/security" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-accent" aria-hidden /> Recent activity</h2>
          {events.data?.events.length ? (
            <ul className="divide-y divide-line text-sm">
              {events.data.events.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>{actionLabel(e.action)}</span>
                  <span className="text-xs text-mute">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">Nothing yet. Activity on your account appears here.</p>
          )}
        </Card>
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Quick actions</h2>
          <div className="flex flex-col gap-2 text-sm">
            <QuickLink to="/app/address" label={a.length ? 'Manage your address' : 'Add your address'} />
            <QuickLink to="/app/credentials" label="Issue or share a credential" />
            <QuickLink to="/app/privacy" label="Answer a business request" />
            <QuickLink to="/app/security" label="Review security settings" />
          </div>
        </Card>
      </div>
    </>
  )
}

function StatusCard({ icon, label, value, sub, tone, to }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: string; to: string }) {
  return (
    <Link to={to} className="block">
      <Card className="h-full space-y-2 transition-colors hover:bg-soft/40">
        <div className="flex items-center justify-between text-mute"><span className="text-xs font-semibold uppercase tracking-[0.08em]">{label}</span><span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5">{icon}</span></div>
        <p className="font-display text-2xl font-semibold">{tone ? <Badge tone={statusTone(tone)}>{value}</Badge> : value}</p>
        <p className="text-sm text-mute">{sub}</p>
      </Card>
    </Link>
  )
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="flex min-h-11 items-center rounded-xl border border-line px-3 font-medium hover:bg-soft">{label}</Link>
}

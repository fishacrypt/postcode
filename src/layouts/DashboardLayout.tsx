import { useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { MailWarning, Menu, X } from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/Logo'
import { Button, Spinner, cn } from '@/components/ui'
import { api, errorMessage, type Role } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

export function DashboardLayout({ roles, nav, title }: { roles: Role[]; nav: NavItem[]; title: string }) {
  const { user, loading, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!roles.includes(user.role)) return <Navigate to="/" replace />

  const item = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-mute hover:bg-soft hover:text-ink',
      isActive && 'bg-soft text-ink',
    )
  const list = (
    <nav className="flex flex-col gap-1" aria-label={title}>
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={item} onClick={() => setOpen(false)}>
          <span className="h-5 w-5 shrink-0 [&>svg]:h-5 [&>svg]:w-5">{n.icon}</span>
          {n.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="hidden border-r border-line bg-paper p-4 lg:flex lg:flex-col lg:justify-between">
        <div className="space-y-6">
          <Logo to="/" />
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.08em] text-mute">{title}</p>
          {list}
        </div>
        <AccountBox onSignOut={() => void signOut()} name={user.displayName} email={user.email} />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
          <Logo to="/" />
          <button className="flex min-h-11 min-w-11 items-center justify-center" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle navigation">
            {open ? <X /> : <Menu />}
          </button>
        </header>
        {open && (
          <div className="border-b border-line bg-paper p-4 lg:hidden">
            {list}
            <div className="mt-4 border-t border-line pt-4">
              <AccountBox onSignOut={() => void signOut()} name={user.displayName} email={user.email} />
            </div>
          </div>
        )}
        <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 lg:pt-10">
          {!user.emailVerified && <VerifyBanner />}
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function AccountBox({ name, email, onSignOut }: { name: string; email: string; onSignOut: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-canvas p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="truncate text-xs text-mute">{email}</p>
      </div>
      <Button variant="secondary" className="w-full" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  )
}

function VerifyBanner() {
  const resend = async () => {
    try {
      await api.post('/auth/resend-verification')
      toast.success('Verification email sent.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm">
      <MailWarning className="h-5 w-5 text-warn" aria-hidden />
      <p className="min-w-0 flex-1">Verify your email to issue credentials or create API keys.</p>
      <Button variant="secondary" onClick={() => void resend()}>
        Resend email
      </Button>
    </div>
  )
}

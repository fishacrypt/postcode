import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button, cn } from '@/components/ui'
import { homeFor, useAuth } from '@/lib/auth'

const NAV = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/features', label: 'Features' },
  { to: '/privacy-security', label: 'Privacy and security' },
  { to: '/business-solutions', label: 'For business' },
  { to: '/docs', label: 'Documentation' },
  { to: '/faq', label: 'FAQ' },
]

export function PublicLayout() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-3 py-2 text-sm font-medium text-mute hover:text-ink', isActive && 'text-ink')
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={link}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            {user ? (
              <Link to={homeFor(user.role)}>
                <Button>Open dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost">Sign in</Button>
                </Link>
                <Link to="/register">
                  <Button>Get Started</Button>
                </Link>
              </>
            )}
          </div>
          <button className="flex min-h-11 min-w-11 items-center justify-center rounded-lg lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle menu">
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-line bg-canvas px-4 pb-4 lg:hidden" aria-label="Mobile">
            <div className="flex flex-col py-2">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={cn(link({ isActive: false }), 'min-h-11 py-3')} onClick={() => setOpen(false)}>
                  {n.label}
                </NavLink>
              ))}
            </div>
            <div className="flex gap-2">
              {user ? (
                <Link to={homeFor(user.role)} className="flex-1" onClick={() => setOpen(false)}>
                  <Button className="w-full">Open dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link to="/login" className="flex-1" onClick={() => setOpen(false)}>
                    <Button variant="secondary" className="w-full">Sign in</Button>
                  </Link>
                  <Link to="/register" className="flex-1" onClick={() => setOpen(false)}>
                    <Button className="w-full">Get Started</Button>
                  </Link>
                </>
              )}
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-paper pb-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="space-y-3">
            <Logo />
            <p className="max-w-xs text-sm text-mute">Your Address. Verified. Yours.</p>
          </div>
          <FooterCol title="Product" links={[['/how-it-works', 'How it works'], ['/features', 'Features'], ['/business-solutions', 'For business'], ['/docs', 'API documentation']]} />
          <FooterCol title="Trust" links={[['/privacy-security', 'Privacy and security'], ['/privacy', 'Privacy policy'], ['/terms', 'Terms of service']]} />
          <FooterCol title="Company" links={[['/faq', 'FAQ'], ['/contact', 'Contact']]} />
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-6 text-xs text-mute sm:px-6">
          PostcodeProof confirms that an address credential was issued and is valid. It is not proof of residence and is not a government service.
        </p>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-mute">{title}</h2>
      <ul className="space-y-1">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="inline-flex min-h-9 items-center text-sm text-ink hover:text-accent">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

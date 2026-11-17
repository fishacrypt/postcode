import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui'
import { homeFor, useAuth } from '@/lib/auth'

export function PublicLayout() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
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
          <FooterCol title="Product" links={[['/how-it-works', 'How it works'], ['/features', 'Features'], ['/business-solutions', 'For business'], ['/docs', 'Documentation']]} />
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

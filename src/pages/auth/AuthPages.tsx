import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button, Card, ErrorNote, Field, Input, Spinner, cn } from '@/components/ui'
import { api, ApiError, type User } from '@/lib/api'
import { homeFor, useAuth } from '@/lib/auth'

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8">
      <Logo />
      <div className="mt-8 w-full max-w-md space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-mute">{subtitle}</p>}
        </div>
        <Card>{children}</Card>
      </div>
    </div>
  )
}

function useSubmit<T>(run: (form: FormData) => Promise<T>, onDone: (r: T) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fields = error instanceof ApiError ? error.fields : {}
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      onDone(await run(form))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, fields, submit: (e: FormEvent<HTMLFormElement>) => void submit(e) }
}

const str = (f: FormData, k: string): string => (typeof f.get(k) === 'string' ? (f.get(k) as string) : '')

export function Login() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const s = useSubmit(
    (f) => api.post<{ user: User }>('/auth/login', { email: str(f, 'email'), password: str(f, 'password') }),
    (r) => {
      void refresh().then(() => navigate(location.state?.from ?? homeFor(r.user.role), { replace: true }))
    },
  )
  if (user) return <Navigate to={homeFor(user.role)} replace />
  return (
    <Shell title="Welcome back" subtitle="Sign in to manage your address credentials.">
      <form onSubmit={s.submit} className="space-y-4">
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
        <ErrorNote error={s.error} />
        <Button type="submit" loading={s.busy} className="w-full">Sign in</Button>
        <div className="flex justify-between text-sm">
          <Link className="text-accent" to="/forgot-password">Forgot password?</Link>
          <Link className="text-accent" to="/register">Create account</Link>
        </div>
      </form>
    </Shell>
  )
}

export function Register() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<'user' | 'business'>('user')
  const s = useSubmit(
    (f) =>
      api.post<{ user: User }>('/auth/register', {
        email: str(f, 'email'),
        password: str(f, 'password'),
        displayName: str(f, 'displayName'),
        role,
        businessName: role === 'business' ? str(f, 'businessName') : undefined,
      }),
    (r) => {
      void refresh().then(() => navigate(homeFor(r.user.role), { replace: true }))
    },
  )
  if (user) return <Navigate to={homeFor(user.role)} replace />
  return (
    <Shell title="Create your account" subtitle="Your address stays yours. Start with an account.">
      <form onSubmit={s.submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-1" role="radiogroup" aria-label="Account type">
          {(['user', 'business'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn('min-h-11 rounded-lg text-sm font-semibold', role === r ? 'bg-paper shadow-card' : 'text-mute')}
            >
              {r === 'user' ? 'Individual' : 'Business'}
            </button>
          ))}
        </div>
        <Field label="Your name" error={s.fields.displayName}><Input name="displayName" required autoComplete="name" /></Field>
        {role === 'business' && <Field label="Business name" error={s.fields.businessName}><Input name="businessName" required /></Field>}
        <Field label="Email" error={s.fields.email}><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" error={s.fields.password} hint="At least 12 characters with upper case, lower case and a number.">
          <Input name="password" type="password" required minLength={12} autoComplete="new-password" />
        </Field>
        <ErrorNote error={s.error && Object.keys(s.fields).length === 0 ? s.error : null} />
        <Button type="submit" loading={s.busy} className="w-full">Create account</Button>
        <p className="text-center text-sm text-mute">
          Already registered? <Link className="text-accent" to="/login">Sign in</Link>
        </p>
        <p className="text-center text-xs text-mute">
          By continuing you agree to the <Link className="underline" to="/terms">Terms</Link> and <Link className="underline" to="/privacy">Privacy policy</Link>.
        </p>
      </form>
    </Shell>
  )
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const s = useSubmit((f) => api.post('/auth/forgot-password', { email: str(f, 'email') }), () => setSent(true))
  return (
    <Shell title="Reset your password" subtitle="Enter your email and we will send a reset link if an account exists.">
      {sent ? (
        <p className="text-sm">If an account exists for that email, a reset link is on its way. It expires in 30 minutes.</p>
      ) : (
        <form onSubmit={s.submit} className="space-y-4">
          <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
          <ErrorNote error={s.error} />
          <Button type="submit" loading={s.busy} className="w-full">Send reset link</Button>
        </form>
      )}
    </Shell>
  )
}

/** The one-time token arrives in the URL fragment, so it is never sent to a server or logged. */
const fragmentToken = (): string => window.location.hash.replace(/^#/, '')

export function ResetPassword() {
  const [done, setDone] = useState(false)
  const s = useSubmit((f) => api.post('/auth/reset-password', { token: fragmentToken(), password: str(f, 'password') }), () => setDone(true))
  return (
    <Shell title="Choose a new password">
      {done ? (
        <div className="space-y-3 text-sm">
          <p>Your password was changed and every session was signed out.</p>
          <Link to="/login"><Button className="w-full">Sign in</Button></Link>
        </div>
      ) : (
        <form onSubmit={s.submit} className="space-y-4">
          <Field label="New password" error={s.fields.password} hint="At least 12 characters with upper case, lower case and a number.">
            <Input name="password" type="password" required minLength={12} autoComplete="new-password" />
          </Field>
          <ErrorNote error={s.error && !s.fields.password ? s.error : null} />
          <Button type="submit" loading={s.busy} className="w-full">Change password</Button>
        </form>
      )}
    </Shell>
  )
}

export function VerifyEmail() {
  const [state, setState] = useState<'idle' | 'working' | 'ok' | 'error'>('idle')
  const { refresh } = useAuth()
  const run = async () => {
    setState('working')
    try {
      await api.post('/auth/verify-email', { token: fragmentToken() })
      await refresh()
      setState('ok')
    } catch {
      setState('error')
    }
  }
  return (
    <Shell title="Verify your email">
      {state === 'ok' ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden /> Email verified.</p>
          <Link to="/app"><Button className="w-full">Continue</Button></Link>
        </div>
      ) : state === 'working' ? (
        <Spinner label="Verifying" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-mute">Confirm that this is your email address.</p>
          {state === 'error' && <ErrorNote error={new Error('This link is invalid or has expired. Request a new one from your dashboard.')} />}
          <Button className="w-full" onClick={() => void run()}>Verify email</Button>
        </div>
      )}
    </Shell>
  )
}

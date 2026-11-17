import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-ink',
  secondary: 'bg-paper text-ink border border-line hover:bg-soft',
  ghost: 'text-ink hover:bg-soft',
  danger: 'bg-bad text-white hover:opacity-90',
}

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6', className)}>{children}</section>
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-mute">{hint}</span>}
      {error && (
        <span role="alert" className="block text-xs font-medium text-bad">
          {error}
        </span>
      )}
    </label>
  )
}

const control =
  'min-h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink placeholder:text-mute/70 focus:border-accent focus:outline-none disabled:bg-canvas'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(control, className)} />
}
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cn(control, className)} />
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(control, 'min-h-24 py-2', className)} />
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info'
const TONES: Record<Tone, string> = {
  neutral: 'bg-canvas text-mute border-line',
  ok: 'bg-ok/10 text-ok border-ok/20',
  warn: 'bg-warn/10 text-warn border-warn/20',
  bad: 'bg-bad/10 text-bad border-bad/20',
  info: 'bg-soft text-accent border-accent/20',
}
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', TONES[tone])}>{children}</span>
}

export function statusTone(status: string): Tone {
  if (['active', 'valid', 'approved', 'matched', 'consistent', 'confirmed', 'anchored'].includes(status)) return 'ok'
  if (['revoked', 'invalid', 'declined', 'inconsistent', 'cancelled'].includes(status)) return 'bad'
  if (['expired', 'pending', 'low_accuracy', 'dataset_unavailable', 'not_found'].includes(status)) return 'warn'
  return 'neutral'
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-mute">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}…
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paper/60 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-accent">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-mute">{body}</p>
      {action}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  return (
    <p role="alert" className="rounded-xl border border-bad/20 bg-bad/5 px-3 py-2 text-sm text-bad">
      {message}
    </p>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-mute">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-paper p-5 shadow-card sm:max-w-lg sm:rounded-3xl sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm text-mute hover:bg-soft" aria-label="Close dialog">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value))
}
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

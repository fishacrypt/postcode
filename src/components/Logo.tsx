import { Link } from 'react-router-dom'

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#14213D" />
      <path d="M16 6.5c-4.1 0-7.2 3-7.2 7 0 4.6 5.1 9.5 6.5 10.8.4.4 1 .4 1.4 0 1.4-1.3 6.5-6.2 6.5-10.8 0-4-3.1-7-7.2-7Z" fill="#EAF0F8" />
      <path d="m12.8 13.7 2.2 2.2 4.3-4.3" stroke="#3B6FB6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center gap-2.5" aria-label="PostcodeProof home">
      <LogoMark />
      <span className="font-display text-lg font-semibold tracking-tight">PostcodeProof</span>
    </Link>
  )
}

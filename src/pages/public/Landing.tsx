import { Link } from 'react-router-dom'
import { ArrowRight, Building2, EyeOff, FileCheck2, Fingerprint, KeyRound, MapPinned, ShieldCheck, UserRound } from 'lucide-react'
import { Button, Card } from '@/components/ui'

const STEPS = [
  { icon: MapPinned, title: 'Add and validate your address', body: 'Enter your Nigerian address. Your postcode is checked for format, then against a postcode dataset when one is available.' },
  { icon: FileCheck2, title: 'Receive a signed credential', body: 'After you consent, PostcodeProof issues a cryptographically signed credential. Your address values stay encrypted.' },
  { icon: EyeOff, title: 'Share only what is needed', body: 'Create a link or QR code that reveals just the fields you choose, for as long as you choose.' },
]

export function Landing() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24 lg:pt-20">
        <div className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-mute">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden /> Nigeria first
          </p>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">Your Address. Verified. Yours.</h1>
          <p className="max-w-xl text-lg text-mute">
            Create and manage a secure digital address credential. Verify what matters and share only what is necessary.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/register">
              <Button className="px-6">
                Get Started <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link to="/how-it-works">
              <Button variant="secondary" className="px-6">
                How It Works
              </Button>
            </Link>
          </div>
        </div>
        <CredentialPreview />
      </section>

      <section className="border-y border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">How PostcodeProof works</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Card key={s.title} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-soft text-accent">
                    <s.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-mute">Step {i + 1}</span>
                </div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-mute">{s.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-tight">Address validation you can read honestly</h2>
            <p className="text-mute">
              PostcodeProof reports each check on its own: postcode format, dataset match, geographic consistency and an optional device location fix.
              A well-formed postcode is never presented as a verified one.
            </p>
            <p className="text-mute">
              A credential confirms that an address was validated and signed by PostcodeProof. It is not proof of residence, and every credential says so.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Feature icon={Fingerprint} title="Digital address credentials" body="Signed, expiring and revocable, with salted commitments instead of plain values." />
            <Feature icon={KeyRound} title="Privacy-first verification" body="Street-level details are encrypted at rest and never placed onchain." />
            <Feature icon={UserRound} title="For individuals" body="See who asked, what you shared and withdraw consent at any time." />
            <Feature icon={Building2} title="For businesses" body="Request only the fields you need and receive only what the holder approves." />
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-brand text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Start with a credential you control.</h2>
            <p className="mt-2 max-w-xl text-white/70">Create an account, add an address and decide exactly what to share.</p>
          </div>
          <Link to="/register">
            <Button variant="secondary" className="px-6">
              Get Started
            </Button>
          </Link>
        </div>
      </section>
    </>
  )
}

function Feature({ icon: Icon, title, body }: { icon: typeof Fingerprint; title: string; body: string }) {
  return (
    <Card className="space-y-2">
      <Icon className="h-5 w-5 text-accent" aria-hidden />
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-mute">{body}</p>
    </Card>
  )
}

/** Product-shaped illustration. Values are placeholders, labelled as such. */
function CredentialPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-label="Illustration of a shared credential">
      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-mute">Address credential</span>
          <span className="rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-semibold text-ok">Valid</span>
        </div>
        <dl className="space-y-3 text-sm">
          <Row label="Country" value="Nigeria" shared />
          <Row label="State" value="Example State" shared />
          <Row label="Local Government Area" value="Hidden by holder" />
          <Row label="Street" value="Hidden by holder" />
        </dl>
        <p className="border-t border-line pt-3 text-xs text-mute">Illustration only. Real credentials show what the holder chose to share.</p>
      </Card>
    </div>
  )
}

function Row({ label, value, shared }: { label: string; value: string; shared?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-mute">{label}</dt>
      <dd className={shared ? 'font-medium' : 'text-mute/70'}>{value}</dd>
    </div>
  )
}

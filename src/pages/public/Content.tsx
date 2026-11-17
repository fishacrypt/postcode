import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, ErrorNote, Field, Input, Textarea } from '@/components/ui'
import { api, ApiError, errorMessage } from '@/lib/api'

function Page({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      {intro && <p className="mt-3 max-w-2xl text-lg text-mute">{intro}</p>}
      <div className="mt-10 space-y-6">{children}</div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm text-mute">{children}</div>
    </Card>
  )
}

export function HowItWorks() {
  const steps: [string, string][] = [
    ['Register', 'Create an account and verify your email.'],
    ['Add an address', 'Enter your Nigerian address and postcode. You can optionally confirm your device location.'],
    ['Review validation', 'See each check separately: format, dataset match, geographic consistency and location fix.'],
    ['Consent and issue', 'Review what the credential covers and consent. PostcodeProof signs it and stores the values encrypted.'],
    ['Share what is needed', 'Create a link or QR code that reveals only the fields you choose, or approve a business request.'],
    ['Stay in control', 'Revoke links or the credential, renew before expiry and review every verification.'],
  ]
  return (
    <Page title="How it works" intro="From address entry to a shareable credential in six steps.">
      <ol className="space-y-3">
        {steps.map(([t, b], i) => (
          <li key={t}>
            <Card className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soft font-display font-semibold text-accent">{i + 1}</span>
              <div>
                <h2 className="font-semibold">{t}</h2>
                <p className="text-sm text-mute">{b}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </Page>
  )
}

export function Features() {
  return (
    <Page title="Features" intro="Everything needed to create, manage and verify an address credential.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Layered address validation"><p>Format, dataset match, geographic consistency and GPS are separate results. None is merged into a single yes or no.</p></Block>
        <Block title="Signed credentials"><p>Credentials are signed by the issuer, expire after a year and can be revoked or renewed.</p></Block>
        <Block title="Selective disclosure"><p>Each claim is committed with its own salt, so revealing the state says nothing about the street.</p></Block>
        <Block title="Links and QR codes"><p>Opaque, expiring, revocable links. Optional single-use links prevent replay.</p></Block>
        <Block title="Consent records"><p>Every disclosure records who asked, why, which fields and when. Consent can be withdrawn.</p></Block>
        <Block title="Business API"><p>Hashed API keys with scopes, rate limits and usage reporting. No endpoint looks up an address.</p></Block>
        <Block title="Optional onchain anchoring"><p>Anchor a hash of your credential to a registry so its status can be checked independently. No personal data goes onchain.</p></Block>
        <Block title="Country-ready architecture"><p>Nigeria is the only active country. Other countries need their own module before they can be enabled.</p></Block>
      </div>
    </Page>
  )
}

export function PrivacySecurity() {
  return (
    <Page title="Privacy and security" intro="Privacy is the default. Disclosure is a decision you make.">
      <Block title="What is stored and how">
        <p>Street, building, unit, district, notes and GPS coordinates are encrypted with AES-256-GCM before they reach the database, with versioned keys that can be rotated.</p>
        <p>Passwords are hashed with Argon2id. Session tokens, API keys, email links and verification links are stored only as hashes.</p>
      </Block>
      <Block title="What is never onchain">
        <p>Addresses, GPS coordinates, emails, phone numbers and plaintext credentials never leave the database. The optional registry stores a hash of the credential, an identifier, the holder wallet and the expiry.</p>
      </Block>
      <Block title="What a verifier can learn">
        <p>Scanning a QR code reveals only the fields the holder chose, never a full address, and only until the link expires or is revoked.</p>
      </Block>
      <Block title="What a credential does not prove">
        <p>A credential shows that an address was validated and signed. It does not independently prove that someone lives there. A GPS fix shows where a device was at one moment.</p>
      </Block>
    </Page>
  )
}

export function BusinessSolutions() {
  return (
    <Page title="For business" intro="Confirm an address credential with the holder's consent, without receiving a full address.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Consent-based requests"><p>Ask for specific fields with a stated purpose. The holder approves, narrows or declines.</p></Block>
        <Block title="Minimal results"><p>You receive only approved fields plus the credential status and assurance level.</p></Block>
        <Block title="API keys and scopes"><p>Create keys limited to creating requests, reading results or verifying presentations. Revoke them at any time.</p></Block>
        <Block title="Usage and history"><p>See request history and API usage per key.</p></Block>
      </div>
      <Link to="/register"><Button>Create a business account</Button></Link>
    </Page>
  )
}

export function Faq() {
  const items: [string, string][] = [
    ['Is a PostcodeProof credential proof of residence?', 'No. It shows an address was validated and a credential was issued. It does not establish that you live there.'],
    ['Which countries are supported?', 'Nigeria only in this release. The architecture is country-independent, but no other country is active.'],
    ['Does PostcodeProof confirm that my postcode exists?', 'It checks the format always, and checks a postcode dataset when one is loaded. If no dataset is available, the result says so instead of guessing.'],
    ['What are the two postcode formats?', 'The established six-digit NIPOST postcode and the new 11-character digital postcode, for example FC 02 A09 DB 09.'],
    ['Who can see my address?', 'Only you. Verifiers see the fields you choose. Street-level fields need an extra confirmation before they can be shared.'],
    ['Can I withdraw consent?', 'Yes. Revoke a link or the whole credential from your dashboard.'],
    ['Is anything stored onchain?', 'Only if you choose to anchor a credential: a hash, an identifier, your wallet and the expiry. Never address data.'],
  ]
  return (
    <Page title="Frequently asked questions">
      <div className="space-y-3">
        {items.map(([q, a]) => (
          <details key={q} className="group rounded-2xl border border-line bg-paper p-5 shadow-card">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}</summary>
            <p className="mt-3 text-sm text-mute">{a}</p>
          </details>
        ))}
      </div>
    </Page>
  )
}

export function Contact() {
  const [state, setState] = useState<{ done: boolean; error: unknown; fields: Record<string, string> }>({ done: false, error: null, fields: {} })
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    try {
      await api.post('/contact', { name: form.get('name'), email: form.get('email'), message: form.get('message') })
      setState({ done: true, error: null, fields: {} })
      toast.success('Message sent.')
    } catch (err) {
      setState({ done: false, error: err, fields: err instanceof ApiError ? err.fields : {} })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page title="Contact" intro="Questions about credentials, privacy or integrating the API.">
      {state.done ? (
        <Card><p className="font-medium">Thanks. We have your message and will reply by email.</p></Card>
      ) : (
        <Card>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <Field label="Name" error={state.fields.name}><Input name="name" required autoComplete="name" /></Field>
            <Field label="Email" error={state.fields.email}><Input name="email" type="email" required autoComplete="email" /></Field>
            <Field label="Message" error={state.fields.message}><Textarea name="message" required maxLength={2000} /></Field>
            {state.error != null && !Object.keys(state.fields).length && <ErrorNote error={state.error} />}
            <Button type="submit" loading={busy}>Send message</Button>
          </form>
        </Card>
      )}
    </Page>
  )
}

export function PrivacyPolicy() {
  return (
    <Page title="Privacy policy" intro="A plain-language summary. Have counsel review this text before launch.">
      <Block title="What we collect"><p>Account details (email, display name), the addresses you enter, credentials, consent records and security events.</p></Block>
      <Block title="How we protect it"><p>Sensitive address fields are encrypted at rest. Passwords and tokens are stored as hashes. Public verification logs never contain addresses.</p></Block>
      <Block title="Who sees it"><p>Verifiers see only the fields you approve. We do not sell personal data.</p></Block>
      <Block title="Your choices"><p>You can edit or delete addresses, revoke credentials and links, withdraw consent and delete your account from Settings.</p></Block>
      <Block title="Retention"><p>Deleting an address removes its encrypted values. Revoked or expired credentials keep only their signed public record.</p></Block>
    </Page>
  )
}

export function Terms() {
  return (
    <Page title="Terms of service" intro="A working draft. Have counsel review this text before launch.">
      <Block title="Service"><p>PostcodeProof issues address credentials after validating an address you provide. It is not a government service.</p></Block>
      <Block title="No proof of residence"><p>A credential is not proof that you live at an address. Relying parties decide what to accept.</p></Block>
      <Block title="Your responsibilities"><p>Provide accurate information, keep your credentials secure and do not use the service to mislead others.</p></Block>
      <Block title="Revocation"><p>We may revoke a credential that was issued in error or used to deceive.</p></Block>
      <Block title="Availability"><p>The service is provided as is during this release. Postcode coverage depends on the datasets loaded.</p></Block>
    </Page>
  )
}

export { errorMessage }

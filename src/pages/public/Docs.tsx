import { Card } from '@/components/ui'

const GROUPS: { title: string; rows: [string, string, string][] }[] = [
  {
    title: 'Authentication (browser session)',
    rows: [
      ['POST', '/auth/register', 'Create an account (user or business).'],
      ['POST', '/auth/login', 'Sign in. Sets an HttpOnly session cookie.'],
      ['POST', '/auth/logout', 'End the session.'],
      ['POST', '/auth/refresh', 'Rotate the session token.'],
      ['GET', '/auth/me', 'Current user.'],
      ['POST', '/auth/verify-email', 'Confirm an email with the emailed token.'],
      ['POST', '/auth/forgot-password', 'Request a reset email. Always answers 200.'],
      ['POST', '/auth/reset-password', 'Set a new password. Ends all sessions.'],
    ],
  },
  {
    title: 'Postcodes',
    rows: [
      ['GET', '/postcodes/:code', 'Layered validation of a postcode. Public and rate limited.'],
      ['GET', '/postcodes/dataset', 'Dataset availability and sources.'],
    ],
  },
  {
    title: 'Business API (Bearer API key)',
    rows: [
      ['POST', '/businesses/verification-requests', 'Scope verification:create. Returns a one-time code to give to the holder.'],
      ['GET', '/businesses/verification-requests/:id', 'Scope verification:read. Request status.'],
      ['POST', '/verify/disclosure', 'Scope verification:read. Fields the holder approved.'],
      ['POST', '/verify/credential', 'Verify a presentation file. Public.'],
    ],
  },
]

const CREATE = `curl -X POST https://YOUR_HOST/api/v1/businesses/verification-requests \\
  -H "Authorization: Bearer pp_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"reference":"order-1001","purpose":"Confirm delivery area","requestedFields":["state","lga"]}'`

const RESPONSE = `{ "request": { "id": "…", "code": "K7QX2M9P", "status": "pending",
  "requestedFields": ["state","lga"], "expiresAt": "2026-11-20T10:00:00.000Z" } }`

export function Docs() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-3 max-w-2xl text-lg text-mute">
        The API is versioned under <code className="font-mono text-base">/api/v1</code>. Errors share one shape:{' '}
        <code className="font-mono text-sm">{'{ "error": { "code", "message", "fields?" } }'}</code>.
      </p>
      <div className="mt-10 space-y-6">
        {GROUPS.map((g) => (
          <Card key={g.title} className="space-y-3">
            <h2 className="text-lg font-semibold">{g.title}</h2>
            <ul className="divide-y divide-line text-sm">
              {g.rows.map(([m, p, d]) => (
                <li key={m + p} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="flex items-center gap-2">
                    <span className="w-14 rounded bg-soft px-1.5 py-0.5 text-center font-mono text-xs font-medium text-accent">{m}</span>
                    <code className="break-all font-mono text-xs">{p}</code>
                  </span>
                  <span className="text-mute sm:ml-auto">{d}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Consent flow</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-mute">
            <li>Your server creates a verification request and receives a one-time code.</li>
            <li>You give the code to the holder. They enter it in PostcodeProof, review the request and approve, narrow or decline.</li>
            <li>You call <code className="font-mono text-xs">POST /verify/disclosure</code> with the request id and receive only the approved fields.</li>
          </ol>
          <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-white">{CREATE}</pre>
          <pre className="overflow-x-auto rounded-xl bg-canvas p-4 font-mono text-xs leading-relaxed">{RESPONSE}</pre>
        </Card>
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">Limits you should expect</h2>
          <p className="text-sm text-mute">
            There is no endpoint that looks up an address. API keys are rate limited per key. Full request and response examples are in the repository at{' '}
            <code className="font-mono text-xs">docs/api/README.md</code>.
          </p>
        </Card>
      </div>
    </div>
  )
}

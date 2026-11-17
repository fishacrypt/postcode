import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { DashboardLayout } from '@/layouts/DashboardLayout'
import { PublicLayout } from '@/layouts/PublicLayout'
import { ValidationPanel } from '@/components/ValidationPanel'
import { Landing } from '@/pages/public/Landing'
import { Faq } from '@/pages/public/Content'
import { Login, Register } from '@/pages/auth/AuthPages'
import { VerifyPage } from '@/pages/public/VerifyPage'
import { PrivacyPage } from '@/pages/app/PrivacyPage'
import type { Validation } from '@/lib/api'
import { calls, mockApi, renderApp, USER } from './helpers'

const asInput = (el: HTMLElement): HTMLInputElement => {
  if (!(el instanceof HTMLInputElement)) throw new Error('not an input')
  return el
}
const asButton = (el: HTMLElement): HTMLButtonElement => {
  if (!(el instanceof HTMLButtonElement)) throw new Error('not a button')
  return el
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('public pages', () => {
  test('the landing page shows the brand promise and both calls to action', () => {
    mockApi({ 'GET /auth/me': { body: { user: null } } })
    renderApp(<Landing />)
    expect(screen.getByRole('heading', { name: 'Your Address. Verified. Yours.' })).toBeTruthy()
    expect(screen.getAllByText('Get Started').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('How It Works')).toBeTruthy()
    expect(screen.getByText(/Illustration only/)).toBeTruthy()
  })

  test('the FAQ is explicit that a credential is not proof of residence', () => {
    mockApi({ 'GET /auth/me': { body: { user: null } } })
    renderApp(<Faq />)
    expect(screen.getByText('Is a PostcodeProof credential proof of residence?')).toBeTruthy()
  })

  test('mobile navigation opens and lists the sections', () => {
    mockApi({ 'GET /auth/me': { body: { user: null } } })
    renderApp(
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<div>home</div>} />
        </Route>
      </Routes>,
    )
    expect(screen.queryByLabelText('Mobile')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    expect(screen.getByLabelText('Mobile')).toBeTruthy()
  })
})

describe('authentication forms', () => {
  test('business registration reveals the business name field', () => {
    mockApi({ 'GET /auth/me': { body: { user: null } } })
    renderApp(<Register />)
    expect(screen.queryByLabelText('Business name')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Business' }))
    expect(screen.getByLabelText('Business name')).toBeTruthy()
  })

  test('server-side field errors appear next to the field and the form keeps its values', async () => {
    mockApi({
      'GET /auth/me': { body: { user: null } },
      'POST /auth/register': { status: 422, body: { error: { code: 'validation_failed', message: 'Some fields need attention.', fields: { password: 'Use at least 12 characters.' } } } },
    })
    renderApp(<Register />)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Weakpassword12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByText('Use at least 12 characters.')).toBeTruthy())
    expect(asInput(screen.getByLabelText('Email')).value).toBe('ada@example.com')
  })

  test('a failed sign-in shows a generic message', async () => {
    mockApi({
      'GET /auth/me': { body: { user: null } },
      'POST /auth/login': { status: 401, body: { error: { code: 'invalid_credentials', message: 'Email or password is incorrect.' } } },
    })
    renderApp(<Login />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever-Password1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Email or password is incorrect.'))
    expect(calls.find((c) => c.path.endsWith('/auth/login'))).toBeTruthy()
  })
})

describe('dashboard access control', () => {
  const tree = (
    <Routes>
      <Route path="login" element={<div>login page</div>} />
      <Route path="/" element={<div>public home</div>} />
      <Route path="app" element={<DashboardLayout roles={['user']} nav={[]} title="Your account" />}>
        <Route index element={<div>secret dashboard</div>} />
      </Route>
    </Routes>
  )
  test('signed-out visitors are sent to login', async () => {
    mockApi({ 'GET /auth/me': { body: { user: null } } })
    renderApp(tree, '/app')
    await waitFor(() => expect(screen.getByText('login page')).toBeTruthy())
    expect(screen.queryByText('secret dashboard')).toBeNull()
  })
  test('the wrong role is sent away from the page', async () => {
    mockApi({ 'GET /auth/me': { body: { user: { ...USER, role: 'business' } } } })
    renderApp(tree, '/app')
    await waitFor(() => expect(screen.getByText('public home')).toBeTruthy())
  })
  test('the right role sees the page, with a prompt to verify email when needed', async () => {
    mockApi({ 'GET /auth/me': { body: { user: { ...USER, emailVerified: false } } } })
    renderApp(tree, '/app')
    await waitFor(() => expect(screen.getByText('secret dashboard')).toBeTruthy())
    expect(screen.getByText(/Verify your email/)).toBeTruthy()
  })
})

describe('postcode validation states', () => {
  const base: Validation = {
    format: { valid: true, normalised: '100001', format: 'legacy_6_digit', reason: null, statePrefix: null },
    dataset: { status: 'dataset_unavailable', record: null },
    geographic: { status: 'not_assessable', detail: 'No reference data.' },
    gps: { status: 'not_provided', accuracyMeters: null, capturedAt: null },
    proofOfResidence: 'not_established',
    assuranceLevel: 1,
  }
  test('a well-formed postcode with no dataset is reported as unchecked, never as verified', () => {
    renderApp(<ValidationPanel validation={base} />)
    expect(screen.getByText(/not checked/)).toBeTruthy()
    expect(screen.getByText(/Level 1: Format valid only/)).toBeTruthy()
    expect(screen.getByText('Not established')).toBeTruthy()
  })
  test('an inconsistent result is flagged', () => {
    renderApp(<ValidationPanel validation={{ ...base, dataset: { status: 'matched', record: null }, geographic: { status: 'inconsistent', detail: 'The postcode dataset places this postcode in Kano.' } }} />)
    expect(screen.getByText('The postcode dataset places this postcode in Kano.')).toBeTruthy()
  })
})

describe('public verification page', () => {
  const result = {
    status: 'valid', reference: 'abcd1234', issuedAt: '2026-11-01T00:00:00Z', expiresAt: '2027-11-01T00:00:00Z',
    issuer: { name: 'PostcodeProof', address: '0x1' }, assurance: { level: 1, label: 'Format valid only', gpsFix: false, datasetMatch: false },
    onchain: null, notice: 'This confirms an address credential was issued and is still valid. It does not prove that the holder lives at the address.',
    disclosed: [{ field: 'state', label: 'State', value: 'Lagos', sensitive: false }],
  }
  test('shows only the disclosed fields and the residence disclaimer', async () => {
    window.location.hash = '#sometoken'
    mockApi({ 'POST /verify/link': { body: result } })
    renderApp(<VerifyPage />)
    await waitFor(() => expect(screen.getByText('Credential is valid')).toBeTruthy())
    expect(screen.getByText('Lagos')).toBeTruthy()
    expect(screen.queryByText('Street')).toBeNull()
    expect(screen.getByText(/does not prove/)).toBeTruthy()
    expect((calls[0]?.body as { token: string }).token).toBe('sometoken')
  })
  test('revoked credentials are displayed as revoked', async () => {
    window.location.hash = '#sometoken'
    mockApi({ 'POST /verify/link': { body: { ...result, status: 'revoked', disclosed: [] } } })
    renderApp(<VerifyPage />)
    await waitFor(() => expect(screen.getByText('Credential was revoked')).toBeTruthy())
  })
  test('unavailable links give one generic message', async () => {
    window.location.hash = '#sometoken'
    mockApi({ 'POST /verify/link': { status: 404, body: { error: { code: 'link_unavailable', message: 'x' } } } })
    renderApp(<VerifyPage />)
    await waitFor(() => expect(screen.getByText('Link unavailable')).toBeTruthy())
  })
})

describe('consent flow', () => {
  test('the holder sees who is asking, and street-level fields need an explicit acknowledgement', async () => {
    mockApi({
      'GET /credentials': { body: { credentials: [{ id: 'c1', status: 'active', expiresAt: '2027-11-01T00:00:00Z', address: { lga: 'Ikeja', state: 'Lagos' } }] } },
      'GET /links': { body: { links: [] } },
      'GET /consents': { body: { consents: [] } },
      'POST /verify/requests/preview': {
        body: { request: { business: 'Shop Ltd', purpose: 'Confirm delivery area', reference: 'o-1', expiresAt: '2026-12-01T00:00:00Z',
          requestedFields: [{ field: 'state', label: 'State', sensitive: false }, { field: 'street', label: 'Street', sensitive: true }] } },
      },
      'POST /verify/consent': { body: { decision: 'approved' } },
    })
    renderApp(<PrivacyPage />)
    fireEvent.change(await screen.findByLabelText('Request code'), { target: { value: 'ABCD2345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }))
    await waitFor(() => expect(screen.getByText(/Shop Ltd/)).toBeTruthy())
    expect(screen.getByText('Purpose: Confirm delivery area (reference o-1)')).toBeTruthy()
    // The sensitive field starts unchecked and the share button works for the non-sensitive default.
    const street = screen.getByRole('checkbox', { name: /Street/ }) as HTMLInputElement
    expect(street.checked).toBe(false)
    fireEvent.click(street)
    const share = screen.getByRole('button', { name: 'Share selected fields' }) as HTMLButtonElement
    expect(share.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this business will see my street-level details/ }))
    await waitFor(() => expect(asButton(screen.getByRole('button', { name: 'Share selected fields' })).disabled).toBe(false))
  })
})

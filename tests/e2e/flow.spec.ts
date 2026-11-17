import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * End-to-end journeys. They need Chromium system libraries, which were NOT available in the Arc Studio sandbox,
 * so these specs have not been executed there. Run them locally with `bun run dev`, `bun run dev:api` and
 * `bun run test:e2e` (ENABLE_DEV_OUTBOX=true is required for email verification in development).
 */
const PASSWORD = 'Correct-Horse-9-Battery'
const unique = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

async function outboxToken(page: Page, email: string, kind: string): Promise<string> {
  const res = await page.request.get(`/api/v1/dev/outbox?email=${encodeURIComponent(email)}`)
  const body = (await res.json()) as { messages: { kind: string; token: string }[] }
  const token = body.messages.find((m) => m.kind === kind)?.token
  if (!token) throw new Error(`no ${kind} email for ${email}`)
  return token
}

async function register(page: Page, email: string, opts: { business?: string } = {}): Promise<void> {
  await page.goto('/register')
  if (opts.business) {
    await page.getByRole('radio', { name: 'Business' }).click()
    await page.getByLabel('Business name').fill(opts.business)
  }
  await page.getByLabel('Your name').fill('E2E Person')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(opts.business ? /\/business/ : /\/app/)
  const token = await outboxToken(page, email, 'verify-email')
  await page.goto(`/verify-email#${token}`)
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page.getByText('Email verified.')).toBeVisible()
}

async function addAddressAndIssue(page: Page): Promise<void> {
  await page.goto('/app/address')
  await page.getByRole('button', { name: 'Add address' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('State').selectOption('Lagos')
  await dialog.getByLabel('Local Government Area').selectOption('Ikeja')
  await dialog.getByLabel('City or town').fill('Ikeja')
  await dialog.getByLabel('Street', { exact: true }).fill('12 Private Close')
  await dialog.getByLabel('Building number').fill('12')
  await dialog.getByLabel('Postcode').fill('100001')
  await expect(dialog.getByText('Validation result')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save and validate' }).click()
  await expect(page.getByText('Proof of residence')).toBeVisible()
  await expect(page.getByText('Not established')).toBeVisible()

  await page.goto('/app/credentials')
  await page.getByRole('button', { name: 'Issue credential' }).first().click()
  const issue = page.getByRole('dialog')
  await issue.getByLabel('Address').selectOption({ index: 1 })
  await issue.getByRole('checkbox').check()
  await issue.getByRole('button', { name: 'Issue credential' }).click()
  await expect(page.getByText('Address credential').first()).toBeVisible()
}

async function createLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Share or QR/ }).click()
  const share = page.getByRole('dialog')
  await share.getByRole('button', { name: 'Create link and QR code' }).click()
  await expect(share.getByAltText('QR code for the verification link')).toBeVisible()
  const link = await share.getByLabel('Verification link').inputValue()
  expect(link).toContain('/verify#')
  return link.slice(link.indexOf('#'))
}

async function visitor(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage()
}

test('public pages render and navigate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your Address. Verified. Yours.' })).toBeVisible()
  await page.getByRole('link', { name: 'How It Works' }).first().click()
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await page.goto('/faq')
  await expect(page.getByText('Is a PostcodeProof credential proof of residence?')).toBeVisible()
})

test('protected pages redirect to login', async ({ page }) => {
  await page.goto('/app/credentials')
  await expect(page).toHaveURL(/\/login/)
})

test('holder journey: register, log in, address, credential, QR, verify, revoke', async ({ page, browser }) => {
  const email = unique('holder')
  await register(page, email)
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app/)

  await addAddressAndIssue(page)
  const fragment = await createLink(page)
  await page.getByRole('button', { name: 'Close dialog' }).click()

  const v = await visitor(browser)
  await v.goto(`/verify${fragment}`)
  await expect(v.getByText('Credential is valid')).toBeVisible()
  await expect(v.getByText('Lagos')).toBeVisible()
  await expect(v.getByText('Private Close')).toHaveCount(0)

  await page.getByRole('button', { name: /Revoke/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke credential' }).click()
  await expect(page.getByText('revoked').first()).toBeVisible()
  await v.goto(`/verify${fragment}`)
  await expect(v.getByText('Link unavailable')).toBeVisible()
})

test('business journey: request, consent, disclosure of only approved fields', async ({ page, browser }) => {
  const holderEmail = unique('holder2')
  await register(page, holderEmail)
  await addAddressAndIssue(page)

  const bizPage = await visitor(browser)
  await register(bizPage, unique('biz'), { business: 'E2E Shop' })
  await bizPage.getByRole('button', { name: /New request/ }).first().click()
  const dlg = bizPage.getByRole('dialog')
  await dlg.getByLabel('Your reference').fill('order-1')
  await dlg.getByLabel('Purpose shown to the holder').fill('Confirm delivery area')
  await dlg.getByRole('button', { name: 'Create request' }).click()
  const code = (await dlg.locator('span.font-mono').first().textContent())?.trim() ?? ''
  expect(code).toHaveLength(8)

  await page.goto('/app/privacy')
  await page.getByLabel('Request code').fill(code)
  await page.getByRole('button', { name: 'Review request' }).click()
  await expect(page.getByText('E2E Shop')).toBeVisible()
  await page.getByRole('checkbox', { name: 'State' }).uncheck()
  await page.getByRole('button', { name: 'Share selected fields' }).click()
  await expect(page.getByText('Shared with the business.')).toBeVisible()

  await bizPage.reload()
  await bizPage.getByRole('button', { name: 'View result' }).click()
  await expect(bizPage.getByText('Nigeria')).toBeVisible()
  await expect(bizPage.getByText('Lagos')).toHaveCount(0) // the holder withheld the state
})

test('mobile navigation works @mobile', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle menu' }).click()
  await page.getByRole('link', { name: 'FAQ' }).first().click()
  await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible()
})

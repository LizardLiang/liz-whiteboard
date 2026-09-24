// e2e/forgot-password.spec.ts
// End-to-end coverage for the self-service password reset flow: request a
// reset link, set a new password with a valid link, sign-out-everywhere on
// completion, and the invalid/expired/reused link states. Follows
// e2e/version-history.spec.ts's structure. Runs against a dedicated seeded
// user (E2E_RESET_USER), never E2E_USER — this suite changes a password and
// revokes sessions, which would otherwise break every other spec's login.
//
// The Turnstile widget on /forgot-password uses Cloudflare's published
// always-pass test site key (see .env.local / README.md "Configuration")
// and needs outbound network access to challenges.cloudflare.com for both
// the widget script and the server-side siteverify call.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_RESET_USER } from './fixtures'
import type { Page } from '@playwright/test'

// This suite exercises the login form and its own dedicated user directly —
// start with no session rather than the shared E2E_USER storageState saved
// by global-setup.
test.use({ storageState: { cookies: [], origins: [] } })

function seedResetUser(env: Record<string, string> = {}) {
  execFileSync('bun', ['run', 'e2e/seed-forgot-password.ts'], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

function generateRawToken(): string {
  return randomBytes(32).toString('hex')
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

async function submitForgotPassword(page: Page, email: string) {
  await page.goto('/forgot-password')
  // Not waitForLoadState('networkidle') here: the Turnstile widget keeps the
  // network busy (challenges.cloudflare.com polling), so networkidle never
  // resolves on this page. The heading wait plus pressSequentially below
  // (types character by character, giving hydration time to attach the
  // input's onChange) is enough — the actual robustness backstop is
  // forgot-password.tsx reading the form's live DOM value at submit time.
  await expect(
    page.getByRole('heading', { name: 'Forgot your password?' }),
  ).toBeVisible()

  // Type (not just fill) so React's controlled onChange fires post-hydration
  // — mirrors global-setup.ts's login flow.
  const emailField = page.getByRole('textbox', { name: 'Email' })
  await emailField.click()
  await emailField.pressSequentially(email)

  const sendButton = page.getByRole('button', { name: 'Send reset link' })
  // Turnstile's always-pass test widget calls back with a token shortly
  // after its script loads — no click needed. This wait covers the round
  // trip to challenges.cloudflare.com.
  await expect(sendButton).toBeEnabled({ timeout: 30_000 })
  await sendButton.click()
}

async function expectGenericResetMessage(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'If an account exists for that email, a reset link is on its way.',
    ),
  ).toBeVisible()
}

/**
 * Drives /reset-password?token=<rawToken> to completion: a weak password is
 * rejected with the length rule, a valid one submits and lands on the login
 * page's post-reset banner.
 */
async function completeReset(page: Page, rawToken: string, newPassword: string) {
  await page.goto(`/reset-password?token=${rawToken}`)
  await page.waitForLoadState('networkidle')
  await expect(
    page.getByRole('heading', { name: 'Set a new password' }),
  ).toBeVisible()

  const newPasswordField = page.getByRole('textbox', { name: 'New password' })
  const confirmField = page.getByRole('textbox', { name: 'Confirm password' })
  const submit = page.getByRole('button', { name: 'Update password' })

  await newPasswordField.fill('short')
  await confirmField.fill('short')
  await submit.click()
  await expect(
    page.getByText('Password must be at least 8 characters'),
  ).toBeVisible()

  await newPasswordField.fill(newPassword)
  await confirmField.fill(newPassword)
  await submit.click()

  await page.waitForURL(/\/login\?reset=success/)
  await page.waitForLoadState('networkidle')
  await expect(
    page.getByText('Password updated. Log in with your new password.'),
  ).toBeVisible()
}

async function loginAsResetUser(page: Page, password: string) {
  // Type (not just fill) so React's controlled onChange fires post-hydration
  // — mirrors global-setup.ts's login flow.
  const email = page.getByRole('textbox', { name: 'Email' })
  const passwordField = page.getByRole('textbox', { name: 'Password' })
  await email.click()
  await email.pressSequentially(E2E_RESET_USER.email)
  await passwordField.click()
  await passwordField.pressSequentially(password)
  const signIn = page.getByRole('button', { name: 'Sign in' })
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()
}

test.describe('Forgot password', () => {
  test.beforeEach(() => {
    seedResetUser()
  })

  test('(a) requesting a reset for a known email shows the generic message', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password/)

    await submitForgotPassword(page, E2E_RESET_USER.email)
    await expectGenericResetMessage(page)
  })

  test('(b) requesting a reset for an unknown email shows the identical message', async ({
    page,
  }) => {
    await submitForgotPassword(page, 'nobody-e2e-forgot-password@example.com')
    await expectGenericResetMessage(page)
  })

  test('(c) a valid link sets a new password; the old password stops working', async ({
    page,
  }) => {
    const rawToken = generateRawToken()
    seedResetUser({ RESET_TOKEN_HASH: hashToken(rawToken) })

    const newPassword = 'NewE2ePassword456!'
    await completeReset(page, rawToken, newPassword)

    await loginAsResetUser(page, newPassword)
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

    await page.context().clearCookies()
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await loginAsResetUser(page, E2E_RESET_USER.password)
    await expect(page.getByText('Invalid email or password')).toBeVisible()
  })

  test('(d) an already-used link shows the invalid-link message on a second open', async ({
    page,
  }) => {
    const rawToken = generateRawToken()
    seedResetUser({ RESET_TOKEN_HASH: hashToken(rawToken) })

    await completeReset(page, rawToken, 'FirstUseOnly789!')

    await page.goto(`/reset-password?token=${rawToken}`)
    await expect(
      page.getByRole('heading', { name: 'Link invalid' }),
    ).toBeVisible()
    await expect(
      page.getByText('This link is invalid or has expired.'),
    ).toBeVisible()
  })

  test('(e) an expired link shows the invalid-link message', async ({
    page,
  }) => {
    const rawToken = generateRawToken()
    seedResetUser({
      RESET_TOKEN_HASH: hashToken(rawToken),
      RESET_TOKEN_EXPIRES_IN_MS: '-1000',
    })

    await page.goto(`/reset-password?token=${rawToken}`)
    await expect(
      page.getByRole('heading', { name: 'Link invalid' }),
    ).toBeVisible()
    await expect(
      page.getByText('This link is invalid or has expired.'),
    ).toBeVisible()
  })

  test('(f) an active session for the reset user is signed out once the reset completes', async ({
    page,
    browser,
  }) => {
    const rawToken = generateRawToken()
    seedResetUser({ RESET_TOKEN_HASH: hashToken(rawToken) })

    // A second browser context, logged in as the reset user, before the
    // reset happens.
    const secondContext = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    const secondPage = await secondContext.newPage()
    await secondPage.goto('/login')
    await secondPage.waitForLoadState('networkidle')
    await loginAsResetUser(secondPage, E2E_RESET_USER.password)
    await secondPage.waitForURL((url) => url.pathname === '/')
    await expect(
      secondPage.getByRole('button', { name: 'Log out' }),
    ).toBeVisible()

    await completeReset(page, rawToken, 'SignedOutEverywhere321!')

    // The second context's session is revoked — its next navigation bounces
    // to /login (root beforeLoad's getCurrentUser check now fails).
    await secondPage.goto('/')
    await expect(secondPage).toHaveURL(/\/login/)

    await secondContext.close()
  })
})

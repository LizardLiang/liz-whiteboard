// e2e/security-audit-remaining.spec.ts
// End-to-end coverage for the remaining security-audit fixes:
//   signup   the register page answers the same for a new and an existing email;
//            the emailed link sets the password; a second request leaves the
//            first link usable; an expired, used or invalid link is refused.
//   login    5 failures raise the Turnstile challenge for a registered and for
//            an unknown email; the victim still logs in with a fresh token.
//   invite   the Share panel says "Invite sent" for an unknown email; a link
//            forwarded to another account is refused; the invited user accepts
//            and becomes a member.
//   comments the comment payload has no authorEmail.
//   CSP      the header has a nonce and no 'unsafe-inline' in script-src.
//
// Mail: the e2e server never sends mail. A signup or invite link carries a raw
// token that the app stores only as a SHA-256 hash, so this spec makes its own
// raw token and writes the hash to the test DB through e2e/seed-security-
// remaining.ts (Bun; the Playwright runner is Node and has no bun:sqlite).
//
// Turnstile: the login challenge widget needs Cloudflare's always-pass test
// keys (playwright.config.ts sets them for the dev stacks) and outbound network
// access to challenges.cloudflare.com.
//
// Prod/dev split: the CSP header exists only in the single-process prod build
// (server.prod.ts), so that block runs with E2E_PROD_BUILD=1 and
// E2E_BASE_URL=http://localhost:<port>, same as security-hardening.spec.ts.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { BASE_URL, IDS } from './fixtures'
import type { Browser, BrowserContext, Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const RUN = randomBytes(4).toString('hex')
const PASSWORD = 'SecAudit123!'
const emailOf = (name: string) => `sec-${name}-${RUN}@example.com`

function seed(op: string, args: Record<string, string | number> = {}): string {
  return execFileSync('bun', ['run', 'e2e/seed-security-remaining.ts', op], {
    env: { ...process.env, SEC_ARGS: JSON.stringify(args) },
    encoding: 'utf8',
  }).trim()
}

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  return { raw, hash: createHash('sha256').update(raw).digest('hex') }
}

function seedUser(name: string) {
  seed('user', {
    email: emailOf(name),
    username: `sec_${name}_${RUN}`,
    password: PASSWORD,
  })
}

/** Type character by character so React's onChange fires after hydration. */
async function typeInto(page: Page, label: string, value: string) {
  const field = page.getByRole('textbox', { name: label, exact: true })
  await field.click()
  await field.fill('')
  await field.pressSequentially(value)
}

async function submitLogin(page: Page, email: string, password: string) {
  await typeInto(page, 'Email', email)
  await typeInto(page, 'Password', password)
  const signIn = page.getByRole('button', { name: 'Sign in' })
  await expect(signIn).toBeEnabled({ timeout: 15_000 })
  await signIn.click()
}

async function expectSessionCookie(context: BrowserContext) {
  // Monotonic clock: the wall clock on this host steps by seconds.
  const deadline = performance.now() + 20_000
  while (performance.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === 'session_token' && c.value)) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('no session_token cookie after login')
}

/** A fresh browser context logged in as the given seeded account. */
async function loggedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1600, height: 1000 },
    locale: 'en-US',
  })
  const page = await context.newPage()
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await submitLogin(page, email, PASSWORD)
  await expectSessionCookie(context)
  return page
}

test.beforeAll(() => {
  seed('reset')
})
test.afterAll(() => {
  seed('reset')
})

test.describe('Signup by email link', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  async function register(page: Page, username: string, email: string) {
    await page.goto('/register')
    await page.waitForLoadState('networkidle')
    await typeInto(page, 'Username', username)
    await typeInto(page, 'Email', email)
    const create = page.getByRole('button', { name: 'Create account' })
    await expect(create).toBeEnabled({ timeout: 15_000 })
    await create.click()
    await expect(
      page.getByRole('heading', { name: 'Check your email' }),
    ).toBeVisible({ timeout: 20_000 })
  }

  async function replyOf(page: Page, email: string) {
    return {
      path: new URL(page.url()).pathname,
      body: (await page.locator('body').innerText())
        .split(email)
        .join('<email>'),
    }
  }

  test('a new and an existing email get the same reply', async ({ page }) => {
    seedUser('exists')
    const existing = emailOf('exists')
    const fresh = emailOf('fresh')

    await register(page, `sec_fresh_${RUN}`, fresh)
    const forNew = await replyOf(page, fresh)

    await register(page, `sec_other_${RUN}`, existing)
    const forExisting = await replyOf(page, existing)

    expect(forNew.path).toBe('/register/check-email')
    expect(forExisting).toEqual(forNew)
    // Registering did not create the account for the new email.
    expect(seed('hasuser', { email: fresh })).toBe('0')
  })

  test('the link sets the password; the used link is then refused', async ({
    page,
  }) => {
    const email = emailOf('setpw')
    const { raw, hash } = newToken()
    seed('signup', {
      email,
      username: `sec_setpw_${RUN}`,
      hash,
      ttlMs: 60 * 60 * 1000,
    })

    await page.goto(`/signup/${raw}`)
    await expect(
      page.getByRole('heading', { name: 'Finish signing up' }),
    ).toBeVisible({ timeout: 20_000 })
    await typeInto(page, 'Password', PASSWORD)
    await typeInto(page, 'Confirm password', PASSWORD)
    const submit = page.getByRole('button', { name: 'Create account' })
    await expect(submit).toBeEnabled({ timeout: 15_000 })
    await submit.click()
    await expectSessionCookie(page.context())
    expect(seed('hasuser', { email })).toBe('1')

    const again = await page.context().newPage()
    await again.context().clearCookies()
    await again.goto(`/signup/${raw}`)
    await expect(
      again.getByText('This link has already been used.'),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('a second request and a resend leave the first link usable', async ({
    page,
  }) => {
    const email = emailOf('twice')
    const first = newToken()
    seed('signup', {
      email,
      username: `sec_twice_${RUN}`,
      hash: first.hash,
      ttlMs: 60 * 60 * 1000,
    })

    await register(page, `sec_twice_${RUN}`, email)
    await page.getByRole('button', { name: 'Resend email' }).click()
    await expect(
      page.getByText('If that email can be used, a new message is on its way.'),
    ).toBeVisible({ timeout: 20_000 })

    await page.goto(`/signup/${first.raw}`)
    await expect(
      page.getByRole('heading', { name: 'Finish signing up' }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel('Confirm password')).toBeVisible()
  })

  test('an expired link and an unknown link are refused', async ({ page }) => {
    const expired = newToken()
    seed('signup', {
      email: emailOf('expired'),
      username: `sec_expired_${RUN}`,
      hash: expired.hash,
      ttlMs: -60 * 1000,
    })
    await page.goto(`/signup/${expired.raw}`)
    await expect(page.getByText('This link has expired.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByLabel('Confirm password')).toHaveCount(0)

    await page.goto(`/signup/${newToken().raw}`)
    await expect(page.getByText('This link is invalid.')).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('Login challenge after 5 failures', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  async function failFiveTimes(page: Page, email: string) {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    for (let i = 0; i < 5; i++) {
      await submitLogin(page, email, `wrong-password-${i}`)
      // The form is ready again once the failed attempt has answered.
      await expect(page.getByRole('alert').first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled({
        timeout: 20_000,
      })
    }
    // The 6th attempt, still without a token, is answered with the challenge.
    await submitLogin(page, email, 'wrong-password-6')
    await expect(page.getByTestId('login-challenge')).toBeVisible({
      timeout: 20_000,
    })
  }

  test('a registered email gets the challenge; the victim still logs in', async ({
    page,
  }) => {
    seedUser('victim')
    const email = emailOf('victim')
    await failFiveTimes(page, email)

    // The always-pass Turnstile widget supplies a token; the right password
    // then gets in.
    await typeInto(page, 'Password', PASSWORD)
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await expect(signIn).toBeEnabled({ timeout: 30_000 })
    await signIn.click()
    await expectSessionCookie(page.context())
  })

  test('an unknown email gets the same challenge', async ({ page }) => {
    await failFiveTimes(page, emailOf('nobody'))
    await expect(page.getByTestId('login-challenge')).toBeVisible()
  })

  // W4: a valid Turnstile token with a wrong password says the password was
  // wrong. It does not show "complete the check" again, and the widget stays.
  test('a wrong password after the check says so, and the widget stays', async ({
    page,
  }) => {
    seedUser('mistype')
    const email = emailOf('mistype')
    await failFiveTimes(page, email)

    await typeInto(page, 'Password', 'still-the-wrong-password')
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await expect(signIn).toBeEnabled({ timeout: 30_000 })
    await signIn.click()
    await expect(page.getByRole('alert').first()).toContainText(
      'Invalid email or password',
      { timeout: 20_000 },
    )
    await expect(page.getByRole('alert').first()).not.toContainText(
      'Complete the check',
    )
    await expect(page.getByTestId('login-challenge')).toBeVisible()

    // The next try with the right password still gets in.
    await typeInto(page, 'Password', PASSWORD)
    await expect(signIn).toBeEnabled({ timeout: 30_000 })
    await signIn.click()
    await expectSessionCookie(page.context())
  })
})

test.describe('Grant-by-email invites', () => {
  test('the Share panel says Invite sent for an unknown email', async ({
    page,
  }) => {
    await page.goto(`/project/${IDS.project}`)
    await expect(
      page.getByRole('heading', { name: 'E2E Project' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Share' }).click()
    await expect(
      page.getByRole('heading', { name: 'Share Project' }),
    ).toBeVisible()

    const unknown = emailOf('unknown-invitee')
    await page
      .getByRole('textbox', { name: 'Email address to invite' })
      .fill(unknown)
    await page.getByRole('button', { name: 'Send invite' }).click()

    await expect(page.getByText('Invite sent').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.getByRole('list', { name: 'Pending email invites' }),
    ).toContainText(unknown)
    expect(seed('hasuser', { email: unknown })).toBe('0')
  })

  // W2: after a revoke, a re-invite at once is stored (and sent), not swallowed.
  test('a revoke, then an immediate re-invite, shows the invite again', async ({
    page,
  }) => {
    await page.goto(`/project/${IDS.project}`)
    await page.getByRole('button', { name: 'Share' }).click()
    await expect(
      page.getByRole('heading', { name: 'Share Project' }),
    ).toBeVisible()
    const target = emailOf('revoke-again')
    const box = page.getByRole('textbox', { name: 'Email address to invite' })
    const pending = page.getByRole('list', { name: 'Pending email invites' })

    await box.fill(target)
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect(pending).toContainText(target, { timeout: 20_000 })

    await page
      .getByRole('button', { name: `Revoke invite for ${target}` })
      .click()
    await expect(pending).not.toContainText(target, { timeout: 20_000 })

    await box.fill(target)
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect(pending).toContainText(target, { timeout: 20_000 })
  })

  test('a forwarded link is refused, and the right user accepts', async ({
    browser,
  }) => {
    seedUser('invitee')
    seedUser('intruder')
    const { raw, hash } = newToken()
    seed('invite', {
      email: emailOf('invitee'),
      role: 'EDITOR',
      hash,
      ttlMs: 60 * 60 * 1000,
    })

    // The forwarded link, opened by another account: refused, no membership.
    const intruder = await loggedInPage(browser, emailOf('intruder'))
    await intruder.goto(`/invite/email/${raw}`)
    await expect(
      intruder.getByText(
        'This invite was sent to a different email address. Log in with the invited address.',
      ),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      intruder.getByRole('button', { name: 'Accept invite' }),
    ).toHaveCount(0)
    expect(seed('role', { email: emailOf('intruder') })).toBe('NONE')
    await intruder.context().close()

    // The invited user accepts and becomes a member.
    const invitee = await loggedInPage(browser, emailOf('invitee'))
    await invitee.goto(`/invite/email/${raw}`)
    const accept = invitee.getByRole('button', { name: 'Accept invite' })
    await expect(accept).toBeVisible({ timeout: 20_000 })
    await accept.click()
    await expect(invitee).toHaveURL(new RegExp(`/project/${IDS.project}`), {
      timeout: 20_000,
    })
    expect(seed('role', { email: emailOf('invitee') })).toBe('EDITOR')
    await invitee.context().close()
  })
})

test.describe('Invite return path through login and register (W3)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('invite -> login -> Register -> signup link -> back on the invite', async ({
    page,
  }) => {
    const newbie = emailOf('newbie')
    const invite = newToken()
    seed('invite', {
      email: newbie,
      role: 'VIEWER',
      hash: invite.hash,
      ttlMs: 60 * 60 * 1000,
    })
    const invitePath = `/invite/email/${invite.raw}`

    // A logged-out visitor lands on login with the invite as the return path.
    await page.goto(invitePath)
    await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 20_000 })
    await page.waitForLoadState('networkidle')

    // The Register link carries it on.
    await page.getByRole('link', { name: 'Register' }).click()
    await expect(page).toHaveURL(/\/register\?redirect=/, { timeout: 20_000 })
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(invitePath)
    await page.waitForLoadState('networkidle')

    // The register form passes it to the check-email page (and the signup token).
    await typeInto(page, 'Username', `sec_newbie_${RUN}`)
    await typeInto(page, 'Email', newbie)
    const create = page.getByRole('button', { name: 'Create account' })
    await expect(create).toBeEnabled({ timeout: 15_000 })
    await create.click()
    await expect(
      page.getByRole('heading', { name: 'Check your email' }),
    ).toBeVisible({ timeout: 20_000 })
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(invitePath)

    // The e2e server sends no mail: make the signup link the email would carry.
    const signup = newToken()
    seed('signup', {
      email: newbie,
      username: `sec_newbie2_${RUN}`,
      hash: signup.hash,
      redirectTo: invitePath,
      ttlMs: 60 * 60 * 1000,
    })
    await page.goto(`/signup/${signup.raw}`)
    await expect(
      page.getByRole('heading', { name: 'Finish signing up' }),
    ).toBeVisible({ timeout: 20_000 })
    await typeInto(page, 'Password', PASSWORD)
    await typeInto(page, 'Confirm password', PASSWORD)
    const submit = page.getByRole('button', { name: 'Create account' })
    await expect(submit).toBeEnabled({ timeout: 15_000 })
    await submit.click()
    await expect(page).toHaveURL(new RegExp(`${invitePath}$`), {
      timeout: 30_000,
    })
    await expect(
      page.getByRole('button', { name: 'Accept invite' }),
    ).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('Comment payload', () => {
  test('no authorEmail reaches the browser', async ({ page }) => {
    seedUser('author')
    const authorEmail = emailOf('author')
    seed('comment', { authorEmail, text: `from ${RUN}` })

    const bodies: Array<Promise<string>> = []
    page.on('response', (res) => {
      const url = res.url()
      if (
        url.includes('/_serverFn/') ||
        res.request().resourceType() === 'document'
      ) {
        bodies.push(res.text().catch(() => ''))
      }
    })
    await page.goto(`/whiteboard/${IDS.whiteboard}`)
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const texts = await Promise.all(bodies)
    expect(texts.some((t) => t.includes(`sec-audit-comment from ${RUN}`))).toBe(
      true,
    )
    for (const text of texts) {
      expect(text).not.toContain('authorEmail')
      expect(text).not.toContain(authorEmail)
    }
  })
})

test.describe('CSP nonce', () => {
  test.skip(
    !process.env.E2E_PROD_BUILD,
    'server.prod.ts sets the CSP header; the dev stack does not',
  )

  test('script-src has a per-request nonce and no unsafe-inline', async ({
    request,
  }) => {
    const first = await request.get(`${BASE_URL}/login`)
    const second = await request.get(`${BASE_URL}/login`)
    const csp = (res: typeof first) => res.headers()['content-security-policy']

    const scriptSrc = (value: string) =>
      value
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('script-src')) ?? ''

    const a = scriptSrc(csp(first))
    const b = scriptSrc(csp(second))
    expect(a).toMatch(/'nonce-[A-Za-z0-9+/=_-]{16,}'/)
    expect(a).not.toContain("'unsafe-inline'")
    expect(a).not.toContain("'unsafe-eval'")
    expect(a).not.toBe(b)

    // The page's inline scripts carry the nonce of that same response.
    const nonce = /'nonce-([^']+)'/.exec(a)?.[1]
    expect(await first.text()).toContain(`nonce="${nonce}"`)
  })
})

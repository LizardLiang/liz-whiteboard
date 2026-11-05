// e2e/login-redirect.spec.ts
// End-to-end coverage for the login redirect bounce fix (GH #115): after a
// successful login, a full browser navigation must land the user on the
// intended target immediately — no bounce back to /login and no manual
// reload required.
//
// Root cause: a client-side `router.navigate` does not re-run the root
// `beforeLoad` auth guard (the route is already matched), so its cached
// unauthenticated context redirected back to /login even though the
// session_token cookie had just been set. The fix routes every successful
// login through `window.location.assign(target)`, a full browser navigation
// that re-runs the guard server-side with the fresh cookie.
//
// This spec must start UNAUTHENTICATED — it exercises the login form itself
// — so it overrides the shared storageState saved by global-setup (which
// logs in a different, already-authenticated context for the rest of the
// suite).
import {  expect, test } from '@playwright/test'
import { E2E_USER, IDS } from './fixtures'
import type {Page} from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } })

async function loginWithRedirect(page: Page, redirectParam: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(redirectParam)}`)
  await page.waitForLoadState('networkidle')

  const email = page.getByRole('textbox', { name: 'Email' })
  const password = page.getByRole('textbox', { name: 'Password' })
  const signIn = page.getByRole('button', { name: 'Sign in' })

  // Type (not just fill) so React's controlled onChange fires post-hydration —
  // mirrors global-setup's login flow. The enablement wait is now ordering
  // only: the button stopped gating on emptiness (see auth-autofill.spec.ts).
  await email.click()
  await email.pressSequentially(E2E_USER.email)
  await password.click()
  await password.pressSequentially(E2E_USER.password)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()
}

test.describe('Login redirect (GH #115)', () => {
  test('redirect=/ lands on home with no manual reload', async ({ page }) => {
    await loginWithRedirect(page, '/')

    // Full navigation lands directly on / — no bounce back to /login and no
    // reload performed by the test.
    await page.waitForURL((url) => url.pathname === '/')

    // Authenticated shell (Header) is visible, proving the root beforeLoad
    // guard saw the freshly-set session cookie on this very navigation.
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    // The login form is gone (not merely hidden behind a bounce-and-flash).
    await expect(
      page.getByRole('textbox', { name: 'Email' }),
    ).not.toBeVisible()
  })

  test('redirect to a real authed route lands there directly', async ({
    page,
  }) => {
    const target = `/whiteboard/${IDS.whiteboard}`
    await loginWithRedirect(page, target)

    await page.waitForURL((url) => url.pathname === target)
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  // Open-redirect regression guard: window.location.assign (unlike the prior
  // router.navigate) honors absolute and protocol-relative URLs, so an
  // unvalidated `redirect` param could send a just-authenticated user off
  // origin. sanitizeRedirect must neutralize this before it ever reaches
  // window.location.assign. If sanitization is missing/broken, the browser
  // would navigate to the attacker origin and this test would fail to land
  // on pathname '/' (or would time out on a foreign origin).
  test('malicious redirect (absolute or protocol-relative) is neutralized, lands on / instead of attacker origin', async ({
    page,
  }) => {
    await loginWithRedirect(page, 'https://evil.example')

    // A sanitized redirect falls back to the safe default and stays
    // same-origin — an unsanitized redirect would send the browser to
    // https://evil.example and this would never resolve to pathname '/'.
    await page.waitForURL((url) => url.pathname === '/')
    expect(new URL(page.url()).host).not.toBe('evil.example')

    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'Email' }),
    ).not.toBeVisible()
  })

  // Expired-session landing: the server guard redirects a full page load to
  // /login, and an autofilled form can be submitted before React hydrates.
  // Without a guard the browser runs the form's native GET submit — the page
  // reloads to /login?email=…&password=… and the user must log in a second
  // time. The submit must wait for hydration, and no native submit may ever
  // put the password in a URL.
  test('submit before hydration does not reload /login or leak the password into the URL', async ({
    page,
  }) => {
    const navigations: Array<string> = []
    page.on('request', (r) => {
      if (r.isNavigationRequest()) navigations.push(r.url())
    })

    await page.goto('/', { waitUntil: 'commit' })
    await page.waitForSelector('#email', { state: 'attached' })
    await page.fill('#email', E2E_USER.email)
    await page.fill('#password', E2E_USER.password)
    // Enter right away — on the dev server this lands before hydration.
    await page.press('#password', 'Enter')

    // The hydrated form submits and lands on the target.
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

    expect(navigations.filter((u) => u.includes('password='))).toEqual([])
  })
})

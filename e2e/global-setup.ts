// e2e/global-setup.ts
// Runs once before the Playwright suite (under Node, NOT Bun):
//   1. Seeds a deterministic e2e user + whiteboard by shelling out to Bun
//      (bun:sqlite is unavailable in Playwright's Node runner).
//   2. Logs that user in through the real /login form and saves the resulting
//      `session_token` cookie to storageState, so specs start authenticated.
//
// The UI login is used (rather than injecting a cookie) so a real session is
// exercised. Note: the app's post-login client redirect can bounce back to
// /login (a known, pre-existing bug unrelated to version history); we don't
// depend on the redirect — we wait for the `session_token` cookie to be set,
// which happens regardless, then save state.
import { chromium, expect, type FullConfig } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { BASE_URL, E2E_USER, STORAGE_STATE } from './fixtures'

export default async function globalSetup(_config: FullConfig) {
  // 1. Seed via Bun.
  execFileSync('bun', ['run', 'e2e/seed.ts'], { stdio: 'inherit' })

  // 2. Log in and capture the session cookie.
  mkdirSync('e2e/.auth', { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')

  const email = page.getByRole('textbox', { name: 'Email' })
  const password = page.getByRole('textbox', { name: 'Password' })
  const signIn = page.getByRole('button', { name: 'Sign in' })

  // The submit button is disabled until the controlled email/password state is
  // populated. Type (not just set value) so React's onChange fires post-hydration,
  // and wait for the button to actually enable before clicking.
  await email.click()
  await email.pressSequentially(E2E_USER.email)
  await password.click()
  await password.pressSequentially(E2E_USER.password)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()

  // Wait until the HttpOnly session cookie exists (independent of any redirect).
  await expectSessionCookie(context)

  await context.storageState({ path: STORAGE_STATE })
  await browser.close()
}

async function expectSessionCookie(
  context: import('@playwright/test').BrowserContext,
) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === 'session_token' && c.value.length > 0)) {
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    'e2e global-setup: session_token cookie was never set after login',
  )
}

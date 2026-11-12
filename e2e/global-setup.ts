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
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'
import { E2E_USER, E2E_VIEWER_USER } from './fixtures'
import {
  slotDbPath,
  slotPorts,
  slotStorageState,
  slotViewerStorageState,
  usesExternalServer,
  workerCount,
} from './worker-slot'
import type { BrowserContext, FullConfig, Page } from '@playwright/test'

export default async function globalSetup(config: FullConfig) {
  // A --workers flag above the slot count would send workers to stacks that
  // do not exist. Set E2E_WORKERS instead.
  if (config.workers > workerCount()) {
    throw new Error(
      `e2e global-setup: ${config.workers} workers requested but only ${workerCount()} stacks are configured. Set E2E_WORKERS=${config.workers} instead of --workers.`,
    )
  }
  mkdirSync('e2e/.auth', { recursive: true })

  if (usesExternalServer()) {
    // One external server, one database (E2E_DB_PATH or data/app.db), one login.
    await seedAndLogin(
      process.env.E2E_BASE_URL as string,
      slotStorageState(0),
      slotViewerStorageState(0),
      process.env,
    )
    return
  }

  // One stack per worker slot, each with its own database and saved login.
  for (let i = 0; i < workerCount(); i++) {
    await seedAndLogin(
      `http://localhost:${slotPorts(i).web}`,
      slotStorageState(i),
      slotViewerStorageState(i),
      { ...process.env, E2E_DB_PATH: slotDbPath(i) },
    )
  }
}

async function seedAndLogin(
  baseUrl: string,
  storageStatePath: string,
  viewerStatePath: string,
  env: NodeJS.ProcessEnv,
) {
  // 1. Seed via Bun. seed-stress.ts creates the VIEWER user (seed.ts does not).
  execFileSync('bun', ['run', 'e2e/seed.ts'], { stdio: 'inherit', env })
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit', env })

  // 2. Log each user in ONCE and save the session. Specs reuse these files
  // instead of logging in per test: /login allows 30 attempts per 15 min per
  // IP, and in dev every client shares one bucket per server process.
  await loginAndSaveState(baseUrl, E2E_USER, storageStatePath)
  await loginAndSaveState(baseUrl, E2E_VIEWER_USER, viewerStatePath)
}

async function loginAndSaveState(
  baseUrl: string,
  user: { email: string; password: string },
  storageStatePath: string,
) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${baseUrl}/login`)
  await page.waitForLoadState('networkidle')

  const email = page.getByRole('textbox', { name: 'Email' })
  const password = page.getByRole('textbox', { name: 'Password' })
  const signIn = page.getByRole('button', { name: 'Sign in' })

  // Type character by character so React's controlled onChange fires, then
  // wait for the button before clicking. The submit button no longer gates on
  // emptiness (see auth-autofill.spec.ts — that gate left autofilled forms
  // permanently unsubmittable), so this wait is now just ordering, not a
  // workaround. Left as pressSequentially deliberately: every spec depends on
  // this setup and swapping it for fill() is unrelated risk.
  await email.click()
  await email.pressSequentially(user.email)
  await password.click()
  await password.pressSequentially(user.password)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()

  // Wait until the HttpOnly session cookie exists (independent of any redirect).
  await expectSessionCookie(context, page)

  await context.storageState({ path: storageStatePath })
  await browser.close()
}

async function expectSessionCookie(context: BrowserContext, page: Page) {
  // Monotonic clock on purpose. `Date.now()` is the wall clock, and a wall
  // clock that steps forward (WSL2 on this machine steps +15 s and back every
  // few seconds) ends a 15 s deadline at once, while the login is still
  // running ("Signing in...") and has set no cookie yet.
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === 'session_token' && c.value.length > 0)) {
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  // Say what the page showed (for example the IP rate limit's "Too many
  // attempts") so a refused login does not read as a mystery.
  const shown = await page
    .evaluate(() => document.body.innerText.slice(0, 400))
    .catch(() => '(page unreadable)')
  throw new Error(
    `e2e global-setup: session_token cookie was never set after login. Page ${page.url()} showed: ${JSON.stringify(shown)}`,
  )
}

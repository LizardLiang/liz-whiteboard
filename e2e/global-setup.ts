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
import { E2E_USER } from './fixtures'
import {
  slotDbPath,
  slotPorts,
  slotStorageState,
  usesExternalServer,
  workerCount,
} from './worker-slot'
import type { BrowserContext, FullConfig } from '@playwright/test'

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
      process.env,
    )
    return
  }

  // One stack per worker slot, each with its own database and saved login.
  for (let i = 0; i < workerCount(); i++) {
    await seedAndLogin(
      `http://localhost:${slotPorts(i).web}`,
      slotStorageState(i),
      { ...process.env, E2E_DB_PATH: slotDbPath(i) },
    )
  }
}

async function seedAndLogin(
  baseUrl: string,
  storageStatePath: string,
  env: NodeJS.ProcessEnv,
) {
  // 1. Seed via Bun.
  execFileSync('bun', ['run', 'e2e/seed.ts'], { stdio: 'inherit', env })

  // 2. Log in and capture the session cookie.
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
  await email.pressSequentially(E2E_USER.email)
  await password.click()
  await password.pressSequentially(E2E_USER.password)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()

  // Wait until the HttpOnly session cookie exists (independent of any redirect).
  await expectSessionCookie(context)

  await context.storageState({ path: storageStatePath })
  await browser.close()
}

async function expectSessionCookie(context: BrowserContext) {
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

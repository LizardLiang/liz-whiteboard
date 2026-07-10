// e2e/global-setup-collab.ts
// Global setup for the prod-build co-editing suite (GH #125). Runs once
// before playwright.coedit.config.ts's project:
//   1. Seeds two editors sharing one whiteboard by shelling out to Bun
//      (e2e/seed-collab.ts — bun:sqlite is unavailable in Playwright's Node
//      runner, same reason e2e/global-setup.ts shells out to e2e/seed.ts).
//   2. Logs BOTH alice and bob in through the real login form and saves their
//      session cookies to separate storageStates, so the spec can open two
//      independently-authenticated browser contexts against the same
//      whiteboard.
//
// User/password metadata is imported from e2e/seed-collab-constants.ts, NOT
// e2e/seed-collab.ts directly: seed-collab.ts top-level-imports 'bun:sqlite',
// and Playwright's own config/globalSetup loader runs under real Node — a
// static import reaching that 'bun:sqlite' import crashes Node's ESM loader
// ("Only URLs with a scheme in: file, data, and node are supported").
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'
import {
  COEDIT_ALICE_STORAGE_STATE,
  COEDIT_BASE_URL,
  COEDIT_BOB_STORAGE_STATE,
} from './fixtures-collab'
import { COLLAB_PASSWORD, COLLAB_USERS } from './seed-collab-constants'
import type { BrowserContext, FullConfig } from '@playwright/test'

export default async function globalSetupCollab(_config: FullConfig) {
  // 1. Seed via Bun.
  execFileSync('bun', ['run', 'e2e/seed-collab.ts'], { stdio: 'inherit' })

  mkdirSync('e2e/.auth', { recursive: true })

  const alice = COLLAB_USERS.find((u) => u.username === 'alice_collab')
  const bob = COLLAB_USERS.find((u) => u.username === 'bob_collab')
  if (!alice || !bob) {
    throw new Error(
      'e2e global-setup-collab: expected alice_collab and bob_collab in COLLAB_USERS',
    )
  }

  await loginAndSaveState(alice.email, COEDIT_ALICE_STORAGE_STATE)
  await loginAndSaveState(bob.email, COEDIT_BOB_STORAGE_STATE)
}

async function loginAndSaveState(email: string, storageStatePath: string) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: COEDIT_BASE_URL })
  const page = await context.newPage()

  await page.goto(`${COEDIT_BASE_URL}/login`)
  await page.waitForLoadState('networkidle')

  const emailInput = page.getByRole('textbox', { name: 'Email' })
  const passwordInput = page.getByRole('textbox', { name: 'Password' })
  const signIn = page.getByRole('button', { name: 'Sign in' })

  // Type (not just set value) so React's onChange fires post-hydration, and
  // wait for the submit button to actually enable before clicking — mirrors
  // e2e/global-setup.ts.
  await emailInput.click()
  await emailInput.pressSequentially(email)
  await passwordInput.click()
  await passwordInput.pressSequentially(COLLAB_PASSWORD)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()

  await expectSessionCookie(context, email)

  await context.storageState({ path: storageStatePath })
  await browser.close()
}

async function expectSessionCookie(
  context: BrowserContext,
  email: string,
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
    `e2e global-setup-collab: session_token cookie was never set for ${email}`,
  )
}

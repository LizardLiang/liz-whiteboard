// e2e/viewer-session.ts
// Opens a page signed in as the seeded VIEWER member (E2E_VIEWER_USER) from the
// session that global-setup.ts saved for the stack, instead of a login form per
// test.
//
// Why: /login counts every attempt against a per-IP limit of 30 per 15 min
// (src/lib/auth/auth-limits.ts). In dev the server cannot see the peer address,
// so every browser shares one bucket ("unknown") per server process. A suite
// that logs in once per viewer test spends that bucket, and on a long-lived
// server the next logins fail with no cookie. One login per user per stack
// keeps the suite far below the limit.
//
// The explicit storage state is load-bearing: a bare `browser.newContext()`
// inherits the config's ADMIN session, and a "read-only" test would then run
// against an owner.
import { existsSync } from 'node:fs'
import { BASE_URL } from './fixtures'
import { slotIndex, slotViewerStorageState } from './worker-slot'
import type { Browser, Page } from '@playwright/test'

export async function openViewerPage(browser: Browser): Promise<Page> {
  const storageState = slotViewerStorageState(slotIndex())
  if (!existsSync(storageState)) {
    throw new Error(
      `e2e: viewer session ${storageState} is missing. global-setup.ts writes it.`,
    )
  }
  const context = await browser.newContext({ baseURL: BASE_URL, storageState })
  return context.newPage()
}

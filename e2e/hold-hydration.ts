// e2e/hold-hydration.ts
// Holds back every script request of a page until the test releases them, so
// the server-rendered HTML stays un-hydrated for as long as the test needs.
// Returns the release function. Call it before the page can close.
import type { Page } from '@playwright/test'

export async function holdClientScripts(page: Page): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*', async (route) => {
    try {
      if (route.request().resourceType() === 'script') await gate
      await route.continue()
    } catch {
      // The page closed while the request was held.
    }
  })
  return release
}

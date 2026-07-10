// e2e/react-hooks-deps.spec.ts
// End-to-end coverage for Issue #130 (register eslint-plugin-react-hooks,
// fix 8+ hidden exhaustive-deps violations). Exercises the theme-persistence
// flow, whose corrected hook is src/hooks/use-theme.tsx: the mount-only
// effect that seeds theme from localStorage was rewritten with a functional
// setState update to drop its (deliberately excluded) `theme` dependency
// instead of comparing against the closed-over value. This spec proves that
// fix didn't change behavior: toggling still flips the DOM class immediately,
// and a reload still resolves the persisted choice (not a silent revert to
// the default). Two tests cover both toggle directions explicitly (starting
// theme is seeded via localStorage before navigation, not left to Chromium's
// ambient color-scheme default) so both branches are exercised deterministically.
//
// Chosen over the column-add (AddColumnRow) fallback because it is
// deterministic, requires no socket/collaboration state (dev's Socket.IO
// `io` is null — see playwright.config.ts note), and directly exercises a
// corrected hook end-to-end. Auth + seed data come from global-setup
// (storageState), matching e2e/version-history.spec.ts.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  // Canvas ready: the react-flow pane has rendered the seeded tables.
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
}

// Seeds the persisted theme choice before the app's first script runs, so
// each test starts from a known, deterministic state instead of depending on
// Chromium's ambient color-scheme default (see use-theme.tsx: `getStoredTheme`
// reads localStorage key 'theme', one of 'light' | 'dark' | 'system').
//
// addInitScript re-runs on every navigation in this page, including the
// test's later `page.reload()` — so it's guarded by a sessionStorage flag to
// seed only once. Without the guard it would re-clobber `theme` back to the
// seeded value on reload, masking whatever the toggle just persisted.
async function seedTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    const flag = '__e2eSeededTheme'
    if (!window.sessionStorage.getItem(flag)) {
      window.localStorage.setItem('theme', value)
      window.sessionStorage.setItem(flag, '1')
    }
  }, theme)
}

test.describe('React hooks lint fix — corrected-hook behavior (Issue #130)', () => {
  test('light -> dark: toggle flips DOM class immediately and persists across reload', async ({
    page,
  }) => {
    await seedTheme(page, 'light')
    await openWhiteboard(page)

    const html = page.locator('html')

    // Starting state is deterministic: seeded via localStorage, not the
    // ambient default.
    await expect(html).toHaveClass(/light/)
    await expect(html).not.toHaveClass(/dark/)
    await expect(
      page.getByRole('switch', { name: 'Switch to dark mode' }),
    ).toBeVisible()

    const toggle = page.getByRole('switch', { name: 'Switch to dark mode' })
    await toggle.click()

    // AC — DOM class flips immediately (use-theme.tsx's apply effect, keyed
    // on [theme], is unaffected by the GH #130 fix to the mount-only effect).
    await expect(html).toHaveClass(/dark/)
    await expect(html).not.toHaveClass(/light/)
    await expect(
      page.getByRole('switch', { name: 'Switch to light mode' }),
    ).toBeVisible()

    // AC — reload: the corrected mount-only effect (functional setState,
    // dropping the exhaustive-deps violation on `theme`) must still read the
    // just-persisted localStorage value exactly once and resolve to it, not
    // silently revert to 'system'/light on the first render.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()

    await expect(html).toHaveClass(/dark/)
    await expect(html).not.toHaveClass(/light/)
    await expect(
      page.getByRole('switch', { name: 'Switch to light mode' }),
    ).toBeVisible()
  })

  test('dark -> light: toggle flips DOM class immediately and persists across reload', async ({
    page,
  }) => {
    await seedTheme(page, 'dark')
    await openWhiteboard(page)

    const html = page.locator('html')

    // Starting state is deterministic: seeded via localStorage, not the
    // ambient default.
    await expect(html).toHaveClass(/dark/)
    await expect(html).not.toHaveClass(/light/)
    await expect(
      page.getByRole('switch', { name: 'Switch to light mode' }),
    ).toBeVisible()

    const toggle = page.getByRole('switch', { name: 'Switch to light mode' })
    await toggle.click()

    // AC — DOM class flips immediately (use-theme.tsx's apply effect, keyed
    // on [theme], is unaffected by the GH #130 fix to the mount-only effect).
    await expect(html).toHaveClass(/light/)
    await expect(html).not.toHaveClass(/dark/)
    await expect(
      page.getByRole('switch', { name: 'Switch to dark mode' }),
    ).toBeVisible()

    // AC — reload: the corrected mount-only effect (functional setState,
    // dropping the exhaustive-deps violation on `theme`) must still read the
    // just-persisted localStorage value exactly once and resolve to it, not
    // silently revert to 'system'/dark on the first render.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()

    await expect(html).toHaveClass(/light/)
    await expect(html).not.toHaveClass(/dark/)
    await expect(
      page.getByRole('switch', { name: 'Switch to dark mode' }),
    ).toBeVisible()
  })
})

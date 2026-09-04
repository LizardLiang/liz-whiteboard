// e2e/canvas-search.spec.ts
// End-to-end coverage for the Cmd/Ctrl+K canvas search palette
// (canvas-cmd-k-search-panel tactical plan) — the mandatory Playwright
// completion gate per CLAUDE.md.
//
// Mirrors canvas-board.spec.ts's own harness (`engine(page)` reader over
// `window.__canvasEngine`, `beforeEach` re-seed via `bun run
// e2e/seed-canvas.ts`, the 1600x1000 viewport) and whiteboard-search.spec.ts's
// palette-interaction style.
//
// This suite never mutates `canvasSearchBoard` itself — searching pans the
// camera and changes the selection, nothing more — but its `beforeEach` still
// re-seeds the WHOLE dedicated `canvasProject` (seed-canvas.ts wipes and
// recreates the project every run, as every other canvas-*.spec.ts sharing it
// already does). That is only safe because playwright.config.ts pins
// `workers: 1` / `fullyParallel: false`: every test in the whole suite runs
// serially, so no other file's own re-seed can race this one's.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_VIEWER_USER, IDS } from './fixtures'
import type { Browser, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasSearchBoard}`
const VIEWER_BOARD_URL = `/canvas/${IDS.canvasViewerBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed.ts (global-setup) seeds the ADMIN account only. seed-stress.ts is
  // the script that creates E2E_VIEWER_USER's account, needed by the
  // read-only case's `loginAsViewer` below — its own 100-table board is
  // never touched by this suite.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── helpers ─────────────────────────────────────────────────────────────────

interface EngineState {
  boardId: string
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  readOnly: boolean
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

/** Wait for the board to mount and publish its state. */
async function openBoard(page: Page, url = BOARD_URL): Promise<EngineState> {
  await page.goto(url)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
}

/** Open the palette via its button — the accessible-name route, so this
 * works identically for an editor or a read-only viewer. */
async function openSearchViaButton(page: Page) {
  await page.getByRole('button', { name: /Search canvas elements/ }).click()
  await expect(page.getByPlaceholder('Search canvas elements…')).toBeVisible()
}

/** Mirrors global-setup.ts's / canvas-board.spec.ts's own login flow: a real
 * form submission, with the session cookie (not a redirect) as ground truth. */
async function loginAsViewer(browser: Browser): Promise<Page> {
  // An EXPLICITLY empty storage state is load-bearing — `browser.newContext()`
  // would otherwise inherit the config's ADMIN `use.storageState`, and every
  // assertion below would silently run as the wrong user.
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const email = page.getByRole('textbox', { name: 'Email' })
  const password = page.getByRole('textbox', { name: 'Password' })
  const signIn = page.getByRole('button', { name: 'Sign in' })
  await email.click()
  await email.pressSequentially(E2E_VIEWER_USER.email)
  await password.click()
  await password.pressSequentially(E2E_VIEWER_USER.password)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (
      cookies.some((c) => c.name === 'session_token' && c.value.length > 0)
    ) {
      // A fresh page in the now-authenticated context — the app bounces back
      // to `/login?redirect=%2F` after sign-in and then client-redirects
      // again, which would otherwise race this navigation and fail with
      // `net::ERR_ABORTED`.
      const fresh = await context.newPage()
      await page.close()
      return fresh
    }
    await page.waitForTimeout(250)
  }
  throw new Error('viewer login failed: session_token cookie was never set')
}

test.describe('Canvas search palette (Cmd/Ctrl+K)', () => {
  test('opens from the button and from the keyboard', async ({ page }) => {
    await openBoard(page)

    await openSearchViaButton(page)
    await page.keyboard.press('Escape')
    await expect(
      page.getByPlaceholder('Search canvas elements…'),
    ).toBeHidden()

    // Playwright's `ControlOrMeta` modifier is what makes this portable
    // across a Ctrl-based CI runner and a local Cmd-based Mac.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(
      page.getByPlaceholder('Search canvas elements…'),
    ).toBeVisible()
  })

  test('filters into Shapes/Text/Connectors groups', async ({ page }) => {
    await openBoard(page)
    await openSearchViaButton(page)

    const dialog = page.getByRole('dialog', {
      name: 'Search canvas elements',
    })
    const input = page.getByPlaceholder('Search canvas elements…')

    // "alpha" matches one entry in each group; "beta sphere" (the second
    // shape) must be filtered OUT entirely.
    await input.fill('alpha')
    await expect(dialog.getByText('Shapes')).toBeVisible()
    await expect(dialog.getByText('Text')).toBeVisible()
    await expect(dialog.getByText('Connectors')).toBeVisible()
    await expect(
      dialog.getByRole('option', { name: 'alpha crate', exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('option', { name: 'alpha note', exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('option', { name: 'alpha link', exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('option', { name: 'beta sphere', exact: true }),
    ).toHaveCount(0)

    // "beta" narrows to only the ellipse.
    await input.fill('beta')
    await expect(
      dialog.getByRole('option', { name: 'beta sphere', exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('option')).toHaveCount(1)
  })

  test('an unlabelled element is not indexed', async ({ page }) => {
    await openBoard(page)
    await openSearchViaButton(page)

    // Every seeded element except `canvasSearchUntitled` (null text): 5
    // total. A future change that started indexing empty text fails this
    // loudly rather than passing silently.
    const dialog = page.getByRole('dialog', {
      name: 'Search canvas elements',
    })
    await expect(dialog.getByRole('option')).toHaveCount(5)
  })

  test('shows an empty state for no match', async ({ page }) => {
    await openBoard(page)
    await openSearchViaButton(page)

    await page
      .getByPlaceholder('Search canvas elements…')
      .fill('zzz_no_such_thing')
    await expect(page.getByText('No matching elements.')).toBeVisible()
  })

  test('selecting the far-away connector pans the camera, selects it, and closes the palette', async ({
    page,
  }) => {
    const before = await openBoard(page)
    await openSearchViaButton(page)

    const dialog = page.getByRole('dialog', {
      name: 'Search canvas elements',
    })
    await page.getByPlaceholder('Search canvas elements…').fill('alpha link')
    await dialog
      .getByRole('option', { name: 'alpha link', exact: true })
      .click()

    await expect(
      page.getByPlaceholder('Search canvas elements…'),
    ).toBeHidden()

    const after = await engine(page)
    expect(after.selectedIds).toEqual([IDS.canvasSearchConnector])
    // The connector sits at world x~2900-3200, far outside the default
    // camera's ~1600-wide view at the origin — this only passes because
    // focus resolves through `resolvedBounds` (the connector's drawn path),
    // not its 1x1 placeholder. A regression to the placeholder would leave
    // the camera exactly where it started.
    expect(after.camera).not.toEqual(before.camera)
  })
})

test.describe('permissions', () => {
  test('a read-only visitor sees no tool palette but can still search', async ({
    browser,
  }) => {
    const viewerPage = await loginAsViewer(browser)
    try {
      const state = await openBoard(viewerPage, VIEWER_BOARD_URL)
      expect(state.readOnly).toBe(true)

      // No tool palette at all for a viewer — not a disabled one.
      await expect(
        viewerPage.locator('[role="toolbar"][aria-label="Canvas tools"]'),
      ).toHaveCount(0)

      // The search button IS present, and opens the palette.
      await openSearchViaButton(viewerPage)
    } finally {
      await viewerPage.context().close()
    }
  })
})

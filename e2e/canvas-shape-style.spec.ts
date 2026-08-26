// e2e/canvas-shape-style.spec.ts
// End-to-end coverage for the canvas fill/stroke toolbar — the mandatory
// Playwright completion gate per CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// The style path crosses four layers that unit tests can only check
// separately: the toolbar decides a new style, `CanvasBoard` writes it to the
// local scene AND to the undo-recording surface, the socket handler persists
// it, and the renderer repaints from it. A break anywhere in that chain looks
// identical from the outside — the swatch highlights and nothing happens — so
// every case here asserts the ENGINE state and, for the cases where it is the
// whole point, the actual pixels.
//
// Mirrors e2e/canvas-shapes.spec.ts structure-for-structure, including its
// hard-won mechanics, duplicated rather than imported because no canvas spec
// in this repo exports them (e2e/canvas-helpers.ts holds React-Flow/ER-board
// helpers only):
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point.
//   - `dragMouse` delivers the final position twice so a stepped move cannot
//     be left short by event coalescing under load.
//   - Pixel probes are POLLED, never read once: React state settles a frame
//     before the canvas repaints, so a single read races the redraw.
//
// SEEDING ORDER — seed-canvas.ts's ProjectMember insert references
// IDS.viewerUser, a User row only e2e/seed-stress.ts creates.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist and broadcast in dev too.
// The reload assertions below prove real PERSISTENCE, not a dev-only
// workaround.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_VIEWER_USER, IDS } from './fixtures'
import type { Browser, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── the palette, restated ───────────────────────────────────────────────────

/**
 * The two swatches this suite drives, duplicated from
 * src/lib/canvas-style-palette.ts.
 *
 * Restated rather than imported for the reason canvas-helpers.ts already
 * records for its own constants: Playwright's runner uses its own TS
 * transform, not the app's Vite/tsconfig path resolution, so `@/lib/...` from
 * a spec is unproven territory here. Keep these in sync by hand — the label
 * is what the aria-label is built from, and the strings are what the engine
 * stores.
 */
const RED = { label: 'Red', fill: 'rgba(239, 68, 68, 0.10)', stroke: '#ef4444' }
const TEAL = { label: 'Teal', fill: 'rgba(20, 184, 166, 0.10)', stroke: '#14b8a6' }
/** `DEFAULT_ELEMENT_STYLE` — what an unstyled shape carries, i.e. the blue swatch. */
const DEFAULT_FILL = 'rgba(59, 130, 246, 0.10)'
const DEFAULT_STROKE_WIDTH = 2

// ── engine access ───────────────────────────────────────────────────────────

interface EngineStyle {
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: number
  color: string
}

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  text: string | null
  zIndex: number
  style: EngineStyle
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  tool: string
  readOnly: boolean
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

async function waitForBoard(page: Page) {
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

async function openBoard(page: Page, url = BOARD_URL) {
  await page.goto(url)
  await waitForBoard(page)
  return engine(page)
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return box
}

/** World point -> page coordinates, via the engine's OWN camera. Never hand-rolled. */
async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await canvasBox(page)
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

async function focusBoard(page: Page) {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 40, box.y + 120)
}

/** Wait for the server ack that pushes the undo entry. */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

/**
 * A page signed in as the VIEWER, copied from canvas-undo.spec.ts's identical
 * helper (no canvas spec exports it).
 *
 * The explicitly empty storage state is load-bearing: `browser.newContext()`
 * otherwise inherits the config's ADMIN storageState, the credentials below
 * never take effect, and the read-only assertion silently runs against an
 * OWNER session — which is exactly how the first draft of this suite failed,
 * asserting "no toolbar" on a board the signed-in user could freely edit.
 */
async function loginAsViewer(browser: Browser): Promise<Page> {
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

  // The cookie, not a redirect, is the ground truth — the post-login client
  // redirect can bounce.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === 'session_token' && c.value.length > 0)) {
      const fresh = await context.newPage()
      await page.close()
      return fresh
    }
    await page.waitForTimeout(250)
  }
  throw new Error('viewer login failed: session_token cookie was never set')
}

const styleBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Shape style' })

async function pick(page: Page, row: 'Fill' | 'Stroke', name: string) {
  await styleBar(page).getByRole('button', { name: `${row} ${name}` }).click()
  await settle(page)
}

/**
 * Draw one ellipse and return it, already selected.
 *
 * An ellipse rather than a rectangle so the pixel probes below sample a shape
 * whose fill and outline are at known, well-separated points — and so this
 * suite covers a kind whose paint path is `fill()`/`stroke()` rather than
 * `fillRect`/`strokeRect`.
 */
const SHAPE_RECT = { x: 600, y: 420, width: 240, height: 160 }
const SHAPE_CENTRE = {
  x: SHAPE_RECT.x + SHAPE_RECT.width / 2,
  y: SHAPE_RECT.y + SHAPE_RECT.height / 2,
}

async function drawEllipse(page: Page, at = SHAPE_RECT) {
  await page.click('[aria-label="Ellipse (O)"]')
  const from = await worldToPage(page, { x: at.x, y: at.y })
  const to = await worldToPage(page, {
    x: at.x + at.width,
    y: at.y + at.height,
  })
  await dragMouse(page, from, to)
  await expect
    .poll(async () => (await engine(page)).elements.filter((e) => e.kind === 'ellipse').length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0)
  await settle(page)
}

function ellipsesOf(state: EngineState) {
  return state.elements.filter((element) => element.kind === 'ellipse')
}

/** The colour of the pixel at a WORLD point, as `[r,g,b,a]`. */
async function pixelAtWorld(page: Page, world: { x: number; y: number }) {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      if (!c) return null
      const ctx = c.getContext('2d')
      if (!ctx) return null
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const x = Math.round((target.x - view.x) * view.zoom * ratio)
      const y = Math.round((target.y - view.y) * view.zoom * ratio)
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null
      const d = ctx.getImageData(x, y, 1, 1).data
      return [d[0], d[1], d[2], d[3]]
    },
    { target: world, view: camera },
  )
}

// ── when the bar appears ────────────────────────────────────────────────────

test.describe('the style toolbar', () => {
  test('appears for a selected shape and shows its current colours', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    // The draw leaves the new shape selected, so the bar should already be up.
    await expect(styleBar(page)).toBeVisible()
    // A never-styled shape is the blue swatch in BOTH rows — the palette and
    // the engine default agreeing, seen from the UI.
    await expect(
      styleBar(page).getByRole('button', { name: 'Fill Blue' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      styleBar(page).getByRole('button', { name: 'Stroke Blue' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('disappears when the selection is cleared', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    await expect(styleBar(page)).toBeVisible()
    await focusBoard(page)
    await expect(styleBar(page)).toBeHidden()
  })

  test('never appears for a VIEWER, who can select but not restyle', async ({
    browser,
  }) => {
    // A viewer shown swatches that silently do nothing (the server re-checks
    // the role on every mutation) is worse than no swatches at all.
    //
    // This needs a real viewer SESSION, not merely a different board: the
    // owner is a member of every seeded project, so opening the viewer board
    // as the admin is an ordinary editable board.
    const viewerPage = await loginAsViewer(browser)
    try {
      const state = await openBoard(viewerPage, `/canvas/${IDS.canvasViewerBoard}`)
      expect(state.readOnly).toBe(true)
      const first = state.elements.find((element) => element.kind !== 'connector')
      expect(first).toBeDefined()
      const centre = await worldToPage(viewerPage, {
        x: first!.x + first!.width / 2,
        y: first!.y + first!.height / 2,
      })
      await viewerPage.mouse.click(centre.x, centre.y)
      // Give the bar every chance to appear before asserting it did not.
      await viewerPage.waitForTimeout(1000)
      await expect(styleBar(viewerPage)).toBeHidden()
    } finally {
      await viewerPage.context().close()
    }
  })
})

// ── the actual edits ────────────────────────────────────────────────────────

test.describe('changing fill and stroke', () => {
  test('applies a fill, repaints it, and persists it across a reload', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    await pick(page, 'Fill', RED.label)

    const styled = ellipsesOf(await engine(page))[0]
    expect(styled.style.fill).toBe(RED.fill)
    // Stroke is untouched — one row must not write the other's half.
    expect(styled.style.strokeWidth).toBe(DEFAULT_STROKE_WIDTH)

    // The pixels, not just the state. A red fill at 10% over the board means
    // the red channel dominates; the default blue would invert that.
    await expect
      .poll(async () => {
        const px = await pixelAtWorld(page, SHAPE_CENTRE)
        return px ? px[0] > px[2] : null
      }, { timeout: 5_000 })
      .toBe(true)

    await page.reload()
    await waitForBoard(page)
    expect(ellipsesOf(await engine(page))[0].style.fill).toBe(RED.fill)
  })

  test('applies a stroke colour without touching the fill', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    await pick(page, 'Stroke', TEAL.label)

    const styled = ellipsesOf(await engine(page))[0]
    expect(styled.style.stroke).toBe(TEAL.stroke)
    expect(styled.style.fill).toBe(DEFAULT_FILL)

    await page.reload()
    await waitForBoard(page)
    expect(ellipsesOf(await engine(page))[0].style.stroke).toBe(TEAL.stroke)
  })

  test('clears a fill, leaving the outline drawn', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    await pick(page, 'Fill', 'none')

    const styled = ellipsesOf(await engine(page))[0]
    expect(styled.style.fill).toBe('none')
    expect(styled.style.strokeWidth).toBe(DEFAULT_STROKE_WIDTH)

    // Deselect so the selection chrome cannot paint the interior, then prove
    // the centre is genuinely empty while the shape is still there.
    await focusBoard(page)
    await expect
      .poll(async () => (await pixelAtWorld(page, SHAPE_CENTRE))?.[3] ?? null, {
        timeout: 5_000,
      })
      .toBe(0)
  })

  test('clears a stroke by width and KEEPS its colour for when it returns', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    await pick(page, 'Stroke', TEAL.label)
    await pick(page, 'Stroke', 'none')

    const cleared = ellipsesOf(await engine(page))[0]
    expect(cleared.style.strokeWidth).toBe(0)
    // The colour survives the clear — that is what makes re-enabling give the
    // shape its own outline back rather than a default nobody chose.
    expect(cleared.style.stroke).toBe(TEAL.stroke)

    await expect(
      styleBar(page).getByRole('button', { name: 'Stroke none' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('restores a width when colouring a stroke that was cleared', async ({
    page,
  }) => {
    // Without the restore, this click changes a colour on a line that is
    // still zero pixels wide — it would look like the button does nothing.
    await openBoard(page)
    await drawEllipse(page)
    await pick(page, 'Stroke', 'none')
    await pick(page, 'Stroke', RED.label)

    const restored = ellipsesOf(await engine(page))[0]
    expect(restored.style.stroke).toBe(RED.stroke)
    expect(restored.style.strokeWidth).toBe(DEFAULT_STROKE_WIDTH)
  })
})

// ── multi-select and undo ───────────────────────────────────────────────────

test.describe('restyling several shapes at once', () => {
  test('one click restyles the whole selection and one Ctrl+Z reverses it', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page, SHAPE_RECT)
    await drawEllipse(page, {
      x: SHAPE_RECT.x + 320,
      y: SHAPE_RECT.y,
      width: 200,
      height: 140,
    })

    // Marquee both. Starting the drag above and left of the first shape, in
    // empty board, so the press begins a marquee rather than grabbing one.
    const from = await worldToPage(page, {
      x: SHAPE_RECT.x - 60,
      y: SHAPE_RECT.y - 60,
    })
    const to = await worldToPage(page, {
      x: SHAPE_RECT.x + 560,
      y: SHAPE_RECT.y + 240,
    })
    await dragMouse(page, from, to)
    await expect
      .poll(async () => (await engine(page)).selectedIds.length, { timeout: 5_000 })
      .toBe(2)

    await pick(page, 'Fill', RED.label)
    expect(
      ellipsesOf(await engine(page)).map((e) => e.style.fill),
    ).toEqual([RED.fill, RED.fill])

    // ONE undo entry for one gesture, and a toast that says how many shapes
    // are coming back — not "an element".
    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect(page.getByText('Undid restyling 2 shapes')).toBeVisible({
      timeout: 5_000,
    })
    await expect
      .poll(async () => ellipsesOf(await engine(page)).map((e) => e.style.fill), {
        timeout: 10_000,
      })
      .toEqual([DEFAULT_FILL, DEFAULT_FILL])
  })

  test('a restyle survives redo and reaches the database', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    await pick(page, 'Fill', RED.label)

    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect
      .poll(async () => ellipsesOf(await engine(page))[0].style.fill, {
        timeout: 10_000,
      })
      .toBe(DEFAULT_FILL)

    await focusBoard(page)
    await page.keyboard.press('Control+Shift+z')
    await expect
      .poll(async () => ellipsesOf(await engine(page))[0].style.fill, {
        timeout: 10_000,
      })
      .toBe(RED.fill)

    // The row, not the optimistic scene.
    await page.reload()
    await waitForBoard(page)
    expect(ellipsesOf(await engine(page))[0].style.fill).toBe(RED.fill)
  })
})

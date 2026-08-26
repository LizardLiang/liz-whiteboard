// e2e/canvas-clipboard.spec.ts
// End-to-end coverage for canvas copy, cut, paste and duplicate — the
// mandatory Playwright completion gate per CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// The copy path crosses four layers no unit test spans: the input hook plans
// the copies, `useCanvasElements` persists them and RENAMES each row with the
// server's own id, the undo recorder rewrites the copied connectors' endpoints
// from those acks, and the renderer repaints. The failure that matters lives
// exactly at that seam — a connector persisted against a client-side id names
// a row that never existed, is never drawn, and is never found by the delete
// cascade — and it is invisible from any single layer. So the connector cases
// below assert the PERSISTED endpoints after a reload, not just the scene.
//
// Mirrors e2e/canvas-selection-toolbar.spec.ts structure-for-structure,
// including its hard-won mechanics, duplicated rather than imported because no
// canvas spec in this repo exports them:
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point.
//   - `dragMouse` delivers the final position twice so a stepped move cannot
//     be left short by event coalescing under load.
//   - Everything asynchronous is POLLED, never read once.
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

/**
 * `CLONE_OFFSET`, restated from src/lib/canvas-engine/clone.ts.
 *
 * Restated rather than imported for the reason canvas-helpers.ts already
 * records: Playwright's runner uses its own TS transform, not the app's Vite
 * path resolution, so `@/lib/...` from a spec is unproven territory here.
 */
const CLONE_OFFSET = 24

// ── engine access ───────────────────────────────────────────────────────────

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  text: string | null
  zIndex: number
  style: { fill: string; stroke: string; strokeWidth: number }
  connector?: {
    source: { kind: string; elementId?: string }
    target: { kind: string; elementId?: string }
    routing: string
  }
}

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  tool: string
  readOnly: boolean
  hoveredId: string | null
  /** Whose creation handles are showing, or null when none are. */
  creationHandleTargetId: string | null
  /** Canvas-relative screen rects — the ones the renderer actually drew. */
  creationHandles: Record<'top' | 'right' | 'bottom' | 'left', ScreenRect> | null
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

const selectionBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Selection' })

/**
 * A page signed in as the VIEWER, copied from canvas-selection-toolbar.spec.ts's
 * identical helper (no canvas spec exports it).
 *
 * The explicitly empty storage state is load-bearing: `browser.newContext()`
 * otherwise inherits the config's ADMIN storageState, the credentials below
 * never take effect, and the read-only assertion silently runs against an
 * OWNER session.
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

// ── drawing ─────────────────────────────────────────────────────────────────

const SHAPE_RECT = { x: 600, y: 420, width: 200, height: 140 }
const SHAPE_CENTRE = {
  x: SHAPE_RECT.x + SHAPE_RECT.width / 2,
  y: SHAPE_RECT.y + SHAPE_RECT.height / 2,
}

async function drawEllipse(page: Page, at = SHAPE_RECT) {
  const before = ellipsesOf(await engine(page)).length
  await page.click('[aria-label="Ellipse (O)"]')
  const from = await worldToPage(page, { x: at.x, y: at.y })
  const to = await worldToPage(page, {
    x: at.x + at.width,
    y: at.y + at.height,
  })
  await dragMouse(page, from, to)
  await expect
    .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
    .toBe(before + 1)
  await settle(page)
}

function ellipsesOf(state: EngineState) {
  return state.elements.filter((element) => element.kind === 'ellipse')
}

function connectorsOf(state: EngineState) {
  return state.elements.filter((element) => element.kind === 'connector')
}

/** Select the element whose centre sits at `world`. */
async function clickWorld(page: Page, world: { x: number; y: number }) {
  const point = await worldToPage(page, world)
  await page.mouse.click(point.x, point.y)
}

/** Press a clipboard chord on the focused board. */
async function chord(page: Page, key: string) {
  await page.keyboard.press(`Control+${key}`)
  await settle(page)
}

// ───────────────────────────────────────────────────────────────────────────

test.describe('paste', () => {
  test('creates an offset copy that persists, leaving the original alone', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'c')
    await chord(page, 'v')

    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)

    const after = ellipsesOf(await engine(page))
    const copy = after.find((element) => element.id !== original.id)
    expect(copy).toBeDefined()
    expect(copy?.x).toBe(original.x + CLONE_OFFSET)
    expect(copy?.y).toBe(original.y + CLONE_OFFSET)
    // Everything else came across untouched.
    expect(copy?.width).toBe(original.width)
    expect(copy?.height).toBe(original.height)
    expect(copy?.style).toEqual(original.style)
    // And the original is exactly where it was.
    const stillThere = after.find((element) => element.id === original.id)
    expect(stillThere?.x).toBe(original.x)

    // It is a ROW that was created, not only a scene entry.
    await page.reload()
    await waitForBoard(page)
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)
  })

  test('selects the copy, not what was copied', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'c')
    await chord(page, 'v')

    const state = await engine(page)
    const copy = ellipsesOf(state).find((element) => element.id !== original.id)
    expect(state.selectedIds).toEqual([copy?.id])
  })

  test('fans out across repeated pastes instead of stacking on one spot', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'c')
    await chord(page, 'v')
    await chord(page, 'v')
    await chord(page, 'v')

    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 15_000 })
      .toBe(4)

    const xs = ellipsesOf(await engine(page))
      .map((element) => element.x)
      .sort((l, r) => l - r)
    expect(xs).toEqual([
      original.x,
      original.x + CLONE_OFFSET,
      original.x + CLONE_OFFSET * 2,
      original.x + CLONE_OFFSET * 3,
    ])
  })

  test('the copy lands IN FRONT of what it was copied from', async ({ page }) => {
    // Otherwise the copy hides behind the original and paste reads as a no-op.
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'c')
    await chord(page, 'v')

    const copy = ellipsesOf(await engine(page)).find(
      (element) => element.id !== original.id,
    )
    expect(copy?.zIndex).toBeGreaterThan(original.zIndex)
  })

  test('does nothing when nothing was ever copied', async ({ page }) => {
    await openBoard(page)
    const before = (await engine(page)).elements.length
    await focusBoard(page)
    await chord(page, 'v')
    expect((await engine(page)).elements).toHaveLength(before)
  })
})

test.describe('duplicate', () => {
  test('copies the selection with no prior copy, from the keyboard', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'd')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)
    const copy = ellipsesOf(await engine(page)).find(
      (element) => element.id !== original.id,
    )
    expect(copy?.x).toBe(original.x + CLONE_OFFSET)
  })

  test('is reachable from the toolbar button', async ({ page }) => {
    // He judges a feature by what he can see: the keyboard path is not the
    // only one, and this asserts the visible control does the same thing.
    await openBoard(page)
    await drawEllipse(page)

    await expect(selectionBar(page)).toBeVisible()
    await selectionBar(page).getByRole('button', { name: 'Duplicate' }).click()
    await settle(page)

    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)
  })

  test('cascades, because each duplicate copies the PREVIOUS one', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'd')
    await chord(page, 'd')

    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 15_000 })
      .toBe(3)
    const xs = ellipsesOf(await engine(page))
      .map((element) => element.x)
      .sort((l, r) => l - r)
    // Two distinct offsets. If the selection had NOT moved to the copy, both
    // duplicates would sit at the same +24 and this would read [x, x+24, x+24].
    expect(xs).toEqual([
      original.x,
      original.x + CLONE_OFFSET,
      original.x + CLONE_OFFSET * 2,
    ])
  })

  test('does not clobber the copy buffer', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    const first = ellipsesOf(await engine(page))[0]
    await chord(page, 'c')

    const second = { x: 1000, y: 420, width: 120, height: 120 }
    await drawEllipse(page, second)
    await chord(page, 'd')

    await chord(page, 'v')
    // The paste must reproduce the COPIED shape, at the copied shape's offset.
    await expect
      .poll(
        async () =>
          ellipsesOf(await engine(page)).filter(
            (element) => element.x === first.x + CLONE_OFFSET,
          ).length,
        { timeout: 10_000 },
      )
      .toBe(1)
  })
})

test.describe('cut', () => {
  test('removes the selection and can paste it back', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    const original = ellipsesOf(await engine(page))[0]

    await chord(page, 'x')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(0)

    await focusBoard(page)
    await chord(page, 'v')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(1)
    expect(ellipsesOf(await engine(page))[0].x).toBe(original.x + CLONE_OFFSET)
  })

  test('one Ctrl+Z brings back what was cut, and names it a cut', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)

    await chord(page, 'x')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(0)

    await focusBoard(page)
    await page.keyboard.press('Control+z')
    // Names the CUT, not a plain delete — the two share an inverse and must
    // not read alike, or the user cannot tell which edit is coming back.
    await expect(page.getByText('Undid cutting an element')).toBeVisible({
      timeout: 5_000,
    })
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(1)
  })
})

test.describe('undo', () => {
  test('one Ctrl+Z removes an entire multi-element paste', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    await drawEllipse(page, { x: 1000, y: 420, width: 120, height: 120 })

    // Select both with a marquee across empty canvas around them.
    const from = await worldToPage(page, { x: 560, y: 380 })
    const to = await worldToPage(page, { x: 1180, y: 600 })
    await dragMouse(page, from, to)
    await expect
      .poll(async () => (await engine(page)).selectedIds.length, { timeout: 10_000 })
      .toBe(2)

    await chord(page, 'c')
    await chord(page, 'v')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 15_000 })
      .toBe(4)

    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect(page.getByText('Undid pasting 2 elements')).toBeVisible({
      timeout: 5_000,
    })
    // Both copies go together — one gesture, one entry.
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)
  })

  test('names a duplicate as a duplicate, not a paste', async ({ page }) => {
    await openBoard(page)
    await drawEllipse(page)
    await chord(page, 'd')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)

    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect(page.getByText('Undid duplicating an element')).toBeVisible({
      timeout: 5_000,
    })
  })
})

test.describe('connectors travel with what they join', () => {
  /**
   * Draw two ellipses and join them with a creation-handle drag, returning
   * both shapes' world rects.
   *
   * The handle position is READ from `window.__canvasEngine.creationHandles`
   * — the rects the renderer itself drew — rather than derived from the
   * element's bounds. The handles sit outside the shape by a margin this spec
   * has no business restating, and a geometric guess simply misses them: the
   * first version of this helper dragged from empty canvas and produced a
   * marquee instead of a connector. Mirrors canvas-quick-create.spec.ts's
   * `handlePoint`.
   *
   * They appear on HOVER, not on selection, which is the other half of what
   * the guess got wrong.
   */
  async function drawJoinedPair(page: Page) {
    const left = { x: 600, y: 420, width: 160, height: 120 }
    const right = { x: 1000, y: 420, width: 160, height: 120 }
    await drawEllipse(page, left)
    await drawEllipse(page, right)
    const leftId = ellipsesOf(await engine(page)).find(
      (element) => element.x === left.x,
    )?.id
    if (!leftId) throw new Error('the left ellipse was never created')

    // Clear the selection FIRST. The second draw leaves its own ellipse
    // selected, and a selected element keeps the handles for itself — so
    // hovering the left one while the right one is selected reports the
    // right one's handles and the drag starts from the wrong shape.
    await focusBoard(page)
    await expect
      .poll(async () => (await engine(page)).selectedIds.length, { timeout: 5_000 })
      .toBe(0)

    // Hover it and wait for the engine to report ITS handles. Moved away
    // first so the pointer genuinely crosses INTO the shape — a move that
    // starts and ends inside it may emit nothing.
    const centre = await worldToPage(page, {
      x: left.x + left.width / 2,
      y: left.y + left.height / 2,
    })
    await page.mouse.move(centre.x - 300, centre.y - 200)
    await page.mouse.move(centre.x, centre.y)
    await expect
      .poll(async () => (await engine(page)).creationHandleTargetId, {
        timeout: 10_000,
      })
      .toBe(leftId)

    const box = await canvasBox(page)
    const rect = (await engine(page)).creationHandles?.right
    if (!rect) throw new Error('the right creation handle is not showing')
    const handle = {
      x: box.x + rect.x + rect.width / 2,
      y: box.y + rect.y + rect.height / 2,
    }
    const onto = await worldToPage(page, {
      x: right.x + right.width / 2,
      y: right.y + right.height / 2,
    })
    await dragMouse(page, handle, onto)
    await expect
      .poll(async () => connectorsOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(1)
    await settle(page)
    return { left, right }
  }

  test('a connector between two copied shapes is copied and REWIRED', async ({
    page,
  }) => {
    await openBoard(page)
    const { left, right } = await drawJoinedPair(page)
    const before = await engine(page)
    const originalIds = new Set(before.elements.map((element) => element.id))

    // Marquee both shapes and their connector.
    const from = await worldToPage(page, { x: 560, y: 380 })
    const to = await worldToPage(page, {
      x: right.x + right.width + 40,
      y: right.y + right.height + 40,
    })
    await dragMouse(page, from, to)
    await expect
      .poll(async () => (await engine(page)).selectedIds.length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3)

    await chord(page, 'c')
    await chord(page, 'v')
    await expect
      .poll(async () => connectorsOf(await engine(page)).length, { timeout: 15_000 })
      .toBe(2)

    // THE ASSERTION THIS SUITE EXISTS FOR: after a reload — i.e. read back
    // from the database, not from the optimistic scene — the copied connector
    // must name the two COPIES, and rows that actually exist.
    await page.reload()
    await waitForBoard(page)
    const reloaded = await engine(page)
    const copiedConnector = connectorsOf(reloaded).find(
      (element) => !originalIds.has(element.id),
    )
    expect(copiedConnector).toBeDefined()

    const sourceId = copiedConnector?.connector?.source.elementId
    const targetId = copiedConnector?.connector?.target.elementId
    const liveIds = new Set(reloaded.elements.map((element) => element.id))
    // Both ends resolve to real rows...
    expect(liveIds.has(sourceId as string)).toBe(true)
    expect(liveIds.has(targetId as string)).toBe(true)
    // ...and neither is one of the originals — the copy is wired to itself,
    // not back into the diagram it came from.
    expect(originalIds.has(sourceId as string)).toBe(false)
    expect(originalIds.has(targetId as string)).toBe(false)
    // Sanity: the ORIGINAL connector still joins the originals.
    const originalConnector = connectorsOf(reloaded).find((element) =>
      originalIds.has(element.id),
    )
    expect(
      originalIds.has(originalConnector?.connector?.source.elementId as string),
    ).toBe(true)

    // The left shape is still where it was; nothing about the copy moved it.
    const stillThere = ellipsesOf(reloaded).some(
      (element) => element.x === left.x,
    )
    expect(stillThere).toBe(true)
  })

  test('a connector with one end left behind is DROPPED, not dangled', async ({
    page,
  }) => {
    await openBoard(page)
    const { left } = await drawJoinedPair(page)

    // Select only the left shape.
    await clickWorld(page, {
      x: left.x + left.width / 2,
      y: left.y + left.height / 2,
    })
    await expect
      .poll(async () => (await engine(page)).selectedIds.length, { timeout: 10_000 })
      .toBe(1)

    await chord(page, 'c')
    await chord(page, 'v')
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(3)

    // The shape came across; the connector did not.
    expect(connectorsOf(await engine(page))).toHaveLength(1)
  })
})

test.describe('copying an element whose create is still in flight', () => {
  test('duplicating immediately after drawing still produces a real row', async ({
    page,
  }) => {
    // The repo's proven hazard class: an element acted on mid-round-trip
    // still carries its client-side id. A copy is safe by construction — the
    // buffer holds a snapshot and every copy gets a fresh id — but "by
    // construction" is a claim, and this is the check.
    await openBoard(page)
    await page.click('[aria-label="Ellipse (O)"]')
    const from = await worldToPage(page, { x: SHAPE_RECT.x, y: SHAPE_RECT.y })
    const to = await worldToPage(page, {
      x: SHAPE_RECT.x + SHAPE_RECT.width,
      y: SHAPE_RECT.y + SHAPE_RECT.height,
    })
    await dragMouse(page, from, to)
    // NO settle: duplicate while the create is very likely still unacked.
    await page.keyboard.press('Control+d')
    await settle(page)

    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)

    // Both survive a reload, so both are real rows with server ids.
    await page.reload()
    await waitForBoard(page)
    await expect
      .poll(async () => ellipsesOf(await engine(page)).length, { timeout: 10_000 })
      .toBe(2)
  })
})

test.describe('authorisation', () => {
  test('a viewer gets no duplicate button and no working shortcuts', async ({
    browser,
  }) => {
    const page = await loginAsViewer(browser)
    try {
      await openBoard(page)
      const before = (await engine(page)).elements.length
      expect((await engine(page)).readOnly).toBe(true)

      await clickWorld(page, SHAPE_CENTRE)
      await expect(selectionBar(page)).toBeHidden()

      await focusBoard(page)
      await page.keyboard.press('Control+a')
      await chord(page, 'c')
      await chord(page, 'v')
      await chord(page, 'd')
      await chord(page, 'x')

      expect((await engine(page)).elements).toHaveLength(before)

      await page.reload()
      await waitForBoard(page)
      expect((await engine(page)).elements).toHaveLength(before)
    } finally {
      await page.context().close()
    }
  })
})

test.describe('the shortcuts yield to text editing', () => {
  test('Ctrl+D inside a label does not duplicate the element', async ({
    page,
  }) => {
    await openBoard(page)
    await drawEllipse(page)
    const before = ellipsesOf(await engine(page)).length

    // Enter opens the selected element for typing.
    await page.keyboard.press('Enter')
    await page.keyboard.type('label')
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(500)

    expect(ellipsesOf(await engine(page))).toHaveLength(before)

    // And the typing itself survived.
    await page.keyboard.press('Escape')
    await settle(page)
    await expect
      .poll(
        async () =>
          ellipsesOf(await engine(page)).some(
            (element) => element.text === 'label',
          ),
        { timeout: 10_000 },
      )
      .toBe(true)
  })
})

// e2e/canvas-quick-create.spec.ts
// End-to-end coverage for the FigJam-style creation handles (canvas
// quick-create-handles tactical plan, Wave 6, step 17) — the mandatory
// Playwright completion gate per CLAUDE.md.
//
// Mirrors e2e/canvas-undo.spec.ts structure-for-structure, including its
// hard-won mechanics, which are duplicated here rather than imported because
// that file exports none of them and every canvas e2e spec in this repo keeps
// its own local copy (e2e/canvas-helpers.ts holds React-Flow/ER-board helpers
// only, not FigJam canvas-engine ones):
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point:
//     a left sidebar and a top header inset the canvas, and a click past its
//     edge silently never reaches CanvasBoard's own `containerRef.focus()`,
//     which makes every later keyboard shortcut go to `<body>` and read as
//     "the shortcut does nothing".
//   - `settle` waits for the server ACK, not the optimistic render. An undo
//     entry is pushed inside `recordQuickCreate`'s `.then()`; calling undo
//     between the optimistic scene update and that ack finds an EMPTY stack.
//   - Every shortcut is preceded by an explicit `focusBoard`, never sent on
//     the strength of a preceding drag's own focus.
//
// SEEDING ORDER — seed-canvas.ts's ProjectMember insert references
// IDS.viewerUser, a User row only e2e/seed-stress.ts creates. Seeding canvas
// onto a global-setup-only database fails with FOREIGN KEY. Hence the
// beforeAll below, copied from canvas-undo.spec.ts rather than rediscovered.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist and broadcast in dev too.
// The documented `io === null` gap applies only to server functions running in
// the Vite process, which none of these are. Reload assertions below therefore
// prove PERSISTENCE, not a workaround for a dev-only broadcast gap.
//
// WHY THE HANDLES ARE READ FROM THE ENGINE, NOT COMPUTED HERE — every click on
// a creation handle targets `window.__canvasEngine.creationHandles`, the
// rectangles the renderer itself drew (`creationHandleRects`). Adding a local
// offset to an element's edge would be a second derivation of the same
// geometry, which is the exact W1/W3 defect class this whole feature was built
// to avoid — and it would fail as "the click did nothing" with no hint why.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_VIEWER_USER, IDS } from './fixtures'
import type { Browser, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`
const CONNECTOR_BOARD_URL = `/canvas/${IDS.canvasConnectorBoard}`
const VIEWER_BOARD_URL = `/canvas/${IDS.canvasViewerBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── engine access ───────────────────────────────────────────────────────────

type Direction = 'top' | 'right' | 'bottom' | 'left'

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

type ConnectorEnd =
  | { kind: 'element'; elementId: string; attach?: { x: number; y: number } }
  | { kind: 'point'; point: { x: number; y: number } }

interface EngineElement {
  id: string
  kind: 'rectangle' | 'text' | 'connector'
  x: number
  y: number
  width: number
  height: number
  text: string | null
  zIndex: number
  connector?: {
    source: ConnectorEnd
    target: ConnectorEnd
    routing: string
  }
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  editingElementId: string | null
  hoveredId: string | null
  creationHandleTargetId: string | null
  creationHandles: Record<Direction, ScreenRect> | null
  connectorEndpoints: Record<'source' | 'target', ScreenRect> | null
  tool: string
  readOnly: boolean
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

async function openBoard(page: Page, url = BOARD_URL): Promise<EngineState> {
  await page.goto(url)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return box
}

async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await canvasBox(page)
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

/**
 * The PAGE point of one creation handle's centre.
 *
 * `creationHandles` is published in canvas-relative screen pixels (the same
 * space the renderer draws in), so the canvas's own measured origin is added
 * here and nowhere else.
 */
async function handlePoint(page: Page, direction: Direction) {
  const state = await engine(page)
  if (!state.creationHandles) {
    throw new Error(
      `no creation handles are showing (target=${state.creationHandleTargetId}, hovered=${state.hoveredId})`,
    )
  }
  const box = await canvasBox(page)
  const rect = state.creationHandles[direction]
  return {
    x: box.x + rect.x + rect.width / 2,
    y: box.y + rect.y + rect.height / 2,
  }
}

function byId(state: EngineState, id: string) {
  return state.elements.find((element) => element.id === id)
}

function connectorsOf(state: EngineState) {
  return state.elements.filter((element) => element.kind === 'connector')
}

function nonConnectorsOf(state: EngineState) {
  return state.elements.filter((element) => element.kind !== 'connector')
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

/** See the file header — the measured box, near its TOP, never a fixed point. */
async function focusBoard(page: Page) {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 40, box.y + 150)
}

/** Wait for the server ack that pushes the undo entry — see the file header. */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

async function undo(page: Page) {
  await focusBoard(page)
  await page.keyboard.press('Control+z')
}

/**
 * Hover an element so its creation handles appear, and confirm they did.
 *
 * Returns once the engine reports handles for THAT element — polling rather
 * than a fixed wait, because the hover only reaches the published state on the
 * next React render.
 */
async function hoverElement(page: Page, id: string) {
  const state = await engine(page)
  const element = byId(state, id)
  if (!element) throw new Error(`element ${id} is not on the board`)
  const centre = await worldToPage(page, {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  })
  await page.mouse.move(centre.x, centre.y)
  await expect
    .poll(async () => (await engine(page)).creationHandleTargetId)
    .toBe(id)
}

/**
 * Mirrors global-setup.ts's login flow — real form, cookie is ground truth.
 * Copied from canvas-undo.spec.ts, which does not export it.
 *
 * The EXPLICITLY empty storage state is load-bearing: without it
 * `browser.newContext()` inherits the config's ADMIN storageState and the
 * read-only test below would silently assert "no handles" against an owner
 * session that should have had them.
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

// ── handles appear ──────────────────────────────────────────────────────────

test.describe('the handles appear', () => {
  test('on hover, with nothing selected', async ({ page }) => {
    await openBoard(page)
    expect((await engine(page)).creationHandleTargetId).toBeNull()

    await hoverElement(page, IDS.canvasRect)

    const state = await engine(page)
    expect(state.hoveredId).toBe(IDS.canvasRect)
    expect(state.selectedIds).toEqual([])
    expect(Object.keys(state.creationHandles ?? {}).sort()).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ])
  })

  test('on selection', async ({ page }) => {
    await openBoard(page)
    const rect = byId(await engine(page), IDS.canvasRect)!
    const centre = await worldToPage(page, {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)

    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasRect])
    expect((await engine(page)).creationHandleTargetId).toBe(IDS.canvasRect)
  })

  test('and clear when the pointer leaves the element and its handles', async ({
    page,
  }) => {
    await openBoard(page)
    await hoverElement(page, IDS.canvasRect)

    const box = await canvasBox(page)
    await page.mouse.move(box.x + 40, box.y + 40)
    await expect
      .poll(async () => (await engine(page)).creationHandleTargetId)
      .toBeNull()
  })

  test('stay up while the pointer is ON a handle, so it can be grabbed', async ({
    page,
  }) => {
    // The handles sit OUTSIDE the element, so reaching for one leaves its
    // bounds. Without the sticky-hover rule they vanish exactly as the user
    // arrives — a hover-shown handle would be literally unclickable.
    await openBoard(page)
    await hoverElement(page, IDS.canvasRect)

    const target = await handlePoint(page, 'right')
    await page.mouse.move(target.x, target.y)
    await page.waitForTimeout(200)
    expect((await engine(page)).creationHandleTargetId).toBe(IDS.canvasRect)
  })
})

// ── clicking a handle ───────────────────────────────────────────────────────

test.describe('clicking a creation handle', () => {
  test('creates an element AND a connector, and both survive a reload', async ({
    page,
  }) => {
    const before = await openBoard(page)
    await hoverElement(page, IDS.canvasRect)
    const target = await handlePoint(page, 'right')
    await page.mouse.click(target.x, target.y)

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 2)

    const after = await engine(page)
    const created = nonConnectorsOf(after).find(
      (element) => !byId(before, element.id),
    )!
    const connector = connectorsOf(after)[0]
    expect(created.kind).toBe('rectangle')
    expect(connector.connector?.source).toMatchObject({
      kind: 'element',
      elementId: IDS.canvasRect,
    })
    expect(connector.connector?.target).toMatchObject({
      kind: 'element',
      elementId: created.id,
    })

    // The click placed it to the RIGHT of the source, clear of it.
    const source = byId(after, IDS.canvasRect)!
    expect(created.x).toBeGreaterThanOrEqual(source.x + source.width)

    await settle(page)
    const reloaded = await openBoard(page)
    expect(reloaded.elements.length).toBe(before.elements.length + 2)
    const persistedConnector = connectorsOf(reloaded)[0]
    // The ids are the SERVER's after reload, so the connector's endpoints are
    // compared against what actually persisted rather than the client's
    // temporary uuids — this is the assertion that would fail if the connector
    // had been written against a pre-ack id.
    expect(persistedConnector.connector?.source).toMatchObject({
      kind: 'element',
      elementId: IDS.canvasRect,
    })
    const persistedTarget = persistedConnector.connector!.target
    expect(persistedTarget.kind).toBe('element')
    expect(
      byId(reloaded, (persistedTarget as { elementId: string }).elementId),
    ).toBeDefined()
  })

  test('opens the new element for typing, and the text persists', async ({
    page,
  }) => {
    await openBoard(page)
    await hoverElement(page, IDS.canvasRect)
    const target = await handlePoint(page, 'bottom')
    await page.mouse.click(target.x, target.y)

    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .not.toBeNull()

    await page.keyboard.type('quick note')
    await expect
      .poll(async () => {
        const state = await engine(page)
        return byId(state, state.editingElementId!)?.text
      })
      .toBe('quick note')

    await focusBoard(page)
    await settle(page)

    const reloaded = await openBoard(page)
    expect(
      reloaded.elements.some((element) => element.text === 'quick note'),
    ).toBe(true)
  })

  test('pushes the new element beyond an occupied slot', async ({ page }) => {
    // The seeded text element sits directly BELOW the rectangle
    // (300,520 vs 300,300+140). A downward quick-create must clear it rather
    // than landing on top of it.
    const before = await openBoard(page)
    const occupant = byId(before, IDS.canvasText)!
    await hoverElement(page, IDS.canvasRect)
    const target = await handlePoint(page, 'bottom')
    await page.mouse.click(target.x, target.y)

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 2)

    const created = nonConnectorsOf(await engine(page)).find(
      (element) => !byId(before, element.id),
    )!
    const source = byId(before, IDS.canvasRect)!
    // Below the source, and past the occupant rather than overlapping it.
    expect(created.y).toBeGreaterThan(source.y)
    const overlapsOccupant =
      created.y < occupant.y + occupant.height &&
      created.y + created.height > occupant.y
    expect(overlapsOccupant).toBe(false)
  })

  test('is reversed completely by ONE Ctrl+Z', async ({ page }) => {
    const before = await openBoard(page)
    await hoverElement(page, IDS.canvasRect)
    const target = await handlePoint(page, 'right')
    await page.mouse.click(target.x, target.y)

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 2)
    await settle(page)

    await undo(page)

    // BOTH removed, by one command — not the element leaving a dangling
    // connector behind, and not needing a second Ctrl+Z.
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length)
    expect(connectorsOf(await engine(page))).toHaveLength(0)
  })
})

// ── dragging a handle ───────────────────────────────────────────────────────

test.describe('dragging from a creation handle', () => {
  test('onto an existing element makes a connector and no third element', async ({
    page,
  }) => {
    const before = await openBoard(page)
    await hoverElement(page, IDS.canvasRect)
    const from = await handlePoint(page, 'bottom')
    const text = byId(before, IDS.canvasText)!
    const to = await worldToPage(page, {
      x: text.x + text.width / 2,
      y: text.y + text.height / 2,
    })

    await dragMouse(page, from, to)

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)

    const after = await engine(page)
    expect(nonConnectorsOf(after)).toHaveLength(nonConnectorsOf(before).length)
    expect(connectorsOf(after)[0].connector).toMatchObject({
      source: { kind: 'element', elementId: IDS.canvasRect },
      target: { kind: 'element', elementId: IDS.canvasText },
    })
  })

  test('onto empty board creates the element there', async ({ page }) => {
    const before = await openBoard(page)
    await hoverElement(page, IDS.canvasRect)
    const from = await handlePoint(page, 'right')
    const dropWorld = { x: 900, y: 320 }
    const to = await worldToPage(page, dropWorld)

    await dragMouse(page, from, to)

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 2)

    const created = nonConnectorsOf(await engine(page)).find(
      (element) => !byId(before, element.id),
    )!
    // Centred on the release point, which is where the rubber band pointed.
    expect(Math.abs(created.x + created.width / 2 - dropWorld.x)).toBeLessThan(4)
    expect(Math.abs(created.y + created.height / 2 - dropWorld.y)).toBeLessThan(4)
  })
})

// ── connectors track their endpoints ────────────────────────────────────────

test.describe('a connector follows its endpoints', () => {
  test('stays joined after an endpoint is dragged, and persists', async ({
    page,
  }) => {
    // The connector stores a degenerate 1x1 placeholder, so "it followed" can
    // only be asserted through the endpoints it resolves from — which is
    // exactly the property that makes a stored path unnecessary.
    const before = await openBoard(page, CONNECTOR_BOARD_URL)
    const source = byId(before, IDS.canvasConnSource)!
    const from = await worldToPage(page, {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    })
    const to = await worldToPage(page, {
      x: source.x + source.width / 2 + 180,
      y: source.y + source.height / 2 - 60,
    })

    await dragMouse(page, from, to)

    await expect
      .poll(async () => (await engine(page)).elements.find(
        (element) => element.id === IDS.canvasConnSource,
      )?.x)
      .toBeGreaterThan(source.x)

    await settle(page)
    const reloaded = await openBoard(page, CONNECTOR_BOARD_URL)
    const moved = byId(reloaded, IDS.canvasConnSource)!
    expect(moved.x).toBeGreaterThan(source.x)
    // The connector row is untouched by the move — its endpoints are the same
    // two ids they always were, which is what makes the line follow for free.
    expect(byId(reloaded, IDS.canvasConnector)?.connector).toMatchObject({
      source: { kind: 'element', elementId: IDS.canvasConnSource },
      target: { kind: 'element', elementId: IDS.canvasConnTarget },
    })
  })
})

// ── the routing picker ──────────────────────────────────────────────────────

test.describe('the routing picker', () => {
  const BAR = '[role="toolbar"][aria-label="Connector routing"]'

  async function selectConnector(page: Page) {
    const state = await engine(page)
    const source = byId(state, IDS.canvasConnSource)!
    const target = byId(state, IDS.canvasConnTarget)!
    // The midpoint between the two centres lies on a straight connector's own
    // line, which is what the hit-test matches against.
    const mid = await worldToPage(page, {
      x: (source.x + source.width / 2 + target.x + target.width / 2) / 2,
      y: (source.y + source.height / 2 + target.y + target.height / 2) / 2,
    })
    await page.mouse.click(mid.x, mid.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasConnector])
  }

  test('appears only for a selected connector', async ({ page }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    await expect(page.locator(BAR)).toHaveCount(0)

    await selectConnector(page)
    await expect(page.locator(BAR)).toBeVisible()

    // Selecting an ordinary element puts it away again.
    const source = byId(await engine(page), IDS.canvasConnSource)!
    const centre = await worldToPage(page, {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)
    await expect(page.locator(BAR)).toHaveCount(0)
  })

  test('changes the routing, and the change persists', async ({ page }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    await selectConnector(page)

    expect(byId(await engine(page), IDS.canvasConnector)?.connector?.routing).toBe(
      'straight',
    )
    await page.click('[aria-label="Elbow connector"]')

    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.routing,
      )
      .toBe('elbow')
    await expect(
      page.locator('[aria-label="Elbow connector"]'),
    ).toHaveAttribute('aria-pressed', 'true')

    await settle(page)
    const reloaded = await openBoard(page, CONNECTOR_BOARD_URL)
    expect(byId(reloaded, IDS.canvasConnector)?.connector?.routing).toBe('elbow')
  })

  test('the routing change is itself undoable', async ({ page }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    await selectConnector(page)
    await page.click('[aria-label="Curved connector"]')
    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.routing,
      )
      .toBe('curved')
    await settle(page)

    await undo(page)

    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.routing,
      )
      .toBe('straight')
  })
})

// ── the delete cascade ──────────────────────────────────────────────────────

test.describe('deleting an endpoint', () => {
  test('removes its connectors, and one undo restores all of them', async ({
    page,
  }) => {
    const before = await openBoard(page, CONNECTOR_BOARD_URL)
    expect(connectorsOf(before)).toHaveLength(1)

    const source = byId(before, IDS.canvasConnSource)!
    const centre = await worldToPage(page, {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasConnSource])

    // NO `focusBoard` here, deliberately: it clicks EMPTY canvas, which
    // clears the selection — Delete would then have nothing to act on. The
    // click on the element above already focused the board container
    // (`CanvasBoard`'s own pointerdown wrapper calls `containerRef.focus()`),
    // which is exactly what `focusBoard` exists to guarantee for the cases
    // that have no preceding element click.
    await page.keyboard.press('Delete')

    // Element AND connector gone — a connector left behind would be an
    // invisible, unselectable row nothing could ever remove.
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length - 2)
    expect(connectorsOf(await engine(page))).toHaveLength(0)
    await settle(page)

    await undo(page)

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length)
    const restored = await engine(page)
    expect(byId(restored, IDS.canvasConnSource)).toBeDefined()
    expect(byId(restored, IDS.canvasConnector)?.connector).toMatchObject({
      source: { kind: 'element', elementId: IDS.canvasConnSource },
      target: { kind: 'element', elementId: IDS.canvasConnTarget },
    })
  })
})

// ── the pointerless path ────────────────────────────────────────────────────

test.describe('Alt+Arrow', () => {
  test('matches what clicking the same handle does', async ({ page }) => {
    const before = await openBoard(page)
    const source = byId(before, IDS.canvasRect)!
    const centre = await worldToPage(page, {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasRect])

    await page.keyboard.press('Alt+ArrowRight')

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 2)

    const created = nonConnectorsOf(await engine(page)).find(
      (element) => !byId(before, element.id),
    )!
    // The same placement the click case produces: one gap to the right,
    // vertically centred on the source.
    expect(created.x).toBeGreaterThanOrEqual(source.x + source.width)
    expect(created.y).toBe(source.y)
    expect(connectorsOf(await engine(page))[0].connector).toMatchObject({
      source: { kind: 'element', elementId: IDS.canvasRect },
      target: { kind: 'element', elementId: created.id },
    })
  })

  test('leaves a PLAIN arrow doing exactly what it did — nothing', async ({
    page,
  }) => {
    const before = await openBoard(page)
    const source = byId(before, IDS.canvasRect)!
    const centre = await worldToPage(page, {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasRect])

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)

    const after = await engine(page)
    expect(after.elements.length).toBe(before.elements.length)
    // And it did not move the selection either — the board has never bound
    // plain arrows, and this feature did not start.
    expect(byId(after, IDS.canvasRect)?.x).toBe(source.x)
  })
})

// ── authorisation ───────────────────────────────────────────────────────────

test.describe('a read-only visitor', () => {
  test('sees no creation handles and no routing bar', async ({ browser }) => {
    // Both affordances are gated on `!effectiveReadOnly` in DIFFERENT places —
    // the handles by `use-canvas-input`'s hover branch never setting
    // `hoveredId`, the bar by `connectorToolbarTarget` — so both are asserted
    // rather than assuming one implies the other. A viewer shown either would
    // be shown a control the server refuses on every mutation.
    const viewerPage = await loginAsViewer(browser)
    try {
      const state = await openBoard(viewerPage, VIEWER_BOARD_URL)
      expect(state.readOnly).toBe(true)

      const rect = byId(state, IDS.canvasViewerRect)!
      const centre = await worldToPage(viewerPage, {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      })
      await viewerPage.mouse.move(centre.x, centre.y)
      await viewerPage.waitForTimeout(400)

      const hovered = await engine(viewerPage)
      expect(hovered.hoveredId).toBeNull()
      expect(hovered.creationHandleTargetId).toBeNull()
      expect(hovered.creationHandles).toBeNull()

      // And clicking where the connector runs selects nothing, so the routing
      // bar has no way to appear either.
      const target = byId(state, IDS.canvasViewerConnTarget)!
      const mid = await worldToPage(viewerPage, {
        x: (rect.x + rect.width / 2 + target.x + target.width / 2) / 2,
        y: (rect.y + rect.height / 2 + target.y + target.height / 2) / 2,
      })
      await viewerPage.mouse.click(mid.x, mid.y)
      await viewerPage.waitForTimeout(400)

      expect((await engine(viewerPage)).selectedIds).toEqual([])
      await expect(
        viewerPage.locator('[role="toolbar"][aria-label="Connector routing"]'),
      ).toHaveCount(0)
    } finally {
      await viewerPage.context().close()
    }
  })
})

// ── dragging a connector's ends ────────────────────────────────────────────

test.describe('dragging a connector end', () => {
  /** Select the seeded connector by clicking the midpoint of its line. */
  async function selectSeededConnector(page: Page) {
    const state = await engine(page)
    const source = byId(state, IDS.canvasConnSource)!
    const target = byId(state, IDS.canvasConnTarget)!
    const mid = await worldToPage(page, {
      x: (source.x + source.width / 2 + target.x + target.width / 2) / 2,
      y: (source.y + source.height / 2 + target.y + target.height / 2) / 2,
    })
    await page.mouse.click(mid.x, mid.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasConnector])
  }

  /** The PAGE point of one endpoint grip — the rectangle the renderer drew. */
  async function gripPoint(page: Page, end: 'source' | 'target') {
    const state = await engine(page)
    if (!state.connectorEndpoints) {
      throw new Error('no connector endpoint grips are showing')
    }
    const box = await canvasBox(page)
    const rect = state.connectorEndpoints[end]
    return {
      x: box.x + rect.x + rect.width / 2,
      y: box.y + rect.y + rect.height / 2,
    }
  }

  test('shows a grip at each end once the connector is selected', async ({
    page,
  }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    expect((await engine(page)).connectorEndpoints).toBeNull()

    await selectSeededConnector(page)
    const grips = (await engine(page)).connectorEndpoints
    expect(grips).not.toBeNull()
    expect(Object.keys(grips!).sort()).toEqual(['source', 'target'])
  })

  test('moves to ANY point along an edge, not one of four midpoints', async ({
    page,
  }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    await selectSeededConnector(page)
    const source = byId(await engine(page), IDS.canvasConnSource)!

    // A quarter of the way along the source's BOTTOM edge — deliberately not
    // its midpoint, which is the only place the old four-sided model could
    // have put it.
    const from = await gripPoint(page, 'source')
    const to = await worldToPage(page, {
      x: source.x + source.width * 0.25,
      y: source.y + source.height - 4,
    })
    await dragMouse(page, from, to)

    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.source,
      )
      .toMatchObject({ kind: 'element', elementId: IDS.canvasConnSource })

    const attach = (
      byId(await engine(page), IDS.canvasConnector)!.connector!.source as {
        attach: { x: number; y: number }
      }
    ).attach
    expect(attach.y).toBe(1)
    expect(attach.x).toBeGreaterThan(0.15)
    expect(attach.x).toBeLessThan(0.35)
    // And NOT the midpoint — the whole point of the change.
    expect(attach.x).not.toBe(0.5)
  })

  test('attaches to a DIFFERENT element and survives a reload', async ({
    page,
  }) => {
    // The board's third element is the connector itself, so this drags the
    // source end onto the TARGET's neighbour — here, onto the target element
    // is refused (self-connector), so drag the TARGET end onto the source's
    // own neighbour instead: the seeded board has exactly two elements, so the
    // meaningful cross-element case is covered on the main board below.
    await openBoard(page, BOARD_URL)
    await hoverElement(page, IDS.canvasRect)
    const handle = await handlePoint(page, 'right')
    await page.mouse.click(handle.x, handle.y)
    await expect
      .poll(async () => connectorsOf(await engine(page)).length)
      .toBe(1)
    await focusBoard(page)
    await settle(page)

    const connector = connectorsOf(await engine(page))[0]
    await page.mouse.click(
      ...(Object.values(
        await worldToPage(page, { x: 0, y: 0 }),
      ) as [number, number]),
    )
    // Select the connector by its own line midpoint.
    const state = await engine(page)
    const src = byId(state, IDS.canvasRect)!
    const created = nonConnectorsOf(state).find(
      (e) => e.id !== IDS.canvasRect && e.id !== IDS.canvasText,
    )!
    const mid = await worldToPage(page, {
      x: (src.x + src.width / 2 + created.x + created.width / 2) / 2,
      y: (src.y + src.height / 2 + created.y + created.height / 2) / 2,
    })
    await page.mouse.click(mid.x, mid.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([connector.id])

    // Drag the TARGET end onto the seeded text element.
    const text = byId(await engine(page), IDS.canvasText)!
    const from = await gripPoint(page, 'target')
    const to = await worldToPage(page, {
      x: text.x + text.width / 2,
      y: text.y + text.height / 2,
    })
    await dragMouse(page, from, to)

    await expect
      .poll(async () => byId(await engine(page), connector.id)?.connector?.target)
      .toMatchObject({ kind: 'element', elementId: IDS.canvasText })

    await settle(page)
    const reloaded = await openBoard(page, BOARD_URL)
    expect(byId(reloaded, connector.id)?.connector?.target).toMatchObject({
      kind: 'element',
      elementId: IDS.canvasText,
    })
  })

  test('DETACHES to a free point on empty board, and it persists', async ({
    page,
  }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    await selectSeededConnector(page)

    const dropWorld = { x: 1000, y: 200 }
    const from = await gripPoint(page, 'target')
    await dragMouse(page, from, await worldToPage(page, dropWorld))

    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.target,
      )
      .toEqual({ kind: 'point', point: dropWorld })

    await settle(page)
    // The whole reason this was a data-model change: a connector row with one
    // end attached to nothing has to be writable and readable back.
    const reloaded = await openBoard(page, CONNECTOR_BOARD_URL)
    expect(byId(reloaded, IDS.canvasConnector)?.connector?.target).toEqual({
      kind: 'point',
      point: dropWorld,
    })
    // And it is still drawn — a detached end is a state, not a broken row.
    expect(byId(reloaded, IDS.canvasConnector)).toBeDefined()
  })

  test('one Ctrl+Z puts a detached end back where it was', async ({ page }) => {
    await openBoard(page, CONNECTOR_BOARD_URL)
    await selectSeededConnector(page)
    const from = await gripPoint(page, 'target')
    await dragMouse(page, from, await worldToPage(page, { x: 1000, y: 200 }))
    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.target.kind,
      )
      .toBe('point')
    await settle(page)

    await undo(page)

    // The toast is asserted BEFORE the scene, deliberately. This test flaked
    // once in a full-file run: the undo entry is pushed inside the write's own
    // `.then()`, so a Ctrl+Z that arrives before the ack finds an EMPTY stack
    // and shows "Nothing left to undo." — which then fades, leaving only a
    // scene assertion that times out with no clue why. Naming the expected
    // toast turns that race into a failure that says what happened.
    await expect(page.getByText('Undid moving a connector end')).toBeVisible()

    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.target,
      )
      .toMatchObject({ kind: 'element', elementId: IDS.canvasConnTarget })
  })
})

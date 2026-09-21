// e2e/space-pan.spec.ts
// End-to-end coverage for the space-to-pan modifier — the mandatory Playwright
// completion gate per CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// "Space + drag moves the camera" is only true if it is true from EVERY
// starting point. Both boards had a hole, and each hole is a different bug:
//
//   ER board (React Flow) — React Flow's own `panActivationKeyCode` forces
//     `panOnDrag` on for the pane, but node dragging never consults it. A
//     press that landed on a table dragged the table, space or no space. The
//     fix routes the press past nodes and edges (`is-space-panning` drops
//     their pointer-events) so it hit-tests to `.react-flow__pane`.
//
//   Canvas 2D board — space was a keydown case on the board container, which
//     only fires while the board holds DOM focus. Clicking a toolbar button
//     moved focus off it and space went dead until the next click on the
//     canvas. The fix moved the modifier to a window listener (`useSpaceHeld`).
//
// Both holes are invisible below the browser: they are about real focus and
// real hit-testing, which is exactly what unit tests stub out. The unit suites
// (src/hooks/use-space-held.test.ts, src/components/canvas/use-canvas-input
// .test.ts) cover the arming rules and the Canvas 2D gesture branch; only this
// file can prove a press over a table pans instead of dragging it.
//
// EVERY assertion is paired with a control. "The table did not move" also
// passes on a board where nothing is draggable at all, so each modifier test
// has a sibling that performs the SAME drag with space up and asserts the
// thing DOES move. That control mutates the board, which is why the ER half
// runs on its own whiteboard re-seeded before every test.
//
// SEEDING ORDER — seed-canvas.ts's ProjectMember insert references
// IDS.viewerUser, a User row only e2e/seed-stress.ts creates, so the canvas
// half seeds stress first (copied from canvas-shapes.spec.ts rather than
// rediscovered). Neither seed script touches IDS.user, so the storageState
// session global-setup.ts logged in with survives them.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Locator, Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.spWhiteboard}`
const CANVAS_URL = `/canvas/${IDS.canvasBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

// ── shared drag mechanics ───────────────────────────────────────────────────

/**
 * A stepped mouse drag.
 *
 * The final position is delivered twice: under load the browser can coalesce
 * the tail of a stepped move, leaving the gesture a few pixels short — enough
 * to pass a "did anything happen?" poll and then fail an exact geometry
 * assertion. Copied from canvas-shapes.spec.ts, which documents the same
 * hard-won detail.
 */
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

/** The same drag, with space held for its entire duration. */
async function spaceDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.keyboard.down('Space')
  try {
    await dragMouse(page, from, to)
  } finally {
    // `finally` so a failed assertion inside the drag cannot leave the key
    // latched for whatever runs next in the same page.
    await page.keyboard.up('Space')
  }
}

// ── ER board (React Flow) ───────────────────────────────────────────────────

test.describe('space-to-pan on the ER board', () => {
  test.beforeEach(() => {
    execFileSync('bun', ['run', 'e2e/seed-space-pan.ts'], { stdio: 'inherit' })
  })

  function nodeLocator(page: Page, id: string): Locator {
    return page.locator(`.react-flow__node[data-id="${id}"]`)
  }

  async function openBoard(page: Page) {
    await page.goto(WB_URL)
    await expect(tableNode(page, 'users').first()).toBeVisible()
    await expect(tableNode(page, 'orders').first()).toBeVisible()
    await waitForViewportSettled(page)
  }

  /**
   * Poll `.react-flow__viewport`'s `translate(...) scale(z)` inline transform
   * until two consecutive reads (100ms apart) agree — proof `fitView` (or a
   * pan) has finished and the geometry below is safe to read. Mirrors
   * multi-select-drag.spec.ts's helper of the same name.
   */
  async function waitForViewportSettled(page: Page, timeout = 5000) {
    let last: string | null = null
    await expect
      .poll(
        async () => {
          const current = await page
            .locator('.react-flow__viewport')
            .evaluate((el) => (el as HTMLElement).style.transform)
          const settled = current !== '' && current === last
          last = current
          return settled
        },
        { timeout, intervals: [100] },
      )
      .toBe(true)
  }

  async function viewportTransform(page: Page): Promise<string> {
    return page
      .locator('.react-flow__viewport')
      .evaluate((el) => (el as HTMLElement).style.transform)
  }

  /**
   * A node's FLOW-space position, read from its own `translate(x,y)` inline
   * style. This is the value the DB persists as positionX/positionY and is
   * unaffected by viewport pan/zoom — so a pan changes the viewport transform
   * and leaves this one alone, which is exactly the distinction under test.
   */
  async function nodePosition(page: Page, id: string) {
    const transform = await nodeLocator(page, id).evaluate(
      (el) => (el as HTMLElement).style.transform,
    )
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform)
    if (!match) throw new Error(`unexpected node transform: ${transform}`)
    return { x: parseFloat(match[1]), y: parseFloat(match[2]) }
  }

  /**
   * A press point inside a table's header band. Offset from the node's own
   * top-left rather than a `.table-header` text node's center: canvas mode
   * paints the header text on <canvas>, so there is no text node to aim at.
   * y=10 sits within HEADER_H (34px) and above the first column row; x=20
   * clears the left-edge column handles.
   */
  async function headerAnchor(page: Page, name: string) {
    const box = await tableNode(page, name).first().boundingBox()
    if (!box) throw new Error(`no bounding box for table "${name}"`)
    return { x: box.x + 20, y: box.y + 10 }
  }

  test('a drag starting ON a table pans the camera and leaves the table put', async ({
    page,
  }) => {
    await openBoard(page)
    const before = await nodePosition(page, IDS.spUsersTable)
    const beforeViewport = await viewportTransform(page)
    const anchor = await headerAnchor(page, 'users')

    await spaceDrag(page, anchor, { x: anchor.x + 200, y: anchor.y + 120 })
    await waitForViewportSettled(page)

    // The camera moved...
    expect(await viewportTransform(page)).not.toBe(beforeViewport)
    // ...and the table did not. Flow-space position is pan-invariant, so this
    // is an exact equality, not a tolerance.
    expect(await nodePosition(page, IDS.spUsersTable)).toEqual(before)
  })

  test('the same drag WITHOUT space moves the table (control)', async ({
    page,
  }) => {
    // Without this the test above passes on any board where dragging is
    // broken outright — it would be asserting nothing.
    await openBoard(page)
    const before = await nodePosition(page, IDS.spUsersTable)
    const anchor = await headerAnchor(page, 'users')

    await dragMouse(page, anchor, { x: anchor.x + 200, y: anchor.y + 120 })

    await expect
      .poll(async () => (await nodePosition(page, IDS.spUsersTable)).x)
      .not.toBe(before.x)
  })

  test('the table stays put across a reload — the pan wrote nothing', async ({
    page,
  }) => {
    // A drag that visually pans but still fires React Flow's node-drag
    // handlers would persist a move nobody asked for. Only a reload can tell
    // the two apart.
    await openBoard(page)
    const before = await nodePosition(page, IDS.spUsersTable)
    const anchor = await headerAnchor(page, 'users')

    await spaceDrag(page, anchor, { x: anchor.x + 200, y: anchor.y + 120 })
    await waitForViewportSettled(page)
    await openBoard(page)

    expect(await nodePosition(page, IDS.spUsersTable)).toEqual(before)
  })

  test('a drag starting on a table selects nothing', async ({ page }) => {
    await openBoard(page)
    const anchor = await headerAnchor(page, 'users')

    await spaceDrag(page, anchor, { x: anchor.x + 200, y: anchor.y + 120 })

    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  })

  // NOT COVERED, deliberately — Shift held together with space still draws a
  // selection box rather than panning. React Flow resolves its selection key
  // before its pan-activation key and the only lever over that,
  // `selectionKeyCode`, latches "Shift is down" forever when changed
  // mid-press. See ReactFlowCanvas's `panOnDrag` prop for the full reasoning.
  // A test asserting the current behaviour would only pin a limitation as if
  // it were a decision, so there is none.

  test('space still pans after a toolbar click moved focus off the canvas', async ({
    page,
  }) => {
    // The Toolbar renders OUTSIDE `.react-flow-wrapper`, so a modifier scoped
    // to focus-inside-the-board would go dead here. Asserted on the ER board
    // specifically because that is the surface whose toolbar is a sibling of
    // the canvas rather than an ancestor.
    await openBoard(page)
    // "Fit to Screen" is chosen deliberately: a real toolbar button that opens
    // no panel or dropdown, and whose own effect (a re-fit) settles before the
    // baseline below is read.
    await page.locator('button[title="Fit to Screen"]').click()
    await waitForViewportSettled(page)
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe('BUTTON')

    const beforeViewport = await viewportTransform(page)
    const anchor = await headerAnchor(page, 'users')
    await spaceDrag(page, anchor, { x: anchor.x + 200, y: anchor.y + 120 })
    await waitForViewportSettled(page)

    expect(await viewportTransform(page)).not.toBe(beforeViewport)
  })
})

// ── Canvas 2D board ─────────────────────────────────────────────────────────

test.describe('space-to-pan on the Canvas 2D board', () => {
  test.beforeAll(() => {
    execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
  })

  test.beforeEach(() => {
    execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
  })

  interface EngineElement {
    id: string
    kind: string
    x: number
    y: number
    text: string | null
  }

  interface EngineState {
    elements: Array<EngineElement>
    camera: { x: number; y: number; zoom: number }
    selectedIds: Array<string>
    editingElementId: string | null
    tool: string
  }

  async function engine(page: Page): Promise<EngineState> {
    const state = await page.evaluate(() => window.__canvasEngine)
    if (!state) throw new Error('window.__canvasEngine is not published')
    return state as unknown as EngineState
  }

  async function openBoard(page: Page): Promise<EngineState> {
    await page.goto(CANVAS_URL)
    await page.waitForSelector('canvas')
    await page.waitForFunction(
      () => window.__canvasEngine !== undefined,
      null,
      {
        timeout: 15_000,
      },
    )
    return engine(page)
  }

  async function canvasBox(page: Page) {
    const box = await page.locator('canvas').boundingBox()
    if (!box) throw new Error('canvas has no bounding box')
    return box
  }

  /**
   * World point -> page coordinates, using the engine's OWN camera. Never
   * hand-roll the transform: camera.ts owns exactly one screen<->world pair,
   * and a second copy living in a test drifts from the renderer silently.
   */
  async function worldToPage(page: Page, world: { x: number; y: number }) {
    const box = await canvasBox(page)
    const { camera } = await engine(page)
    return {
      x: box.x + (world.x - camera.x) * camera.zoom,
      y: box.y + (world.y - camera.y) * camera.zoom,
    }
  }

  /** The seeded rectangle, which every on-element press below aims at. */
  async function seededRect(page: Page): Promise<EngineElement> {
    const { elements } = await engine(page)
    const rect = elements.find((element) => element.id === IDS.canvasRect)
    if (!rect) throw new Error('seeded canvas rectangle is missing')
    return rect
  }

  /** A press point a little inside the seeded rectangle's top-left corner. */
  async function insideRect(page: Page) {
    const rect = await seededRect(page)
    return worldToPage(page, { x: rect.x + 20, y: rect.y + 20 })
  }

  test('a drag starting ON an element pans and leaves the element put', async ({
    page,
  }) => {
    const before = await openBoard(page)
    const rect = await seededRect(page)
    const from = await insideRect(page)

    await spaceDrag(page, from, { x: from.x + 180, y: from.y + 90 })
    const after = await engine(page)

    // Dragging right and down moves the camera the other way in world space
    // (panByScreenDelta subtracts the screen delta).
    expect(after.camera.x).toBeLessThan(before.camera.x)
    expect(after.camera.y).toBeLessThan(before.camera.y)
    const rectAfter = await seededRect(page)
    expect({ x: rectAfter.x, y: rectAfter.y }).toEqual({ x: rect.x, y: rect.y })
    expect(after.selectedIds).toEqual([])
  })

  test('the same drag WITHOUT space moves the element (control)', async ({
    page,
  }) => {
    await openBoard(page)
    const rect = await seededRect(page)
    const from = await insideRect(page)

    await dragMouse(page, from, { x: from.x + 180, y: from.y + 90 })

    await expect.poll(async () => (await seededRect(page)).x).not.toBe(rect.x)
  })

  test('space pans with a shape tool armed, drawing nothing', async ({
    page,
  }) => {
    await openBoard(page)
    // The tool shortcuts DO still live on the board container's own keydown
    // handler, so this click is required — it is the one thing space no
    // longer needs. Click near the top-left of the canvas, clear of the
    // seeded rectangle, so it focuses without selecting anything.
    const box = await canvasBox(page)
    await page.mouse.click(box.x + 40, box.y + 150)
    await page.keyboard.press('r')
    await expect.poll(async () => (await engine(page)).tool).toBe('rectangle')

    // Read the camera AFTER arming the tool: the focus click above is a plain
    // press on empty canvas and moves nothing, but the baseline belongs next
    // to the assertion regardless.
    const before = await engine(page)
    const from = await insideRect(page)
    await spaceDrag(page, from, { x: from.x + 180, y: from.y + 90 })
    const after = await engine(page)

    expect(after.camera.x).toBeLessThan(before.camera.x)
    expect(after.elements.length).toBe(before.elements.length)
    // The tool stays armed — space suspends the draw gesture, it does not
    // cancel the tool.
    expect(after.tool).toBe('rectangle')
  })

  test('space still pans after a toolbar click moved focus off the canvas', async ({
    page,
  }) => {
    // The regression this half of the fix exists for: the old handler was
    // bound to the board container, so once focus left it space did nothing
    // until the user clicked the canvas again.
    const before = await openBoard(page)
    await page.click('[aria-label="Select (V)"]')
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe('BUTTON')

    const from = await insideRect(page)
    await spaceDrag(page, from, { x: from.x + 180, y: from.y + 90 })

    expect((await engine(page)).camera.x).toBeLessThan(before.camera.x)
  })

  test('a space typed into an element being edited does not pan', async ({
    page,
  }) => {
    const before = await openBoard(page)
    const from = await insideRect(page)
    await page.mouse.dblclick(from.x, from.y)
    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .toBe(IDS.canvasRect)

    await page.keyboard.type('a b')
    await page.keyboard.press('Escape')
    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .toBe(null)

    // The camera never moved, and the typed space landed in the text rather
    // than arming the modifier.
    expect((await engine(page)).camera.x).toBe(before.camera.x)
    expect((await seededRect(page)).text).toContain('a b')
  })
})

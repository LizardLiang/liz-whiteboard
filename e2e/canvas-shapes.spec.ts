// e2e/canvas-shapes.spec.ts
// End-to-end coverage for the canvas engine's non-rectangular shape kinds —
// ellipse, diamond and triangle — the mandatory Playwright completion gate per
// CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// A shape kind is only real when three independent things agree about it: the
// TOOL creates it, the RENDERER traces its outline, and the HIT-TEST accepts
// exactly the region the renderer drew. Unit tests cover each separately —
// `render.test.ts` against a recording stub, `scene.test.ts` against the
// containment predicates — but nothing below the browser can prove they agree,
// and a renderer/hit-test disagreement produces the worst possible symptom: a
// shape the user can plainly see and cannot click. That agreement is what the
// "corner falls through" and "corner is unpainted" cases here exist to pin.
//
// Mirrors e2e/canvas-quick-create.spec.ts structure-for-structure, including
// its hard-won mechanics, which are duplicated rather than imported because
// that file exports none of them and every canvas e2e spec in this repo keeps
// its own local copy (e2e/canvas-helpers.ts holds React-Flow/ER-board helpers
// only, not FigJam canvas-engine ones):
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point: a
//     left sidebar and a top header inset the canvas, and a click past its edge
//     never reaches CanvasBoard's `containerRef.focus()`, which makes every
//     later keyboard shortcut go to `<body>` and read as "the shortcut does
//     nothing".
//   - `dragMouse` delivers the final position twice. Under load the browser can
//     coalesce the tail of a stepped move, leaving a draw a few pixels short —
//     which passes a "did it appear?" poll and then fails an exact geometry
//     assertion after reload.
//
// SEEDING ORDER — seed-canvas.ts's ProjectMember insert references
// IDS.viewerUser, a User row only e2e/seed-stress.ts creates. Seeding canvas
// onto a global-setup-only database fails with FOREIGN KEY. Hence the
// beforeAll, copied from canvas-quick-create.spec.ts rather than rediscovered.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist and broadcast in dev too.
// The documented `io === null` gap applies only to server functions running in
// the Vite process, which none of these are. The reload assertions below
// therefore prove real PERSISTENCE, not a workaround for a dev-only gap.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── the shapes under test ───────────────────────────────────────────────────

/**
 * The three kinds this suite adds, with the tool label and shortcut the
 * palette advertises for each.
 *
 * `rectangle` is deliberately absent from the parameterised cases: it is
 * already covered end-to-end by canvas-board.spec.ts, and it is the ONE shape
 * whose drawn outline is its bounding box — so the corner assertions below,
 * which are the point of this file, would be false for it.
 */
const SHAPES = [
  { kind: 'ellipse', label: 'Ellipse', shortcut: 'O', key: 'o' },
  { kind: 'diamond', label: 'Diamond', shortcut: 'D', key: 'd' },
  { kind: 'triangle', label: 'Triangle', shortcut: 'G', key: 'g' },
] as const

type ShapeKind = (typeof SHAPES)[number]['kind']

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
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  editingElementId: string | null
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

/**
 * World point -> page coordinates, using the engine's OWN camera.
 *
 * Never hand-roll the transform here. `camera.ts` owns exactly one
 * screen<->world pair, and a second one living in the test would drift from
 * the renderer silently — the exact bug class (W1/W3) the engine was designed
 * to make impossible.
 */
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
  // See the file header — deliver the target a second time so the end point is
  // deterministic under load.
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

/** See the file header — the measured box, near its TOP, never a fixed point. */
async function focusBoard(page: Page) {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 40, box.y + 150)
}

async function selectTool(page: Page, label: string, shortcut: string) {
  await page.click(`[aria-label="${label} (${shortcut})"]`)
}

/** Wait for the server ack, not merely the optimistic render. */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

function shapesOf(state: EngineState, kind: ShapeKind) {
  return state.elements.filter((element) => element.kind === kind)
}

/**
 * Is the pixel at this WORLD point painted (alpha > 0)?
 *
 * The canvas backing store is in DEVICE pixels while the camera transform
 * speaks CSS pixels, so the ratio is measured from the canvas itself rather
 * than assumed to be 1 — a HiDPI runner would otherwise sample a point a
 * factor of two away from the one asked for and report every probe as empty.
 */
async function paintedAtWorld(
  page: Page,
  world: { x: number; y: number },
): Promise<boolean> {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      if (!c) return false
      const ctx = c.getContext('2d')
      if (!ctx) return false
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const cssX = (target.x - view.x) * view.zoom
      const cssY = (target.y - view.y) * view.zoom
      const x = Math.round(cssX * ratio)
      const y = Math.round(cssY * ratio)
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return false
      return ctx.getImageData(x, y, 1, 1).data[3] > 0
    },
    { target: world, view: camera },
  )
}

/**
 * Draw one shape by dragging its tool across a fixed world rect.
 *
 * The rect is chosen well clear of the seeded elements so nothing under it can
 * absorb the pointerdown, and it is returned so each caller can derive its own
 * centre and corners from the SAME numbers the drag used.
 */
const DRAW_RECT = { x: 600, y: 420, width: 240, height: 160 }

async function drawShape(page: Page, shape: (typeof SHAPES)[number]) {
  await selectTool(page, shape.label, shape.shortcut)
  const from = await worldToPage(page, { x: DRAW_RECT.x, y: DRAW_RECT.y })
  const to = await worldToPage(page, {
    x: DRAW_RECT.x + DRAW_RECT.width,
    y: DRAW_RECT.y + DRAW_RECT.height,
  })
  await dragMouse(page, from, to)
  await expect
    .poll(async () => shapesOf(await engine(page), shape.kind).length, {
      timeout: 10_000,
    })
    .toBe(1)
  await settle(page)
  return shapesOf(await engine(page), shape.kind)[0]
}

const CENTRE = {
  x: DRAW_RECT.x + DRAW_RECT.width / 2,
  y: DRAW_RECT.y + DRAW_RECT.height / 2,
}

/**
 * A world point inside the bounding box's top-left corner and outside all
 * three outlines — the point that separates "drawn as its own shape" from
 * "drawn as its bounding box".
 *
 * 8% in from each side, not 3 world units. At the very corner it sits under
 * the element's own NW RESIZE GRIP, an 8px screen square centred on that
 * corner: a probe there reads the grip's pixels for as long as the shape is
 * selected and reports every kind as "painted in the corner". 8% clears the
 * grip at 1x zoom while staying comfortably outside each outline (the diamond
 * is the tightest at |0.42| + |0.42| of its half-extents, well past 0.5).
 */
const BOX_CORNER = {
  x: DRAW_RECT.x + DRAW_RECT.width * 0.08,
  y: DRAW_RECT.y + DRAW_RECT.height * 0.08,
}

// ── the palette ─────────────────────────────────────────────────────────────

test.describe('the shape palette', () => {
  test('offers every shape kind the engine can draw, each with its shortcut', async ({
    page,
  }) => {
    await openBoard(page)
    const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
    // Rectangle is asserted alongside the three new kinds: the palette is
    // derived from CANVAS_SHAPE_KINDS, so a mistake there drops shapes rather
    // than adding them, and only checking the new ones would miss that.
    for (const label of ['Rectangle (R)', 'Ellipse (O)', 'Diamond (D)', 'Triangle (G)']) {
      await expect(toolbar.getByRole('button', { name: label })).toBeVisible()
    }
  })

  for (const shape of SHAPES) {
    test(`selects the ${shape.kind} tool from its keyboard shortcut`, async ({
      page,
    }) => {
      await openBoard(page)
      await focusBoard(page)
      await page.keyboard.press(shape.key)
      await expect
        .poll(async () => (await engine(page)).tool, { timeout: 5_000 })
        .toBe(shape.kind)
    })
  }
})

// ── drawing and persistence ─────────────────────────────────────────────────

test.describe('drawing a shape', () => {
  for (const shape of SHAPES) {
    test(`drags out a ${shape.kind}, persists it, and returns to the select tool`, async ({
      page,
    }) => {
      await openBoard(page)
      const drawn = await drawShape(page, shape)

      expect(drawn.kind).toBe(shape.kind)
      expect(Math.round(drawn.width)).toBe(DRAW_RECT.width)
      expect(Math.round(drawn.height)).toBe(DRAW_RECT.height)
      // One-shot, exactly as the rectangle tool has always been — the board
      // returns to select so the new shape can be moved straight away.
      expect((await engine(page)).tool).toBe('select')

      // The row, not the optimistic scene. A kind that reached the client but
      // not the `kind` column would look identical until the next reload.
      await page.reload()
      await page.waitForSelector('canvas')
      await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
        timeout: 15_000,
      })
      const reloaded = shapesOf(await engine(page), shape.kind)
      expect(reloaded).toHaveLength(1)
      expect(Math.round(reloaded[0].width)).toBe(DRAW_RECT.width)
      expect(Math.round(reloaded[0].height)).toBe(DRAW_RECT.height)
    })
  }
})

// ── the renderer and the hit-test agree ─────────────────────────────────────

test.describe('a shape is clickable exactly where it is drawn', () => {
  for (const shape of SHAPES) {
    test(`selects a ${shape.kind} from its centre but not from the corner of its box`, async ({
      page,
    }) => {
      await openBoard(page)
      const drawn = await drawShape(page, shape)

      // Deselect first: the draw itself leaves the new shape selected, so a
      // corner click that did nothing at all would otherwise still read as
      // "selected" and pass.
      await focusBoard(page)
      await expect
        .poll(async () => (await engine(page)).selectedIds.length, {
          timeout: 5_000,
        })
        .toBe(0)

      // Inside the bounding RECT, outside all three of these outlines.
      const corner = await worldToPage(page, BOX_CORNER)
      await page.mouse.click(corner.x, corner.y)
      await expect
        .poll(async () => (await engine(page)).selectedIds, { timeout: 5_000 })
        .toEqual([])

      const centre = await worldToPage(page, CENTRE)
      await page.mouse.click(centre.x, centre.y)
      await expect
        .poll(async () => (await engine(page)).selectedIds, { timeout: 5_000 })
        .toEqual([drawn.id])
    })

    test(`paints a ${shape.kind}'s centre and leaves the corner of its box empty`, async ({
      page,
    }) => {
      // The other half of the same agreement, read off the actual pixels: the
      // hit-test case above would also pass if the renderer drew nothing at
      // all in that corner because it drew nothing anywhere.
      await openBoard(page)
      await drawShape(page, shape)

      // Deselect so the selection outline — which IS drawn around the full
      // bounding box for every kind — cannot paint the corner being probed.
      await focusBoard(page)
      await expect
        .poll(async () => (await engine(page)).selectedIds.length, {
          timeout: 5_000,
        })
        .toBe(0)

      // POLLED, not read once. `selectedIds` is React state and empties a
      // frame before the canvas repaints without the selection chrome, so a
      // single read here races the redraw that removes it.
      await expect
        .poll(() => paintedAtWorld(page, CENTRE), { timeout: 5_000 })
        .toBe(true)
      await expect
        .poll(() => paintedAtWorld(page, BOX_CORNER), { timeout: 5_000 })
        .toBe(false)
    })
  }
})

// ── the rest of the canvas treats a shape as a shape ────────────────────────

test.describe('shape kinds flow through the existing gestures', () => {
  test('a quick-created sibling inherits the source shape kind', async ({
    page,
  }) => {
    // `makeSibling` copies `source.kind`, so this needs no per-kind code — but
    // that is precisely why it needs a test: nothing in the quick-create path
    // mentions ellipses, so a regression there would be silent.
    await openBoard(page)
    const drawn = await drawShape(page, SHAPES[0])

    const centre = await worldToPage(page, CENTRE)
    await page.mouse.click(centre.x, centre.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds, { timeout: 5_000 })
      .toEqual([drawn.id])

    // The pointerless quick-create: Alt+Arrow makes a sibling one gap away,
    // plus the connector joining them.
    await page.keyboard.press('Alt+ArrowRight')
    await expect
      .poll(async () => shapesOf(await engine(page), 'ellipse').length, {
        timeout: 10_000,
      })
      .toBe(2)
    await settle(page)

    const state = await engine(page)
    const sibling = shapesOf(state, 'ellipse').find((e) => e.id !== drawn.id)!
    expect(sibling.width).toBeCloseTo(drawn.width, 1)
    expect(sibling.height).toBeCloseTo(drawn.height, 1)
    expect(state.elements.filter((e) => e.kind === 'connector')).toHaveLength(1)
  })

  test('undo removes a drawn shape and names its kind', async ({ page }) => {
    await openBoard(page)
    const drawn = await drawShape(page, SHAPES[1])

    await focusBoard(page)
    await page.keyboard.press('Control+z')

    await expect
      .poll(async () => shapesOf(await engine(page), 'diamond').length, {
        timeout: 10_000,
      })
      .toBe(0)
    // The toast names the kind rather than falling back to "element" — the
    // Record in canvas-undo/messages.ts is what makes that a compile error to
    // forget, and this is the visible consequence.
    await expect(page.getByText('Undid creating a diamond')).toBeVisible({
      timeout: 5_000,
    })
    expect(drawn.kind).toBe('diamond')
  })
})

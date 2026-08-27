// e2e/canvas-dot-grid.spec.ts
// End-to-end coverage for the FigJam-style dot grid and the snapping that puts
// a new shape's borders on it — the mandatory Playwright completion gate per
// CLAUDE.md.
//
// TWO HALVES, AND WHY BOTH ARE HERE
// The feature is one promise kept by two mechanisms that know nothing about
// each other: dots painted as a CSS background (`grid.ts`'s
// `dotGridBackground`, applied in `CanvasBoard.tsx`) and geometry snapped in
// the input hook (`grid.ts`'s `snapRect`/`snapPoint`). Unit tests prove each
// half in isolation; only a real browser can prove they AGREE — that the
// spacing the user sees is the spacing a shape lands on. The first test reads
// the drawn spacing out of the DOM and the last three read the snapped
// geometry out of the engine, and both are checked against the same number.
//
// The grid is DOM, not canvas: unlike everything in canvas-board.spec.ts it can
// be queried directly (`[data-testid="canvas-dot-grid"]`), and its computed
// style is the ground truth for what was painted.
//
// Isolation and seeding mirror canvas-board.spec.ts: dedicated project and
// board, re-seeded before every test because these cases create elements.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

/**
 * The grid spacing in WORLD units, duplicated from
 * `src/lib/canvas-engine/grid.ts`.
 *
 * Duplicated on purpose. An e2e that imported the constant would assert the
 * app agrees with itself, and would keep passing if the value changed silently
 * underneath it. Written out here, this file records what the board is
 * supposed to look like, so changing `GRID_SIZE` has to be done twice —
 * deliberately, in a diff a reviewer can see.
 */
const GRID_SIZE = 20

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed-canvas.ts reuses IDS.viewerUser as a project member, and that account
  // is created by seed-stress.ts — the ordering canvas-board.spec.ts documents.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── helpers ─────────────────────────────────────────────────────────────────

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  tool: string
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

async function openBoard(page: Page): Promise<EngineState> {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
}

/**
 * World point -> page coordinates, using the engine's OWN camera.
 *
 * Never hand-roll the transform here, for the reason canvas-board.spec.ts
 * records: `camera.ts` owns exactly one screen<->world pair.
 */
async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
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
  // Delivered twice for the reason canvas-board.spec.ts documents: under load
  // the browser can coalesce the tail of a stepped move.
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

async function selectTool(page: Page, label: string) {
  await page.click(`[aria-label="${label}"]`)
}

/** The grid layer's computed background, as the browser resolved it. */
async function gridStyle(page: Page) {
  const style = await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="canvas-dot-grid"]')
    if (!layer) return null
    const computed = window.getComputedStyle(layer)
    const [sizeX, sizeY] = computed.backgroundSize.split(' ')
    const [posX, posY] = computed.backgroundPosition.split(' ')
    return {
      image: computed.backgroundImage,
      sizeX: Number.parseFloat(sizeX),
      sizeY: Number.parseFloat(sizeY ?? sizeX),
      posX: Number.parseFloat(posX),
      posY: Number.parseFloat(posY ?? posX),
    }
  })
  if (!style) throw new Error('the dot grid layer is not in the DOM')
  return style
}

/** A value folded into `[0, period)` — CSS is free to normalise either way. */
function wrap(value: number, period: number): number {
  return ((value % period) + period) % period
}

/** The element created since `before`, or a failure if none or many appeared. */
function createdSince(before: EngineState, after: EngineState): EngineElement {
  const fresh = after.elements.filter(
    (element) => !before.elements.some((seen) => seen.id === element.id),
  )
  expect(fresh).toHaveLength(1)
  return fresh[0]
}

/** Every border of `element` sits on a dot. This is the whole feature. */
function expectBordersOnDots(element: EngineElement) {
  const borders = [
    ['left', element.x],
    ['top', element.y],
    ['right', element.x + element.width],
    ['bottom', element.y + element.height],
  ] as const
  for (const [name, value] of borders) {
    // `Math.abs` because `-140 % 20` is negative zero, which `toBe` rejects.
    expect(
      Math.abs(value % GRID_SIZE),
      `${name} border at ${value} is off the dot grid`,
    ).toBe(0)
  }
}

// ── the dots themselves ─────────────────────────────────────────────────────

test.describe('the dot grid is painted', () => {
  test('tiles evenly at the grid spacing, behind the canvas', async ({
    page,
  }) => {
    await openBoard(page)

    const layer = page.locator('[data-testid="canvas-dot-grid"]')
    await expect(layer).toBeAttached()

    const style = await gridStyle(page)
    // A radial gradient is what makes them DOTS rather than rules — a grid of
    // lines would tile at the same size and pass every other assertion here.
    expect(style.image).toContain('radial-gradient')
    // Square tiles at 1x zoom: horizontal and vertical spacing are the same
    // number, and that number is the grid shapes snap to. "Every dot the same
    // distance from the next" IS this assertion.
    expect(style.sizeX).toBeCloseTo(GRID_SIZE, 1)
    expect(style.sizeY).toBeCloseTo(GRID_SIZE, 1)

    // Decorative and never a pointer target: every gesture belongs to the
    // canvas painted over it, so this layer must not swallow a drag.
    await expect(layer).toHaveCSS('pointer-events', 'none')
  })

  test('the dots pan with the board rather than sticking to the glass', async ({
    page,
  }) => {
    // The difference a user sees: a background fixed to the viewport would let
    // shapes slide across a stationary grid, and borders that were on dots when
    // drawn would end up on nothing.
    await openBoard(page)

    await selectTool(page, 'Pan (H)')
    await dragMouse(page, { x: 900, y: 600 }, { x: 763, y: 489 })

    await expect
      .poll(async () => Math.abs((await engine(page)).camera.x))
      .toBeGreaterThan(50)

    const { camera } = await engine(page)
    const style = await gridStyle(page)
    // Phase follows the camera exactly. The tile carries its dot at the
    // centre, so the background origin sits half a tile back from the world
    // grid line through 0 — the same expression `dotGridBackground` builds.
    const expected = -camera.x * camera.zoom - style.sizeX / 2
    expect(wrap(style.posX, style.sizeX)).toBeCloseTo(
      wrap(expected, style.sizeX),
      1,
    )
  })

  test('thins as the board zooms out so the dots stay legible', async ({
    page,
  }) => {
    // At 0.1x the full-resolution grid would be 2 screen pixels apart, which
    // reads as a dirty grey wash rather than as a grid. The spacing doubles
    // instead — and ONLY ever doubles, so every dot drawn is still a real grid
    // point and a snapped border can never land between two visible dots.
    await openBoard(page)
    const at1x = await gridStyle(page)

    const box = await page.locator('canvas').boundingBox()
    if (!box) throw new Error('canvas has no bounding box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 30; i += 1) {
      const { camera } = await engine(page)
      if (camera.zoom < 0.5) break
      await page.mouse.wheel(0, 300)
    }
    await expect
      .poll(async () => (await engine(page)).camera.zoom)
      .toBeLessThan(0.5)

    const { camera } = await engine(page)
    const zoomed = await gridStyle(page)
    const worldSpacing = zoomed.sizeX / camera.zoom
    const octaves = Math.log2(worldSpacing / GRID_SIZE)

    expect(zoomed.sizeX).toBeGreaterThanOrEqual(12)
    expect(worldSpacing).toBeGreaterThan(at1x.sizeX)
    expect(Math.abs(octaves - Math.round(octaves))).toBeLessThan(0.02)
  })
})

// ── the promise: a created shape's borders land on the dots ─────────────────

test.describe('a created shape sits on the dots', () => {
  test('a dragged rectangle snaps all four borders from an off-grid drag', async ({
    page,
  }) => {
    const before = await openBoard(page)
    await selectTool(page, 'Rectangle (R)')

    // Deliberately off-grid on every edge: 707 -> 700, 163 -> 160, 891 -> 900,
    // 294 -> 300. Nothing here is a multiple of 20, so a rectangle that comes
    // back on the grid can only have been snapped. Note the width GROWS from
    // 184 to 200 — each edge snaps independently, rather than the whole rect
    // sliding and leaving its far borders between dots.
    await dragMouse(
      page,
      await worldToPage(page, { x: 707, y: 163 }),
      await worldToPage(page, { x: 891, y: 294 }),
    )

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)

    const drawn = createdSince(before, await engine(page))
    expectBordersOnDots(drawn)
    expect(drawn.x).toBe(700)
    expect(drawn.y).toBe(160)
    expect(drawn.width).toBe(200)
    expect(drawn.height).toBe(140)
  })

  test('a click creates a default-sized shape whose borders are on dots too', async ({
    page,
  }) => {
    // A click, not a drag: the default size applies. It is a whole number of
    // cells precisely so this path needs no second rule — snapping the origin
    // is enough to put all four borders on dots.
    const before = await openBoard(page)
    await selectTool(page, 'Ellipse (O)')

    const at = await worldToPage(page, { x: 511, y: 349 })
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.up()

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)

    const created = createdSince(before, await engine(page))
    expect(created.kind).toBe('ellipse')
    expectBordersOnDots(created)
    expect(created.x).toBe(520)
    expect(created.y).toBe(340)
  })

  test('the snapped geometry is what gets persisted, not just what is drawn', async ({
    page,
  }) => {
    // The snap happens in the input hook, so it could in principle apply to
    // the local scene and be lost on the way to the server. A reload is the
    // only thing that proves the stored row carries the snapped rect.
    const before = await openBoard(page)
    await selectTool(page, 'Rectangle (R)')

    await dragMouse(
      page,
      await worldToPage(page, { x: 1013, y: 587 }),
      await worldToPage(page, { x: 1149, y: 693 }),
    )

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)
    const drawn = createdSince(before, await engine(page))
    await page.waitForTimeout(800)

    // Matched by absence-from-`before`, NOT by id. The client creates
    // optimistically with its own uuid and the server answers with a different
    // one (`remapElementId` in use-canvas-input.ts), so the id held here is
    // not necessarily the id the reloaded board carries — an id comparison
    // fails for a reason that has nothing to do with the geometry under test.
    const reloaded = await openBoard(page)
    const persisted = createdSince(before, reloaded)
    expect(persisted, 'the drawn rectangle survived the reload').toBeTruthy()
    expectBordersOnDots(persisted)
    expect(persisted.x).toBe(drawn.x)
    expect(persisted.y).toBe(drawn.y)
    expect(persisted.width).toBe(drawn.width)
    expect(persisted.height).toBe(drawn.height)
  })
})

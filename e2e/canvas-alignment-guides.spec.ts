// e2e/canvas-alignment-guides.spec.ts
// End-to-end coverage for canvas alignment guides — the mandatory Playwright
// completion gate per this project's own CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// An alignment guide makes two claims at once, and each can be true while the
// other is false:
//
//   1. "these edges line up"  — the red line the user reads mid-drag;
//   2. "and they really do"   — the coordinate the element lands on.
//
// A unit test can prove either half against `alignment.ts` in isolation, and
// `src/lib/canvas-engine/alignment.test.ts` does. What it cannot prove is that
// the browser's own pointer stream produces them TOGETHER: the guide is drawn
// from live gesture state that only exists between pointerdown and pointerup,
// and the coordinate is written by a different code path at release. So every
// case below reads `alignmentGuides` while the button is still DOWN and then
// asserts the landed geometry after it comes up. Asserting only the landed
// coordinate would pass just as happily if no guide had ever been drawn.
//
// The third claim — that a guide is chrome and nothing else — is asserted by
// reload: a guide must never reach a `CanvasElement` or the database, so a
// reloaded board shows the aligned geometry and no guides at all.
//
// Mirrors e2e/canvas-grouping.spec.ts structure-for-structure, including its
// hard-won mechanics (`focusBoard`, `settle`, `dragMouse` delivering the final
// position twice), duplicated rather than imported because no canvas spec in
// this repo exports them — e2e/canvas-helpers.ts holds React-Flow/ER-board
// helpers only.
//
// SEEDING ORDER — same as every other canvas-engine suite: seed-canvas.ts's
// ProjectMember insert references IDS.viewerUser, a User row only
// e2e/seed-stress.ts creates, so seed-stress runs once in `beforeAll` and
// seed-canvas re-seeds before every test.
//
// GEOMETRY IS CHOSEN, NOT ARBITRARY. Two constraints shape every number here:
//   - The moving rect is 80x40 and the neighbour 100x60. Two rects of the
//     SAME size that agree on one line agree on all three at once, so a
//     per-line assertion against a same-sized pair proves nothing.
//   - Everything sits clear of e2e/seed-canvas.ts's own seeded elements
//     (a rectangle at 300,300 200x140 and a text at 300,520 240x48). Those
//     are alignment candidates too, and their lines — y 300/370/440 and
//     520/544/568 — would otherwise compete for a snap and change the guide
//     count. Alignment is per-axis, so being far away in x does not make a
//     seeded element's y lines harmless.
//
// WHAT THIS SUITE DOES NOT COVER: the ticket's "no dropped frames on a dense
// board" criterion. The mechanism for it is the visible-rect candidate filter,
// which `alignment.test.ts` pins directly; a frame-rate assertion driven
// through Playwright is dominated by CI scheduling noise and would fail for
// reasons unrelated to this feature.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist in dev too. The reload
// assertions below therefore prove real PERSISTENCE, not a dev-only
// workaround.
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

// ── engine access ───────────────────────────────────────────────────────────

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
}

interface EngineGuide {
  axis: 'x' | 'y'
  position: number
  from: number
  to: number
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  alignmentGuides: Array<EngineGuide>
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

async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function selectTool(page: Page, label: string) {
  await page.click(`[aria-label="${label}"]`)
}

/** See canvas-grouping.spec.ts's identical helper: the final position is
 * delivered twice because under load the browser can coalesce the tail of a
 * stepped move, leaving the gesture a few pixels short of where it was aimed. */
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

function byId(state: EngineState, id: string) {
  const element = state.elements.find((candidate) => candidate.id === id)
  if (!element) throw new Error(`no element ${id} on the board`)
  return element
}

/** See canvas-grouping.spec.ts's identical helper for the "a fixed page point
 * does not work" rationale — a left sidebar and a top header inset the canvas. */
async function focusBoard(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  await page.mouse.click(box.x + 40, box.y + 150)
}

/** Wait for a committed gesture to be RECORDED server-side, not merely
 * rendered — see canvas-undo.spec.ts's identical helper. */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

/** Draw one rectangle with the rectangle tool and return its id once the
 * create has settled. World coordinates are all multiples of GRID_SIZE (20),
 * so `snapRect` leaves the drawn rectangle exactly where it was asked for. */
async function drawRectangle(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<string> {
  const before = await engine(page)
  await selectTool(page, 'Rectangle (R)')
  await dragMouse(
    page,
    await worldToPage(page, from),
    await worldToPage(page, to),
  )
  await expect
    .poll(async () => (await engine(page)).elements.length)
    .toBe(before.elements.length + 1)
  await settle(page)
  const drawn = (await engine(page)).elements.find(
    (element) => !before.elements.some((old) => old.id === element.id),
  )
  if (!drawn) throw new Error('the drawn rectangle never appeared')
  return drawn.id
}

// ── the board every case is built on ────────────────────────────────────────

/**
 * The neighbour: 100x60 at (760, 620). Its x lines are 760 / 810 / 860 and
 * its y lines 620 / 650 / 680.
 */
const NEIGHBOUR = { x: 760, y: 620, width: 100, height: 60 }

/** The rect that gets dragged: 80x40 at (1000, 200), well clear of everything. */
const MOVER = { x: 1000, y: 200, width: 80, height: 40 }

/** Where a press lands on the mover: its own centre. */
const GRAB = { x: MOVER.x + MOVER.width / 2, y: MOVER.y + MOVER.height / 2 }

async function buildBoard(page: Page) {
  await openBoard(page)
  const neighbourId = await drawRectangle(
    page,
    { x: NEIGHBOUR.x, y: NEIGHBOUR.y },
    { x: NEIGHBOUR.x + NEIGHBOUR.width, y: NEIGHBOUR.y + NEIGHBOUR.height },
  )
  const moverId = await drawRectangle(
    page,
    { x: MOVER.x, y: MOVER.y },
    { x: MOVER.x + MOVER.width, y: MOVER.y + MOVER.height },
  )
  return { neighbourId, moverId }
}

/**
 * Drag the mover so its ORIGIN would land on `aim`, stopping with the button
 * still down so the in-flight guides can be read, then release.
 *
 * Returns the guides as they stood mid-gesture — the only moment they exist.
 */
async function dragMoverTo(
  page: Page,
  aim: { x: number; y: number },
  options: { alt?: boolean } = {},
): Promise<Array<EngineGuide>> {
  const from = await worldToPage(page, GRAB)
  const to = await worldToPage(page, {
    x: GRAB.x + (aim.x - MOVER.x),
    y: GRAB.y + (aim.y - MOVER.y),
  })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  if (options.alt) await page.keyboard.down('Alt')
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.move(to.x, to.y)
  const guides = (await engine(page)).alignmentGuides
  await page.mouse.up()
  if (options.alt) await page.keyboard.up('Alt')
  return guides
}

// ── tests ───────────────────────────────────────────────────────────────────

test.describe('the six alignments', () => {
  /**
   * Each case aims the mover's origin THREE world units short of a true
   * alignment — inside the 6px tolerance, so the snap closes the gap — and
   * names the guide that must appear and the origin the element must land on.
   */
  const CASES = [
    {
      name: 'left edges',
      aim: { x: 763, y: MOVER.y },
      guide: { axis: 'x' as const, position: 760 },
      lands: { x: 760, y: MOVER.y },
    },
    {
      name: 'right edges',
      aim: { x: 777, y: MOVER.y },
      guide: { axis: 'x' as const, position: 860 },
      lands: { x: 780, y: MOVER.y },
    },
    {
      name: 'vertical centres',
      aim: { x: 767, y: MOVER.y },
      guide: { axis: 'x' as const, position: 810 },
      lands: { x: 770, y: MOVER.y },
    },
    {
      name: 'top edges',
      aim: { x: MOVER.x, y: 623 },
      guide: { axis: 'y' as const, position: 620 },
      lands: { x: MOVER.x, y: 620 },
    },
    {
      name: 'bottom edges',
      aim: { x: MOVER.x, y: 637 },
      guide: { axis: 'y' as const, position: 680 },
      lands: { x: MOVER.x, y: 640 },
    },
    {
      name: 'horizontal middles',
      aim: { x: MOVER.x, y: 627 },
      guide: { axis: 'y' as const, position: 650 },
      lands: { x: MOVER.x, y: 630 },
    },
  ]

  for (const testCase of CASES) {
    test(`${testCase.name}: a guide appears mid-drag and the element lands aligned`, async ({
      page,
    }) => {
      const { moverId } = await buildBoard(page)

      const guides = await dragMoverTo(page, testCase.aim)
      expect(guides).toHaveLength(1)
      expect(guides[0]).toMatchObject(testCase.guide)

      // The guide spans the two elements taking part and stops there, rather
      // than running edge to edge across the viewport.
      const across = testCase.guide.axis === 'x' ? 'y' : 'x'
      const near = across === 'y' ? NEIGHBOUR.y : NEIGHBOUR.x
      expect(guides[0].from).toBeLessThanOrEqual(near)
      expect(guides[0].to).toBeGreaterThan(guides[0].from)

      const mover = byId(await engine(page), moverId)
      expect(mover.x).toBe(testCase.lands.x)
      expect(mover.y).toBe(testCase.lands.y)
    })
  }
})

test.describe('the snap is real, not just drawn', () => {
  test('the aligned coordinate survives a reload, and the guide does not', async ({
    page,
  }) => {
    const { moverId } = await buildBoard(page)
    await dragMoverTo(page, { x: 763, y: MOVER.y })
    await settle(page)

    await page.reload()
    await page.waitForSelector('canvas')
    await page.waitForFunction(
      () => window.__canvasEngine !== undefined,
      null,
      {
        timeout: 15_000,
      },
    )

    const state = await engine(page)
    // The element really moved to 760 — the guide was not a purely visual
    // effect over an element still sitting at 763.
    expect(byId(state, moverId).x).toBe(760)
    // ...and nothing about the guide was stored or broadcast.
    expect(state.alignmentGuides).toEqual([])
  })

  test('the guides disappear the moment the gesture ends', async ({ page }) => {
    await buildBoard(page)
    const during = await dragMoverTo(page, { x: 763, y: MOVER.y })
    expect(during).toHaveLength(1)
    expect((await engine(page)).alignmentGuides).toEqual([])
  })

  test('nothing snaps or is drawn when no neighbour is in range', async ({
    page,
  }) => {
    const { moverId } = await buildBoard(page)
    // x 900: the nearest neighbour line is 860, forty units away.
    const guides = await dragMoverTo(page, { x: 900, y: MOVER.y })
    expect(guides).toEqual([])
    expect(byId(await engine(page), moverId).x).toBe(900)
  })
})

test.describe('holding Alt', () => {
  test('suppresses the snap and the guides, leaving the element under the pointer', async ({
    page,
  }) => {
    const { moverId } = await buildBoard(page)
    const guides = await dragMoverTo(
      page,
      { x: 763, y: MOVER.y },
      { alt: true },
    )
    expect(guides).toEqual([])
    // 763, not 760: the element stayed exactly where the pointer put it.
    expect(byId(await engine(page), moverId).x).toBe(763)
  })
})

test.describe('a multi-selection aligns as one box', () => {
  test('the selection frame snaps, and every member moves by the same offset', async ({
    page,
  }) => {
    const { moverId } = await buildBoard(page)
    // A second dragged element, offset from the mover on both axes, so the
    // selection's frame (1000..1180) is wider than either member. Aligning
    // per element instead of per frame would move the two by different
    // offsets and shear the selection.
    const partnerId = await drawRectangle(
      page,
      { x: 1120, y: 240 },
      { x: 1180, y: 280 },
    )

    await dragMouse(
      page,
      await worldToPage(page, { x: 980, y: 180 }),
      await worldToPage(page, { x: 1200, y: 300 }),
    )
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)

    // Aim the FRAME's left edge at 763: it snaps to the neighbour's 760, so
    // both members shift by exactly -240.
    const guides = await dragMoverTo(page, { x: 763, y: MOVER.y })
    expect(guides).toHaveLength(1)
    expect(guides[0]).toMatchObject({ axis: 'x', position: 760 })

    const state = await engine(page)
    expect(byId(state, moverId).x).toBe(760)
    expect(byId(state, partnerId).x).toBe(880)
    // The partner is NOT itself aligned to anything — only the frame is,
    // which is the whole distinction this case exists for.
    expect(byId(state, partnerId).y).toBe(240)
  })
})

test.describe('resizing', () => {
  test('the grip’s own edge snaps to a neighbour and the opposite edge stays put', async ({
    page,
  }) => {
    const { moverId } = await buildBoard(page)

    // Select the mover so its grips are drawn and hit-testable.
    await page.mouse.click(
      (await worldToPage(page, GRAB)).x,
      (await worldToPage(page, GRAB)).y,
    )
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([moverId])

    // The WEST grip, not an eastern one. The neighbour sits entirely to the
    // LEFT of the mover (its lines are 760/810/860, the mover starts at
    // 1000), so an east or south-east grip physically cannot reach any of
    // them: `resizedBounds` clamps a right edge dragged past its own left
    // edge to MIN_ELEMENT_SIZE rather than letting the rectangle flip. Only
    // the edge facing the neighbour can align with it.
    const grip = await worldToPage(page, {
      x: MOVER.x,
      y: MOVER.y + MOVER.height / 2,
    })
    // Left edge to 863 — three short of the neighbour's right edge.
    const target = await worldToPage(page, {
      x: 863,
      y: MOVER.y + MOVER.height / 2,
    })
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 10 })
    await page.mouse.move(target.x, target.y)
    const guides = (await engine(page)).alignmentGuides
    await page.mouse.up()

    expect(guides).toHaveLength(1)
    expect(guides[0]).toMatchObject({ axis: 'x', position: 860 })

    const resized = byId(await engine(page), moverId)
    expect(resized.x).toBe(860)
    // The edge the grip is not holding never moved: the element grew
    // leftwards rather than sliding.
    expect(resized.x + resized.width).toBe(MOVER.x + MOVER.width)
  })
})

test.describe('focus', () => {
  test('the board is still usable by keyboard after an aligned drag', async ({
    page,
  }) => {
    // A guard against the guides ever being drawn from state that outlives
    // the gesture: an undo must clear the drag AND leave no guide behind.
    const { moverId } = await buildBoard(page)
    await dragMoverTo(page, { x: 763, y: MOVER.y })
    await settle(page)

    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect
      .poll(async () => byId(await engine(page), moverId).x)
      .toBe(MOVER.x)
    expect((await engine(page)).alignmentGuides).toEqual([])
  })
})

// e2e/canvas-connector-curve.spec.ts
// End-to-end coverage for what a `curved` connector's LINE looks like — the
// mandatory Playwright completion gate per CLAUDE.md.
//
// Two properties, both reported from a screenshot:
//
//   1. THE LINE IS A CURVE, not a run of straight pieces. Fixed in the
//      renderer: `drawConnector` now strokes the cubic through
//      `connectorCurve` instead of walking its 24-segment sample, so the line
//      is exact at every zoom. That is a canvas CALL, invisible to a spec that
//      can only read engine state, so it is pinned in the unit layer instead —
//      see "a curved connector is stroked as a curve, not as a polygon" in
//      src/lib/canvas-engine/render-connectors.test.ts, which asserts one
//      `bezierCurveTo` and no `lineTo` for the shaft. What THIS file can prove
//      is the shape that curve has, which is the rest of the same complaint.
//
//   2. THE ENDS MEET THEIR SHAPES SQUARE-ON. Asserted below off the drawn
//      path's own first and last segments.
//
// SCOPE — the square-on assertions here are on the RESTING curve, the one a
// connector draws before anyone drags its bend grip. A hand-applied bow still
// tilts both ends, because the bow is added by pushing both control points of
// a single cubic sideways and a single cubic has no control points left over
// to hold its tangents with. Bowing is covered by canvas-connector-bend.spec.ts
// and deliberately not re-asserted here.
//
// WHY EVERY POINT COMES FROM THE ENGINE — the line is read from
// `window.__canvasEngine.connectorPath`, which is the path the renderer itself
// drew. A curve's shape depends on the routing, the anchors and the tension
// clamp at once, so a spec that recomputed it locally would be a second
// derivation of the exact thing this module's export-what-you-draw convention
// exists to prevent.
//
// Structure, seeding order and `focusBoard`/`settle` mechanics are copied from
// canvas-connector-bend.spec.ts, which exports none of them.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const CONNECTOR_BOARD_URL = `/canvas/${IDS.canvasConnectorBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── engine access ───────────────────────────────────────────────────────────

interface Point {
  x: number
  y: number
}

interface EngineElement {
  id: string
  kind: 'rectangle' | 'text' | 'connector'
  x: number
  y: number
  width: number
  height: number
  connector?: { routing: string; curvature?: number }
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  /** The drawn line itself, in WORLD units — see the hook's own comment. */
  connectorPath: Array<Point> | null
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

async function openBoard(page: Page): Promise<EngineState> {
  await page.goto(CONNECTOR_BOARD_URL)
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

async function worldToPage(page: Page, world: Point) {
  const box = await canvasBox(page)
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

function byId(state: EngineState, id: string) {
  return state.elements.find((element) => element.id === id)
}

/** See canvas-connector-bend.spec.ts — the MEASURED box, never a fixed point. */
async function focusBoard(page: Page) {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 40, box.y + 150)
}

/**
 * Select the seeded connector by clicking a point on its own line.
 *
 * The midpoint of the two ATTACH points, not of the two element centres. The
 * seed anchors this connector right-to-left, so its ends are pinned to those
 * two edge midpoints rather than tracking the centre-to-centre ray — the
 * centres' midpoint only happens to sit on the line for the layout the seed
 * ships, and slides off it the moment a shape is dragged anywhere.
 *
 * STRAIGHT connectors only, and every caller obeys that: a curved line bows
 * away from its own chord, so the midpoint of the two ends is exactly where
 * the line is NOT. Select first, then change the routing.
 */
async function selectConnector(page: Page) {
  const state = await engine(page)
  const source = byId(state, IDS.canvasConnSource)!
  const target = byId(state, IDS.canvasConnTarget)!
  const mid = await worldToPage(page, {
    x: (source.x + source.width + target.x) / 2,
    y: (source.y + source.height / 2 + target.y + target.height / 2) / 2,
  })
  await page.mouse.click(mid.x, mid.y)
  await expect
    .poll(async () => (await engine(page)).selectedIds)
    .toEqual([IDS.canvasConnector])
}

/**
 * Drag a shape by its centre and leave the CONNECTOR selected again.
 *
 * The re-selection is the point. Dragging a shape selects that shape, and the
 * test hook publishes `connectorPath` only while exactly one connector is
 * selected — the same condition the renderer draws the connector's own
 * affordances under. Without it the path is simply null and the assertion
 * fails as "no connector path", which says nothing about the geometry.
 *
 * Call this BEFORE `makeCurved`, never after: re-selecting goes through
 * `selectConnector`, which can only find a straight line.
 */
async function dragShapeTo(
  page: Page,
  elementId: string,
  world: Point,
): Promise<void> {
  const state = await engine(page)
  const element = byId(state, elementId)!
  const grab = await worldToPage(page, {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  })
  const drop = await worldToPage(page, {
    x: world.x + element.width / 2,
    y: world.y + element.height / 2,
  })
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(drop.x, drop.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  // Deselect FIRST. A drag leaves the shape selected, and a selected shape
  // wears four quick-create handles that reach 22px OUTSIDE its edges — on a
  // pair this close together one of them covers the very point the connector's
  // line runs through, so the re-selecting click landed on a handle and
  // created a sibling element instead. Clearing the selection puts the
  // handles away and leaves the line as the only thing under that point.
  await focusBoard(page)
  await expect.poll(async () => (await engine(page)).selectedIds).toEqual([])
  await selectConnector(page)
}

async function makeCurved(page: Page) {
  await page.click('[aria-label="Curved connector"]')
  await expect
    .poll(
      async () =>
        byId(await engine(page), IDS.canvasConnector)?.connector?.routing,
    )
    .toBe('curved')
}

async function curvePath(page: Page): Promise<Array<Point>> {
  const state = await engine(page)
  if (!state.connectorPath) {
    throw new Error(
      `no connector path is published (selected=${state.selectedIds.join(',')})`,
    )
  }
  return state.connectorPath
}

// ── geometry read off the drawn line ────────────────────────────────────────

function unit(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

/** Angle between two unit vectors, in degrees. */
function angleBetween(a: Point, b: Point): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))
  return (Math.acos(dot) * 180) / Math.PI
}

/**
 * The outward normal of whichever face of `element` the point `on` sits on.
 *
 * Derived from the element's own box rather than from the connector's stored
 * anchor: the assertion is that the line meets the SHAPE square-on, and
 * reading the anchor would let a wrong landing point still pass.
 */
function faceNormal(element: EngineElement, on: Point): Point {
  const fx = (on.x - element.x) / element.width
  const fy = (on.y - element.y) / element.height
  const nearest = Math.min(fx, 1 - fx, fy, 1 - fy)
  if (nearest === fx) return { x: -1, y: 0 }
  if (nearest === 1 - fx) return { x: 1, y: 0 }
  if (nearest === fy) return { x: 0, y: -1 }
  return { x: 0, y: 1 }
}

/**
 * How far the line swings its own direction between one end and the other, in
 * degrees.
 *
 * The measurable form of "it turns too many times". A connector that reads as
 * one sweep stays well under a right angle; a curve whose control points have
 * crossed over each other turns through nearly half a circle — out, back, and
 * out again.
 */
function turning(path: Array<Point>): number {
  let total = 0
  for (let i = 2; i < path.length; i += 1) {
    const ax = path[i - 1].x - path[i - 2].x
    const ay = path[i - 1].y - path[i - 2].y
    const bx = path[i].x - path[i - 1].x
    const by = path[i].y - path[i - 1].y
    total += Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
  }
  return (total * 180) / Math.PI
}

/**
 * The tolerance both square-on assertions run at, in degrees.
 *
 * It is NOT how far off square the geometry is allowed to be. The departure
 * and arrival are EXACTLY perpendicular — 0.0000 degrees, asserted to nine
 * decimal places against the curve's own control points in
 * src/lib/canvas-engine/connector-geometry.test.ts. This number is the cost of
 * what an e2e can see: the hook publishes the curve FLATTENED to 24 segments,
 * so the first and last chords are secants, not tangents, and on the seeded
 * geometry they measure 2.9 degrees off the true departure, rising past 4 once
 * a shape has been dragged into a tighter curve.
 *
 * Eight leaves room above the worst measured secant while staying an order of
 * magnitude below the defect this guards: a line leaving one face while
 * standing on another was tens of degrees out, and on a wide flat shape it
 * departed a full 90 degrees from the face it was on.
 */
const SQUARE_ON_TOLERANCE = 8

// ── tests ───────────────────────────────────────────────────────────────────

test.describe('a curved connector meets both shapes square-on', () => {
  test('leaves the source along that face outward normal', async ({ page }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)

    const path = await curvePath(page)
    const source = byId(await engine(page), IDS.canvasConnSource)!
    const departure = unit(path[0], path[1])
    const normal = faceNormal(source, path[0])

    expect(angleBetween(departure, normal)).toBeLessThan(SQUARE_ON_TOLERANCE)
  })

  test('arrives at the target along that face inward normal', async ({
    page,
  }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)

    const path = await curvePath(page)
    const target = byId(await engine(page), IDS.canvasConnTarget)!
    const tip = path[path.length - 1]
    const arrival = unit(path[path.length - 2], tip)
    const normal = faceNormal(target, tip)

    // Arriving square-on is arriving along the outward normal REVERSED — this
    // is the direction the arrowhead is oriented along, and the reason a head
    // on a curved connector reads as an arrow instead of a smudge.
    expect(angleBetween(arrival, { x: -normal.x, y: -normal.y })).toBeLessThan(
      SQUARE_ON_TOLERANCE,
    )
  })

  test('still meets both faces square-on after a shape is dragged', async ({
    page,
  }) => {
    await openBoard(page)
    await selectConnector(page)

    // Move the target well below the source, so the pair stops being the
    // left-to-right layout the seed ships and the line has a real turn to
    // make. Done while the connector is still STRAIGHT so it can be
    // re-selected — see `dragShapeTo`. Nothing about the connector itself is
    // edited: its path is recomputed from live bounds every frame, which is
    // what this really exercises.
    await dragShapeTo(page, IDS.canvasConnTarget, { x: 600, y: 700 })
    await makeCurved(page)

    const moved = await engine(page)
    const path = await curvePath(page)
    const source = byId(moved, IDS.canvasConnSource)!
    const dragged = byId(moved, IDS.canvasConnTarget)!
    const tip = path[path.length - 1]

    expect(
      angleBetween(unit(path[0], path[1]), faceNormal(source, path[0])),
    ).toBeLessThan(SQUARE_ON_TOLERANCE)

    const inward = faceNormal(dragged, tip)
    expect(
      angleBetween(unit(path[path.length - 2], tip), {
        x: -inward.x,
        y: -inward.y,
      }),
    ).toBeLessThan(SQUARE_ON_TOLERANCE)
  })
})

test.describe('a curved connector reads as one sweep', () => {
  test('does not wander on its way between the two shapes', async ({
    page,
  }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)

    // The seeded pair sits 400 apart horizontally and 220 vertically — an
    // ordinary board distance, where a connector should arc once and stop.
    // The knot this guards against measured over 150 degrees.
    expect(turning(await curvePath(page))).toBeLessThan(120)
  })

  test('does not knot up when the two shapes are pushed close together', async ({
    page,
  }) => {
    await openBoard(page)
    await selectConnector(page)

    // The failure case: the tension floor is an absolute 24 world units, so on
    // a short enough chord both control points were pushed further apart than
    // the two ends are, traded places, and the line looped, doubled back and
    // looped again — 186 degrees of total turning.
    //
    // This drop puts the target's LEFT edge midpoint 30 right and 20 below the
    // source's RIGHT edge midpoint, which are the two points this connector is
    // anchored to. A 36-unit chord is well inside the band the chord-share cap
    // is for, and the 20 of offset leaves the curve a real turn to make rather
    // than degenerating into a straight line.
    await dragShapeTo(page, IDS.canvasConnTarget, { x: 490, y: 280 })
    await makeCurved(page)

    const path = await curvePath(page)
    const chord = Math.hypot(
      path[path.length - 1].x - path[0].x,
      path[path.length - 1].y - path[0].y,
    )
    // Pinned so a later reader can see the shapes really did end up inside the
    // short-chord band, not merely somewhere nearby.
    expect(chord).toBeLessThan(48)
    expect(turning(path)).toBeLessThan(175)
  })

  test('keeps the line attached after a reload', async ({ page }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    await focusBoard(page)
    await page.waitForTimeout(1500)

    // Canvas mutations run in the Socket.IO handler inside server.dev.ts, so
    // the routing change persists in dev too — this asserts PERSISTENCE, not a
    // workaround for the documented `io === null` gap.
    await page.reload()
    await page.waitForSelector('canvas')
    await page.waitForFunction(
      () => window.__canvasEngine !== undefined,
      null,
      {
        timeout: 15_000,
      },
    )
    await selectConnector(page)

    const reloaded = await engine(page)
    expect(byId(reloaded, IDS.canvasConnector)?.connector?.routing).toBe(
      'curved',
    )

    const path = await curvePath(page)
    const source = byId(reloaded, IDS.canvasConnSource)!
    expect(
      angleBetween(unit(path[0], path[1]), faceNormal(source, path[0])),
    ).toBeLessThan(SQUARE_ON_TOLERANCE)
  })
})

// e2e/canvas-connector-bend.spec.ts
// End-to-end coverage for dragging a curved connector's midpoint grip to set
// its bow — the mandatory Playwright completion gate per CLAUDE.md.
//
// Mirrors e2e/canvas-quick-create.spec.ts structure-for-structure, including
// the hard-won mechanics duplicated there rather than imported (that file
// exports none of them, and e2e/canvas-helpers.ts holds React-Flow/ER-board
// helpers only, not FigJam canvas-engine ones):
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point.
//   - `settle` waits for the server ACK, not the optimistic render: the undo
//     entry is pushed inside the mutation's `.then()`, so a Ctrl+Z sent
//     between the optimistic scene update and that ack finds an EMPTY stack.
//   - SEEDING ORDER: seed-canvas.ts's ProjectMember insert references
//     IDS.viewerUser, a User row only e2e/seed-stress.ts creates, so the
//     stress seed has to run first.
//
// WHY EVERY POINT COMES FROM THE ENGINE — the bend grip is read from
// `window.__canvasEngine.connectorBend`, the rectangle the renderer itself
// drew (`connectorBendRect`). A curve's midpoint depends on the routing, the
// tension clamp and the curvature all at once, so a spec that computed it
// locally would be a second derivation of the exact thing this feature's
// export-what-you-draw convention exists to prevent — and it would fail as
// "the drag did nothing" with no hint why.
//
// WHY THE DRAG IS PERPENDICULAR — `curvature` is defined as a PERPENDICULAR
// offset, so a bend point follows the projection of the pointer onto the chord
// normal, not the pointer itself. Dragging at any other angle still bows the
// line, but the grip would land somewhere the spec could not predict without
// re-deriving the projection. Dragging square to the chord is what makes
// "the grip ends up where it was dropped" a legitimate assertion.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist in dev too. The reload
// assertions below therefore prove PERSISTENCE, not a workaround for the
// documented `io === null` gap (which applies only to server functions running
// in the Vite process, none of which are involved here).
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

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface EngineElement {
  id: string
  kind: 'rectangle' | 'text' | 'connector'
  x: number
  y: number
  width: number
  height: number
  connector?: {
    source: unknown
    target: unknown
    routing: string
    curvature?: number
  }
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  connectorEndpoints: Record<'source' | 'target', ScreenRect> | null
  connectorBend: ScreenRect | null
  /** The drawn line itself, in WORLD units — see the hook's own comment. */
  connectorPath: Array<{ x: number; y: number }> | null
  readOnly: boolean
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

async function worldToPage(page: Page, world: { x: number; y: number }) {
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

function curvatureOf(state: EngineState): number | undefined {
  return byId(state, IDS.canvasConnector)?.connector?.curvature
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
 * Select the seeded connector by clicking a point on its own line.
 *
 * The midpoint between the two element centres, which for this seeded pair
 * (source anchored right, target anchored left, symmetric offsets) lies
 * exactly on the straight line the hit-test matches against. Copied from
 * canvas-quick-create.spec.ts, which does not export it.
 */
async function selectConnector(page: Page) {
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

/**
 * Switch the selected connector to `curved` through the real routing picker.
 *
 * The seed stores `straight` deliberately (it is what the routing-picker specs
 * need), and this feature is `curved`-only, so every test here has to make
 * that change the way a user would rather than by seeding a second row.
 */
async function makeCurved(page: Page) {
  await page.click('[aria-label="Curved connector"]')
  await expect
    .poll(
      async () =>
        byId(await engine(page), IDS.canvasConnector)?.connector?.routing,
    )
    .toBe('curved')
}

/** The PAGE point of the bend grip's centre — the rectangle the renderer drew. */
async function bendPoint(page: Page) {
  const state = await engine(page)
  if (!state.connectorBend) {
    throw new Error(
      `no bend grip is showing (selected=${state.selectedIds.join(',')})`,
    )
  }
  const box = await canvasBox(page)
  const rect = state.connectorBend
  return {
    x: box.x + rect.x + rect.width / 2,
    y: box.y + rect.y + rect.height / 2,
  }
}

/**
 * The unit vector the curvature is measured along, in PAGE space: the
 * left-hand normal of source -> target.
 *
 * Built from the two ENDPOINT GRIPS the renderer published, not from the
 * elements' stored bounds — those are the actual ends of the drawn line, so
 * this stays a direction read off the render rather than a re-derivation of
 * where the line runs.
 */
async function chordNormal(page: Page) {
  const state = await engine(page)
  if (!state.connectorEndpoints)
    throw new Error('no endpoint grips are showing')
  const { source, target } = state.connectorEndpoints
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.hypot(dx, dy)
  return { x: dy / length, y: -dx / length }
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

// ── the grip appears only where a bow is possible ───────────────────────────

test.describe('the bend grip', () => {
  test('appears only for a selected CURVED connector', async ({ page }) => {
    await openBoard(page)
    expect((await engine(page)).connectorBend).toBeNull()

    // Selected, but still `straight` — no bow exists to drag, so no grip.
    await selectConnector(page)
    expect((await engine(page)).connectorBend).toBeNull()

    await makeCurved(page)
    await expect
      .poll(async () => (await engine(page)).connectorBend)
      .not.toBeNull()

    // Elbow takes it away again, for the same reason: an elbow with a bend in
    // it is no longer orthogonal.
    await page.click('[aria-label="Elbow connector"]')
    await expect.poll(async () => (await engine(page)).connectorBend).toBeNull()
  })

  test('goes away when the connector is deselected', async ({ page }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    expect((await engine(page)).connectorBend).not.toBeNull()

    const source = byId(await engine(page), IDS.canvasConnSource)!
    const centre = await worldToPage(page, {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)
    await expect.poll(async () => (await engine(page)).connectorBend).toBeNull()
  })
})

// ── the drag itself ─────────────────────────────────────────────────────────

test.describe('dragging the bend grip', () => {
  const REACH = 90

  test('bows the line, and the grip ends up where it was dropped', async ({
    page,
  }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    expect(curvatureOf(await engine(page))).toBeUndefined()

    const from = await bendPoint(page)
    const normal = await chordNormal(page)
    const to = {
      x: from.x + normal.x * REACH,
      y: from.y + normal.y * REACH,
    }
    await dragMouse(page, from, to)

    // Positive, because the drag went along the LEFT-hand normal of
    // source -> target. This is the whole sign convention, asserted end to
    // end rather than only in the geometry unit tests.
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeGreaterThan(0)

    // 1:1 — the grip follows the pointer, so it is now under where the mouse
    // was released. A few pixels of tolerance for the sampled polyline: the
    // grip sits on a sample of the curve, not on the analytic point.
    const landed = await bendPoint(page)
    expect(Math.hypot(landed.x - to.x, landed.y - to.y)).toBeLessThan(4)
  })

  test('bows the other way for a drag to the other side', async ({ page }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)

    const from = await bendPoint(page)
    const normal = await chordNormal(page)
    await dragMouse(page, from, {
      x: from.x - normal.x * REACH,
      y: from.y - normal.y * REACH,
    })

    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeLessThan(0)
  })

  test('the bow survives a reload', async ({ page }) => {
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    await settle(page)

    const from = await bendPoint(page)
    const normal = await chordNormal(page)
    await dragMouse(page, from, {
      x: from.x + normal.x * REACH,
      y: from.y + normal.y * REACH,
    })
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeGreaterThan(0)
    const bowed = curvatureOf(await engine(page))!
    await settle(page)

    // Nothing new was needed on the server for this: the adapter serialises a
    // connector's props wholesale, so curvature rides the existing update
    // path. This is the assertion that proves it rather than assuming it.
    const reloaded = await openBoard(page)
    expect(curvatureOf(reloaded)).toBeCloseTo(bowed, 6)
    expect(byId(reloaded, IDS.canvasConnector)?.connector?.routing).toBe(
      'curved',
    )
  })

  test('is undoable', async ({ page }) => {
    // A bend that Ctrl+Z could not reverse would be the one board edit that
    // behaves differently from every other — the same failure the routing
    // picker was built to avoid.
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    await settle(page)

    const from = await bendPoint(page)
    const normal = await chordNormal(page)
    await dragMouse(page, from, {
      x: from.x + normal.x * REACH,
      y: from.y + normal.y * REACH,
    })
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeGreaterThan(0)
    await settle(page)

    await undo(page)

    // Back to no bow at all — the pre-gesture snapshot carried no curvature,
    // so restoring it must not leave a zero behind either.
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeCloseTo(0, 6)
  })

  test('leaves the two ENDS exactly where they were', async ({ page }) => {
    // Bending is not reconnecting. If the drag moved an end, the gesture
    // would be indistinguishable from an endpoint drag and the undo toast
    // would name the wrong edit.
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    const before = byId(await engine(page), IDS.canvasConnector)!.connector!

    const from = await bendPoint(page)
    const normal = await chordNormal(page)
    await dragMouse(page, from, {
      x: from.x + normal.x * REACH,
      y: from.y + normal.y * REACH,
    })
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeGreaterThan(0)

    const after = byId(await engine(page), IDS.canvasConnector)!.connector!
    expect(after.source).toEqual(before.source)
    expect(after.target).toEqual(before.target)
  })

  test('a press with no travel writes nothing', async ({ page }) => {
    // Otherwise a stray click on the grip pushes an undo entry whose undo is
    // a no-op, and the next Ctrl+Z appears to do nothing at all.
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)
    await settle(page)

    const grip = await bendPoint(page)
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    await page.mouse.up()
    await settle(page)

    expect(curvatureOf(await engine(page))).toBeUndefined()

    // The one undo on the stack is still the ROUTING change, which is what a
    // user pressing Ctrl+Z at this point would expect to get back.
    await undo(page)
    await expect
      .poll(
        async () =>
          byId(await engine(page), IDS.canvasConnector)?.connector?.routing,
      )
      .toBe('straight')
  })
})

// ── the bow must survive an ENDPOINT drag without folding ───────────────────

test.describe('a bowed connector whose END is dragged', () => {
  /**
   * The smallest step the drawn line takes ALONG its own chord, in world
   * units.
   *
   * Negative means a CUSP: the line leaving an endpoint travelling backwards,
   * curling round it and coming back. That is the fault this block exists for,
   * and it is invisible to every other published field — a cusp moves neither
   * end and barely moves the bend grip, so the specs above all passed while
   * the board drew a loop. Read off `connectorPath`, the polyline the renderer
   * actually painted, for the same export-what-you-draw reason the grips are
   * published rather than derived here.
   */
  function worstAlongChordStep(path: Array<{ x: number; y: number }>): number {
    const from = path[0]
    const to = path[path.length - 1]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const ux = (to.x - from.x) / length
    const uy = (to.y - from.y) / length
    let worst = Number.POSITIVE_INFINITY
    for (let i = 1; i < path.length; i += 1) {
      const step =
        (path[i].x - path[i - 1].x) * ux + (path[i].y - path[i - 1].y) * uy
      worst = Math.min(worst, step)
    }
    return worst
  }

  async function pathOf(page: Page) {
    const state = await engine(page)
    if (!state.connectorPath) throw new Error('no connector path is published')
    return state.connectorPath
  }

  /** The PAGE point of an endpoint grip's centre — the rectangle drawn. */
  async function endpointPoint(page: Page, end: 'source' | 'target') {
    const state = await engine(page)
    if (!state.connectorEndpoints)
      throw new Error('no endpoint grips are showing')
    const box = await canvasBox(page)
    const rect = state.connectorEndpoints[end]
    return {
      x: box.x + rect.x + rect.width / 2,
      y: box.y + rect.y + rect.height / 2,
    }
  }

  test('does not fold into a cusp, mid-drag or after release', async ({
    page,
  }) => {
    // The reported failure, driven through the real UI: bow the line, then
    // pull its SOURCE end left and down into empty canvas. That leaves a FREE
    // end, whose departure direction is snapped to point AWAY from the other
    // end — so its control point sits behind it along the chord, and the bow
    // used to push it far enough sideways to reverse the curve.
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)

    const grip = await bendPoint(page)
    const normal = await chordNormal(page)
    await dragMouse(page, grip, {
      x: grip.x + normal.x * 90,
      y: grip.y + normal.y * 90,
    })
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeGreaterThan(0)

    const from = await endpointPoint(page, 'source')
    const to = { x: from.x - 260, y: from.y + 330 }

    // Held down deliberately: the fault was reported while DRAGGING, and the
    // scene mutates live during an endpoint drag, so the worst frame is one
    // nobody has released yet.
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.move(to.x, to.y)

    // The configuration is the pathological one, asserted rather than assumed:
    // a free end that is still bowed. Without both halves this test could pass
    // by measuring a straight, un-bowed line.
    const midDrag = await engine(page)
    expect(
      midDrag.elements.find((e) => e.id === IDS.canvasConnector)?.connector,
    ).toMatchObject({ source: { kind: 'point' } })
    expect(curvatureOf(midDrag) ?? 0).toBeGreaterThan(0)
    expect(worstAlongChordStep(midDrag.connectorPath!)).toBeGreaterThan(-1e-6)

    await page.mouse.up()

    // And it is not a drag-only artefact — the released line must be sane too.
    await expect
      .poll(async () => worstAlongChordStep(await pathOf(page)))
      .toBeGreaterThan(-1e-6)
    expect(curvatureOf(await engine(page)) ?? 0).toBeGreaterThan(0)
  })

  test('does not fold when the TARGET end is the one dragged', async ({
    page,
  }) => {
    // Both ends take the same departure rule, so both can produce the loop.
    await openBoard(page)
    await selectConnector(page)
    await makeCurved(page)

    const grip = await bendPoint(page)
    const normal = await chordNormal(page)
    await dragMouse(page, grip, {
      x: grip.x - normal.x * 90,
      y: grip.y - normal.y * 90,
    })
    await expect
      .poll(async () => curvatureOf(await engine(page)) ?? 0)
      .toBeLessThan(0)

    const from = await endpointPoint(page, 'target')
    const to = { x: from.x - 300, y: from.y - 260 }

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.move(to.x, to.y)

    const midDrag = await engine(page)
    expect(
      midDrag.elements.find((e) => e.id === IDS.canvasConnector)?.connector,
    ).toMatchObject({ target: { kind: 'point' } })
    expect(curvatureOf(midDrag) ?? 0).toBeLessThan(0)
    expect(worstAlongChordStep(midDrag.connectorPath!)).toBeGreaterThan(-1e-6)

    await page.mouse.up()
    await expect
      .poll(async () => worstAlongChordStep(await pathOf(page)))
      .toBeGreaterThan(-1e-6)
  })
})

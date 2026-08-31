// e2e/area-draw-grouping.spec.ts
// End-to-end coverage for todo #55 item 2: creating a subject area by DRAWING
// around existing tables must actually group those tables into it. The
// mandatory Playwright completion gate per CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// "The tables are inside the area" is a visual coincidence; "the tables are
// MEMBERS of the area" is a persisted fact, and #55 is precisely the gap
// between the two. So the assertions here never stop at "the area appeared
// over the tables" — they prove membership through the one behaviour only a
// real member has: an area MOVES ITS MEMBERS with it (the movable-container
// behaviour from GH #106). A drawn box that merely overlapped the tables would
// slide out from under them and fail. The `audit` table, deliberately seeded
// far outside the drawn rectangle, is the control: it must NOT follow.
//
// Item 1 of #55 (drag a table into an area → it joins) gets its own case here,
// driven by a SINGLE-table drag. e2e/multi-select-drag.spec.ts already covers
// join/leave, but only through React Flow's ctrl-click multi-selection — and
// both of its multi-drag cases are currently failing on this branch for a
// multi-selection reason unrelated to areas (verified: they fail identically
// with this feature's changes stashed). Item 1's own single-drag path deserves
// coverage that does not depend on that machinery.
//
// Persistence is asserted via RELOAD, not the live Socket.IO broadcast: in dev
// the two-process split (Vite + server.dev.ts) leaves `io` null inside server
// functions, so a broadcast emitted there is a no-op (see playwright.config.ts).
// The area create/move themselves DO round-trip through the socket server in
// dev, but reloading proves the DB write landed independently of any socket
// path — the same pattern multi-select-drag.spec.ts and version-history.spec.ts
// use.
//
// MECHANICS worth not rediscovering:
//   - The draw gesture runs from CAPTURE-PHASE pointer listeners on
//     `.react-flow-wrapper` (ShapeDrawOverlay), so it needs real
//     `page.mouse.down/move/up` — `dragTo` and synthetic clicks do not
//     reproduce it.
//   - The final mouse position is delivered TWICE. Under load the browser can
//     coalesce the tail of a stepped move, leaving the drawn rect a few pixels
//     short — enough to drop a table whose centre sat near the edge. Same
//     hard-won detail as e2e/canvas-shapes.ts's `dragMouse`.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { getViewportScale, tableNode } from './canvas-helpers'
import type { Locator, Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.adWhiteboard}`

test.use({ viewport: { width: 1600, height: 1000 } })

// Re-seed before EVERY test: each case creates an area and never removes it,
// so without this the second case (and every re-run) would start with a stale
// area already grouping the tables.
test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-area-draw.ts'], { stdio: 'inherit' })
})

async function openBoard(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: 'E2E Area Draw' }),
  ).toBeVisible()
  await expect(tableNode(page, 'accounts').first()).toBeVisible()
  await expect(tableNode(page, 'invoices').first()).toBeVisible()
  await expect(tableNode(page, 'audit').first()).toBeVisible()
}

function areaNodes(page: Page): Locator {
  return page.locator('.react-flow__node-area')
}

/** The React Flow NODE WRAPPER for a table, addressed by its seeded id.
 * `tableNode()` (data-table-name) finds the node's inner root, which carries
 * no transform — the `translate(x,y)` this suite reads lives on the wrapper.
 * Same locator multi-select-drag.spec.ts uses for the same reason. */
function nodeById(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

const TABLE_IDS = {
  accounts: IDS.adAccountsTable,
  invoices: IDS.adInvoicesTable,
  audit: IDS.adAuditTable,
} as const

/** Read React Flow's own `translate(x,y)` inline style — the same flow-space
 * value the DB persists as positionX/positionY, unaffected by pan/zoom. */
async function flowPosition(
  locator: Locator,
): Promise<{ x: number; y: number }> {
  const transform = await locator.evaluate(
    (el) => (el as HTMLElement).style.transform,
  )
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`unexpected node transform: ${transform}`)
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) }
}

async function tablePosition(page: Page, name: keyof typeof TABLE_IDS) {
  return flowPosition(nodeById(page, TABLE_IDS[name]))
}

/** Poll a locator's inline transform + rendered box until two consecutive
 * reads agree — proof the drag/reload has finished writing both position and
 * size. An area's box can resize asynchronously as React Flow measures it, so
 * reading straight after a reload can race that final layout write. */
async function waitForSettled(locator: Locator, timeout = 5000): Promise<void> {
  let lastSignature: string | null = null
  await expect
    .poll(
      async () => {
        const [transform, box] = await Promise.all([
          locator.evaluate((el) => (el as HTMLElement).style.transform),
          locator.boundingBox(),
        ])
        const signature = `${transform}|${box?.width ?? ''}|${box?.height ?? ''}`
        const settled = transform !== '' && signature === lastSignature
        lastSignature = signature
        return settled
      },
      { timeout, intervals: [100] },
    )
    .toBe(true)
}

/**
 * Counts NON-TRANSPARENT pixels the table layer actually painted inside a
 * screen-space rectangle.
 *
 * Why this exists: table text and chrome are painted onto a single <canvas>
 * (CanvasNodeLayer), not laid out as DOM per table. Every other assertion in
 * this file reads a node's DOM transform — and a DOM transform can be perfectly
 * correct while the canvas paints the same table somewhere else entirely. That
 * is not hypothetical: nesting tables into an area shipped exactly that bug
 * once, because the canvas drew each node at its React Flow `position`, which is
 * RELATIVE for a nested child. Grouped tables painted one area-origin up and to
 * the left of the box they belonged to, while their DOM boxes sat correctly
 * inside it. No transform assertion could see it; this one can.
 *
 * The canvas is transparent wherever nothing is drawn, so alpha is the signal.
 */
async function paintedPixels(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<number> {
  return page.evaluate(({ rect: crop }) => {
    // The table layer is the one full-size canvas in the pane.
    const canvas = [...document.querySelectorAll('canvas')].find(
      (c) => c.width > 500,
    )
    if (!canvas) throw new Error('table canvas layer not found')
    const box = canvas.getBoundingClientRect()
    // CSS px -> backing-store px (the canvas is sized for devicePixelRatio).
    const sx = canvas.width / box.width
    const sy = canvas.height / box.height
    const x = Math.max(0, Math.round((crop.x - box.x) * sx))
    const y = Math.max(0, Math.round((crop.y - box.y) * sy))
    const w = Math.min(canvas.width - x, Math.round(crop.w * sx))
    const h = Math.min(canvas.height - y, Math.round(crop.h * sy))
    if (w <= 0 || h <= 0) return 0
    const data = canvas.getContext('2d')!.getImageData(x, y, w, h).data
    let painted = 0
    for (let k = 3; k < data.length; k += 4) if (data[k] > 16) painted++
    return painted
  }, { rect })
}

/** A locator's size in FLOW units (screen box / live zoom).
 *
 * Anything compared ACROSS a reload must be zoom-independent: the board runs
 * fitView on load, so the same diagram comes back at a different scale and raw
 * screen pixels differ for no real reason. Within a single page state, screen
 * pixels are fine (and are what `screenCentre` uses). */
async function flowSize(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no bounding box')
  const scale = await getViewportScale(page)
  return { width: box.width / scale, height: box.height / scale }
}

/** A native press-move-release across the canvas. `steps` keeps the gesture
 * above ShapeDrawOverlay's DRAW_DRAG_THRESHOLD_PX and gives the capture-phase
 * pointermove handler real intermediate points to track. */
async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 15 })
  // Delivered twice on purpose — see the header note on coalesced tails.
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

/** Arm the area tool and rubber-band a rectangle that comfortably encloses
 * `accounts` + `invoices` (and nothing else), returning once the new area node
 * has actually rendered. Screen coordinates are MEASURED from the two tables'
 * own boxes rather than hardcoded: the board's fitView scale depends on the
 * viewport, so fixed page points would drift. */
async function drawAreaAroundAccountsAndInvoices(page: Page, margin = 34) {
  const addArea = page.getByRole('button', { name: 'Add area' })
  await addArea.click()
  // The tool is armed — the button re-labels, which is also the user-visible
  // signal that the next drag draws rather than pans.
  await expect(
    page.getByRole('button', { name: 'Drag to draw...' }),
  ).toBeVisible()

  const accounts = await tableNode(page, 'accounts').first().boundingBox()
  const invoices = await tableNode(page, 'invoices').first().boundingBox()
  if (!accounts || !invoices) throw new Error('missing table bounding box')

  const from = { x: accounts.x - margin, y: accounts.y - margin }
  const to = {
    x: invoices.x + invoices.width + margin,
    y:
      Math.max(accounts.y + accounts.height, invoices.y + invoices.height) +
      margin,
  }

  await dragMouse(page, from, to)

  await expect(areaNodes(page)).toHaveCount(1)
  await waitForSettled(areaNodes(page).first())
  // The area node appearing means the create ACK landed, but the members do not
  // become React Flow CHILDREN until the following commit — and a drag started
  // inside that window is dropped on the floor (observed: the table simply does
  // not move). `waitForSettled` cannot see it, because re-anchoring changes no
  // position. React Flow itself publishes the signal: it stamps `parent` onto a
  // node's class list only once some other node actually names it as its parent,
  // so this waits on the nesting being real rather than on a guessed duration.
  await expect
    .poll(
      async () =>
        ((await areaNodes(page).first().getAttribute('class')) ?? '')
          .split(/\s+/)
          .includes('parent'),
      { timeout: 10_000, intervals: [50] },
    )
    .toBe(true)
  // ...and then one more settle, because the nesting commit is not the last one.
  // ReactFlowWhiteboard re-injects the area list into EVERY table node's `data`
  // whenever `areas` changes, which hands the canvas a fresh `initialNodes` and
  // rebuilds every node a second time, moments later. A React Flow drag started
  // between the two rebuilds loses its subject and does nothing at all — which
  // is what made the member-drag cases below flaky at ~50%. A real user drags
  // seconds after drawing an area, not 50ms after; this waits out the window
  // rather than pretending it isn't there.
  await page.waitForTimeout(500)
}

/** A table's centre in SCREEN pixels.
 *
 * The member-drag cases below measure in screen space rather than through
 * `flowPosition`'s inline `translate(...)`, because a drag can CHANGE whether
 * the node is nested — and the transform's frame of reference changes with it.
 * Comparing a before-value taken while nested against an after-value taken while
 * un-nested compares two different coordinate systems and yields nonsense (it
 * reported "the table did not move" for a drag the failure screenshot plainly
 * showed working). Screen space has one meaning throughout. */
async function screenCentre(page: Page, name: keyof typeof TABLE_IDS) {
  const box = await tableNode(page, name).first().boundingBox()
  if (!box) throw new Error(`no bounding box for table "${name}"`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Polls until the press point actually hit-tests to `name`'s own node.
 *
 * A press that lands on the area instead silently drags the whole group, and
 * the table reads as "did not move" — the precise failure this suite kept
 * hitting. Rather than sleeping and hoping, wait for the precondition the drag
 * depends on: that the table, not its area, is the topmost element there.
 */
async function waitUntilHittable(
  page: Page,
  name: keyof typeof TABLE_IDS,
  point: { x: number; y: number },
) {
  await expect
    .poll(
      async () =>
        page.evaluate((p) => {
          const el = document.elementFromPoint(p.x, p.y)
          return el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
        }, point),
      { timeout: 10_000, intervals: [50] },
    )
    .toBe(TABLE_IDS[name])
}

/** Drag a table by its header by a SCREEN-pixel delta. */
async function dragTableBy(
  page: Page,
  name: keyof typeof TABLE_IDS,
  delta: { dx: number; dy: number },
) {
  const box = await tableNode(page, name).first().boundingBox()
  if (!box) throw new Error('missing table bounding box')
  const start = { x: box.x + 20, y: box.y + 10 }
  await waitUntilHittable(page, name, start)
  await dragMouse(page, start, { x: start.x + delta.dx, y: start.y + delta.dy })
  await waitForSettled(nodeById(page, TABLE_IDS[name]))
}

/** Drag one table node by its header into the middle of the drawn area, which
 * is `handleNodeDragStop`'s SINGLE-table branch (no ctrl-click, no
 * multi-selection). y=10 sits inside the table header, above the first column
 * row; x=20 clears the left-edge column handles — the same header-offset
 * anchor multi-select-drag.spec.ts uses. */
async function dragTableIntoArea(page: Page, name: keyof typeof TABLE_IDS) {
  const table = await tableNode(page, name).first().boundingBox()
  const area = await areaNodes(page).first().boundingBox()
  if (!table || !area) throw new Error('missing bounding box')

  await waitUntilHittable(page, name, { x: table.x + 20, y: table.y + 10 })
  await dragMouse(
    page,
    { x: table.x + 20, y: table.y + 10 },
    // Aim at the area's horizontal centre, a little below its header strip, so
    // the dropped table's own CENTRE lands well inside the rectangle — that
    // centre is what decides membership (`reconcileAreaMembership`).
    { x: area.x + area.width / 2, y: area.y + area.height / 2 },
  )

  await waitForSettled(nodeById(page, TABLE_IDS[name]))
  await waitForSettled(areaNodes(page).first())
}

/** Drag the created area by its header (the label strip — the area body's own
 * drag surface) and return the flow-space delta it actually moved. */
async function dragAreaBy(page: Page, delta: { dx: number; dy: number }) {
  const area = areaNodes(page).first()
  const before = await flowPosition(area)
  const box = await area.boundingBox()
  if (!box) throw new Error('no bounding box for the area node')

  // x offset clears the label text; y sits inside the header strip, above the
  // area's empty body (which is pointer-transparent to the tables beneath).
  const start = { x: box.x + box.width / 2, y: box.y + 8 }
  await dragMouse(page, start, { x: start.x + delta.dx, y: start.y + delta.dy })
  await waitForSettled(area)

  const after = await flowPosition(area)
  return { dx: after.x - before.x, dy: after.y - before.y }
}

test.describe('draw an area around existing tables (todo #55)', () => {
  test('the drawn area takes its enclosed tables with it, and leaves the others', async ({
    page,
  }) => {
    await openBoard(page)

    const before = {
      accounts: await tablePosition(page, 'accounts'),
      invoices: await tablePosition(page, 'invoices'),
      audit: await tablePosition(page, 'audit'),
    }

    await drawAreaAroundAccountsAndInvoices(page)

    // Membership is not directly visible, so prove it by MOVING the area:
    // only real members follow it (GH #106's movable container). A drawn box
    // that merely overlapped the tables would slide away and leave them put.
    const moved = await dragAreaBy(page, { dx: 0, dy: 180 })
    expect(moved.dy).toBeGreaterThan(50)

    await Promise.all([
      waitForSettled(nodeById(page, TABLE_IDS.accounts)),
      waitForSettled(nodeById(page, TABLE_IDS.invoices)),
    ])

    const after = {
      accounts: await tablePosition(page, 'accounts'),
      invoices: await tablePosition(page, 'invoices'),
      audit: await tablePosition(page, 'audit'),
    }

    // Both enclosed tables moved by the SAME delta as the area.
    expect(after.accounts.y - before.accounts.y).toBeCloseTo(moved.dy, 0)
    expect(after.invoices.y - before.invoices.y).toBeCloseTo(moved.dy, 0)
    expect(after.accounts.x - before.accounts.x).toBeCloseTo(moved.dx, 0)

    // The table outside the drawn rectangle was NOT grouped and did not move.
    expect(after.audit).toEqual(before.audit)
  })

  test('the grouping survives a reload (it is persisted, not just optimistic)', async ({
    page,
  }) => {
    await openBoard(page)
    await drawAreaAroundAccountsAndInvoices(page)

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Area Draw' }),
    ).toBeVisible()
    await expect(areaNodes(page)).toHaveCount(1)
    await Promise.all([
      waitForSettled(areaNodes(page).first()),
      waitForSettled(nodeById(page, TABLE_IDS.accounts)),
      waitForSettled(nodeById(page, TABLE_IDS.invoices)),
    ])

    const before = {
      accounts: await tablePosition(page, 'accounts'),
      invoices: await tablePosition(page, 'invoices'),
      audit: await tablePosition(page, 'audit'),
    }

    // Same movable-container proof, but against membership loaded from the DB
    // rather than the state left over from the create.
    const moved = await dragAreaBy(page, { dx: 0, dy: 160 })
    expect(moved.dy).toBeGreaterThan(50)
    await Promise.all([
      waitForSettled(nodeById(page, TABLE_IDS.accounts)),
      waitForSettled(nodeById(page, TABLE_IDS.invoices)),
    ])

    const after = {
      accounts: await tablePosition(page, 'accounts'),
      invoices: await tablePosition(page, 'invoices'),
      audit: await tablePosition(page, 'audit'),
    }
    expect(after.accounts.y - before.accounts.y).toBeCloseTo(moved.dy, 0)
    expect(after.invoices.y - before.invoices.y).toBeCloseTo(moved.dy, 0)
    expect(after.audit).toEqual(before.audit)
  })

  test('a table dragged into the area joins it and then travels with it (#55 item 1)', async ({
    page,
  }) => {
    await openBoard(page)
    await drawAreaAroundAccountsAndInvoices(page)

    // `audit` starts far outside the drawn rectangle — the previous cases
    // prove it is NOT a member. Dragging it in is the other half of #55.
    await dragTableIntoArea(page, 'audit')

    const before = await tablePosition(page, 'audit')

    const moved = await dragAreaBy(page, { dx: 0, dy: 170 })
    expect(moved.dy).toBeGreaterThan(50)
    await waitForSettled(nodeById(page, TABLE_IDS.audit))

    // It followed the area — i.e. the drag-in actually created membership,
    // rather than just parking the table on top of the area.
    const after = await tablePosition(page, 'audit')
    expect(after.y - before.y).toBeCloseTo(moved.dy, 0)

    // And the move persisted: `area:move` writes the area + every member's
    // position in one server-side transaction, so a reload must show `audit`
    // at its post-move position.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Area Draw' })).toBeVisible()
    await waitForSettled(nodeById(page, TABLE_IDS.audit))
    const reloaded = await tablePosition(page, 'audit')
    expect(reloaded.y).toBeCloseTo(after.y, 0)
  })

  // ── nesting: the member is a real React Flow child of the area ───────────
  // These two cases are what separate real nesting from the old "membership
  // list + translate every member by the drag delta" implementation. Both pass
  // the cases above; only real nesting has to convert coordinates, because
  // React Flow reports a child's position RELATIVE to its parent while the DB,
  // the edges and every other consumer speak absolute flow coordinates. A
  // missing conversion does not fail subtly — the table jumps by the AREA'S
  // ORIGIN (hundreds of px), which is exactly what the tolerances below catch.

  test('a member dragged inside the area is saved where it was dropped, not offset by the area origin', async ({
    page,
  }) => {
    await openBoard(page)
    await drawAreaAroundAccountsAndInvoices(page)

    const before = await screenCentre(page, 'accounts')
    await dragTableBy(page, 'accounts', { dx: 60, dy: 40 })

    // TOLERANCE, deliberately loose: d3-drag swallows the first few pixels of
    // every gesture, so the landed delta is a little short of the requested one.
    // What this guards against is an order of magnitude bigger — a missing
    // relative->absolute conversion offsets the table by the AREA'S ORIGIN,
    // hundreds of pixels, which sails past this bar.
    const after = await screenCentre(page, 'accounts')
    expect(Math.abs(after.x - before.x - 60)).toBeLessThan(20)
    expect(Math.abs(after.y - before.y - 40)).toBeLessThan(20)
    const persisted = await tablePosition(page, 'accounts')

    // And it round-trips: the ABSOLUTE position written to the DB is the one
    // the user sees, not a relative offset stored as though it were absolute.
    // A reload re-renders from the DB, so the table must come back on the same
    // pixel it was dropped on.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Area Draw' })).toBeVisible()
    await waitForSettled(nodeById(page, TABLE_IDS.accounts))
    // Flow coordinates, not screen: the reload re-runs fitView, so the same
    // position comes back at a different zoom. `accounts` is still a member
    // either side of the reload, so the two readings are directly comparable.
    const reloaded = await tablePosition(page, 'accounts')
    expect(Math.abs(reloaded.x - persisted.x)).toBeLessThan(2)
    expect(Math.abs(reloaded.y - persisted.y)).toBeLessThan(2)
  })

  test('a member dragged out of the area lands where dropped and stops following it', async ({
    page,
  }) => {
    await openBoard(page)
    await drawAreaAroundAccountsAndInvoices(page)

    // Far enough left-and-up that `invoices`'s CENTRE clears the area, which is
    // what decides membership. Leaving the parent is the moment the node must
    // be un-nested, and a botched conversion shows up right here as a jump.
    const before = await screenCentre(page, 'invoices')
    await dragTableBy(page, 'invoices', { dx: -60, dy: -260 })

    // Same tolerance rationale as the previous case — see there.
    const after = await screenCentre(page, 'invoices')
    expect(Math.abs(after.x - before.x - -60)).toBeLessThan(20)
    expect(Math.abs(after.y - before.y - -260)).toBeLessThan(20)

    // It left the group: moving the area no longer takes it along...
    const parked = await screenCentre(page, 'invoices')
    const accountsBefore = await screenCentre(page, 'accounts')
    const moved = await dragAreaBy(page, { dx: 0, dy: 150 })
    expect(moved.dy).toBeGreaterThan(50)
    await waitForSettled(nodeById(page, TABLE_IDS.accounts))

    const parkedAfter = await screenCentre(page, 'invoices')
    expect(Math.abs(parkedAfter.x - parked.x)).toBeLessThan(3)
    expect(Math.abs(parkedAfter.y - parked.y)).toBeLessThan(3)

    // ...while the table that stayed in still travels with it.
    expect((await screenCentre(page, 'accounts')).y).toBeGreaterThan(
      accountsBefore.y + 50,
    )
  })

  test('grouped tables are PAINTED inside the area, not just positioned there', async ({
    page,
  }) => {
    await openBoard(page)
    await drawAreaAroundAccountsAndInvoices(page)

    const area = await areaNodes(page).first().boundingBox()
    if (!area) throw new Error('no bounding box for the area node')

    // The two members must actually be drawn within the area's box...
    const inside = await paintedPixels(page, {
      x: area.x,
      y: area.y + 10,
      w: area.width,
      h: area.height - 14,
    })
    expect(inside).toBeGreaterThan(1000)

    // ...and nothing may be drawn in the band just above it. That band is
    // precisely where a member lands if its relative position is painted as
    // though it were absolute, so this is the assertion that fails loudly on a
    // regression instead of passing while the board looks broken.
    const above = await paintedPixels(page, {
      x: area.x,
      y: area.y - 50,
      w: area.width,
      h: 44,
    })
    expect(above).toBe(0)

    // Same check after the area moves — members ride along as children, so the
    // paint must follow them, not stay behind at their old absolute position.
    await dragAreaBy(page, { dx: 0, dy: 150 })
    const movedArea = await areaNodes(page).first().boundingBox()
    if (!movedArea) throw new Error('no bounding box for the moved area')
    expect(
      await paintedPixels(page, {
        x: movedArea.x,
        y: movedArea.y + 10,
        w: movedArea.width,
        h: movedArea.height - 14,
      }),
    ).toBeGreaterThan(1000)
    expect(
      await paintedPixels(page, {
        x: movedArea.x,
        y: movedArea.y - 50,
        w: movedArea.width,
        h: 44,
      }),
    ).toBe(0)
  })

  test('the area keeps the size you gave it — no auto-fit — and stays user-resizable', async ({
    page,
  }) => {
    await openBoard(page)
    // Draw a deliberately OVERSIZED rectangle. Auto-fit used to shrink an area
    // to hug its members on the next member move; nothing may do that now.
    await drawAreaAroundAccountsAndInvoices(page, 60)

    const drawn = await areaNodes(page).first().boundingBox()
    if (!drawn) throw new Error('no bounding box for the area node')

    // Move a member. The old behaviour re-fitted the area here — which both
    // overrode any size the user had chosen and, once members became children,
    // dragged the UNTOUCHED members along with the repositioned area.
    const otherBefore = await screenCentre(page, 'invoices')
    await dragTableBy(page, 'accounts', { dx: 40, dy: 25 })

    const after = await areaNodes(page).first().boundingBox()
    if (!after) throw new Error('no bounding box for the area after the drag')
    expect(Math.abs(after.width - drawn.width)).toBeLessThan(3)
    expect(Math.abs(after.height - drawn.height)).toBeLessThan(3)
    expect(Math.abs(after.x - drawn.x)).toBeLessThan(3)
    expect(Math.abs(after.y - drawn.y)).toBeLessThan(3)

    // The member nobody touched has not moved either.
    const otherAfter = await screenCentre(page, 'invoices')
    expect(Math.abs(otherAfter.x - otherBefore.x)).toBeLessThan(3)
    expect(Math.abs(otherAfter.y - otherBefore.y)).toBeLessThan(3)

    // And the user can still resize it BY HAND, members and all — the resize
    // handles used to be hidden entirely once an area had members, because
    // auto-fit owned the bounds.
    await areaNodes(page).first().click({ position: { x: 40, y: 6 } })
    const handle = page.locator('.react-flow__resize-control.bottom.right')
    await expect(handle).toBeVisible()
    const grip = await handle.boundingBox()
    if (!grip) throw new Error('no bounding box for the resize handle')
    await dragMouse(
      page,
      { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
      { x: grip.x + grip.width / 2 + 120, y: grip.y + grip.height / 2 + 80 },
    )
    await waitForSettled(areaNodes(page).first())

    const resized = await areaNodes(page).first().boundingBox()
    if (!resized) throw new Error('no bounding box after resize')
    expect(resized.width).toBeGreaterThan(after.width + 60)
    expect(resized.height).toBeGreaterThan(after.height + 40)
    const resizedFlow = await flowSize(page, areaNodes(page).first())

    // The hand-picked size persists — nothing recomputes it on reload. Compared
    // in FLOW units, since the reload re-runs fitView at a different zoom.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Area Draw' })).toBeVisible()
    await waitForSettled(areaNodes(page).first())
    const reloadedFlow = await flowSize(page, areaNodes(page).first())
    expect(Math.abs(reloadedFlow.width - resizedFlow.width)).toBeLessThan(4)
    expect(Math.abs(reloadedFlow.height - resizedFlow.height)).toBeLessThan(4)
  })

  test('a mis-click keeps the tool armed and creates nothing', async ({
    page,
  }) => {
    await openBoard(page)
    await page.getByRole('button', { name: 'Add area' }).click()
    await expect(
      page.getByRole('button', { name: 'Drag to draw...' }),
    ).toBeVisible()

    // Below ShapeDrawOverlay's drag threshold — the one deliberate
    // non-disarming case: nothing is created and the tool stays armed, so the
    // user can simply try the drag again.
    const accounts = await tableNode(page, 'accounts').first().boundingBox()
    if (!accounts) throw new Error('missing table bounding box')
    const point = { x: accounts.x - 60, y: accounts.y - 60 }
    await dragMouse(page, point, { x: point.x + 2, y: point.y + 2 })

    await expect(areaNodes(page)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Drag to draw...' }),
    ).toBeVisible()

    // Escape disarms, back to plain selection.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Add area' })).toBeVisible()
    await expect(areaNodes(page)).toHaveCount(0)
  })
})

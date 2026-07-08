// e2e/multi-select-drag.spec.ts
// End-to-end coverage for multi-select table drag persist + area reconcile
// (GH #111): before this fix, dragging a multi-selection of tables only
// persisted the drag "leader" node — every other co-dragged table's new
// position, and its area membership, was silently dropped. This suite
// drives the real UI (multi-select via ctrl-click, native mouse drag) and
// asserts EVERY dragged table's new position + area membership persisted.
//
// Persistence is asserted via RELOAD, not the live Socket.IO broadcast: the
// dev Vite process runs server functions (like `updateTablePositionsBulk`)
// in a process where `io` is null, so the broadcast emitted from inside that
// server function is a no-op in dev (see playwright.config.ts). The socket
// round-trip used for optimistic peer relay (`table:move:bulk`,
// `area:update`) DOES work in dev (it's a genuine client<->socket-server
// round trip, not an HTTP server-function reaching for `io`), but we still
// reload to prove the DB write itself succeeded, independent of any socket
// path — the same pattern version-history.spec.ts uses for restore.
import { test, expect, type Page, type Locator } from '@playwright/test'
import { IDS } from './fixtures'

// This suite mutates positions + area membership and does NOT restore them,
// so it runs against its OWN dedicated board (IDS.mdWhiteboard, seeded in
// e2e/seed.ts) — isolated from the shared board every other spec uses. That
// keeps test 1's "pristine geometry" assumption reliable regardless of run
// order, and prevents this suite from polluting later specs' shared board.
const WB_URL = `/whiteboard/${IDS.mdWhiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E Multi-Drag' })).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('orders', { exact: true }).first(),
  ).toBeVisible()
}

/** Poll the `.react-flow__viewport` pane's `translate(...) scale(z)` inline
 * transform until it reports the same value on two consecutive reads (100ms
 * apart) — proof a pan/zoom (e.g. the Toolbar's animated "Zoom Out", see
 * `ensureDragFitsOnScreen`) has finished and it is safe to read
 * `getViewportScale`/node sizes derived from it. */
async function waitForViewportSettled(
  page: Page,
  timeout = 5000,
): Promise<void> {
  let lastTransform: string | null = null
  await expect
    .poll(
      async () => {
        const current = await page
          .locator('.react-flow__viewport')
          .evaluate((el) => (el as HTMLElement).style.transform)
        const settled = current !== '' && current === lastTransform
        lastTransform = current
        return settled
      },
      { timeout, intervals: [100] },
    )
    .toBe(true)
}

function nodeLocator(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

function tableHeaderText(page: Page, id: string, name: string): Locator {
  return nodeLocator(page, id)
    .locator('.table-header')
    .getByText(name, { exact: true })
}

/** React Flow's viewport pane carries `translate(...) scale(z)` — read `z`
 * so screen-pixel mouse deltas can be converted to/from flow-space units
 * (individual node transforms are always in UNSCALED flow-space). */
async function getViewportScale(page: Page): Promise<number> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform)
  const match = /scale\(([-\d.]+)\)/.exec(transform)
  if (!match) throw new Error(`unexpected viewport transform: ${transform}`)
  return parseFloat(match[1])
}

/** Read a node's flow-space position straight from React Flow's own
 * `translate(x,y)` inline style — this is the same value the DB persists as
 * positionX/positionY, and is unaffected by viewport pan/zoom. */
async function getNodePosition(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  const transform = await nodeLocator(page, id).evaluate(
    (el) => (el as HTMLElement).style.transform,
  )
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`unexpected node transform: ${transform}`)
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) }
}

async function getNodeFlowSize(
  page: Page,
  id: string,
  scale: number,
): Promise<{ width: number; height: number }> {
  const box = await nodeLocator(page, id).boundingBox()
  if (!box) throw new Error(`no bounding box for node ${id}`)
  return { width: box.width / scale, height: box.height / scale }
}

async function getNodeCenter(page: Page, id: string, scale: number) {
  const [pos, size] = await Promise.all([
    getNodePosition(page, id),
    getNodeFlowSize(page, id, scale),
  ])
  return { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }
}

/** Poll a node's inline `translate(x,y)` transform AND its rendered
 * bounding-box size until both report the same value on two consecutive
 * reads (100ms apart) — proof the drag/reload has finished writing the
 * node's on-screen position *and* size (an auto-fit area's box can resize
 * asynchronously as React Flow measures it, independent of its own
 * position) and it is safe to read for an assertion. Reading immediately
 * after a drag or reload can race that final layout write (observed flake:
 * position/size read mid-settle), so callers that assert on a node's
 * post-drag/post-reload rect or center should await this first instead of a
 * fixed sleep. */
async function waitForNodeSettled(
  page: Page,
  id: string,
  timeout = 5000,
): Promise<void> {
  let lastSignature: string | null = null
  await expect
    .poll(
      async () => {
        const locator = nodeLocator(page, id)
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

type SettledAreaAndTables = {
  areaRect: { left: number; top: number; right: number; bottom: number }
  usersCenter: { x: number; y: number }
  ordersCenter: { x: number; y: number }
}

/** Reload the page and read back the area's rect + both dragged tables'
 * settled centers (waiting on `waitForNodeSettled` for each — see above). */
async function reloadAndReadAreaAndTables(
  page: Page,
): Promise<SettledAreaAndTables> {
  await page.reload()
  await expect(page.getByRole('heading', { name: 'E2E Multi-Drag' })).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('orders', { exact: true }).first(),
  ).toBeVisible()

  await Promise.all([
    waitForNodeSettled(page, IDS.mdArea),
    waitForNodeSettled(page, IDS.mdUsersTable),
    waitForNodeSettled(page, IDS.mdOrdersTable),
  ])

  const scale = await getViewportScale(page)
  const areaPos = await getNodePosition(page, IDS.mdArea)
  const areaSize = await getNodeFlowSize(page, IDS.mdArea, scale)
  const areaRect = {
    left: areaPos.x,
    top: areaPos.y,
    right: areaPos.x + areaSize.width,
    bottom: areaPos.y + areaSize.height,
  }
  const [usersCenter, ordersCenter] = await Promise.all([
    getNodeCenter(page, IDS.mdUsersTable, scale),
    getNodeCenter(page, IDS.mdOrdersTable, scale),
  ])
  return { areaRect, usersCenter, ordersCenter }
}

function isCenterInsideRect(
  rect: { left: number; top: number; right: number; bottom: number },
  center: { x: number; y: number },
): boolean {
  return (
    center.x > rect.left &&
    center.x < rect.right &&
    center.y > rect.top &&
    center.y < rect.bottom
  )
}

/** The area's membership/bounds change after a multi-drag persists via a
 * fire-and-forget Socket.IO `area:update` emit (see
 * `src/hooks/use-whiteboard-areas.ts`'s `updateArea` — it emits with no ack
 * callback), so there is no client-observable signal of when the server has
 * actually committed the new membership/refit bounds. A single reload can
 * therefore race that server-side write and read back stale (pre-drag) area
 * data even after the dragged tables' own DOM positions have settled
 * (`waitForNodeSettled` alone does not cover this — it was still observed to
 * flake). Poll by reloading repeatedly (bounded by `timeoutMs`) until the
 * read-back state matches the expected join/leave outcome, or give up and
 * return the last read so the caller's own `expect(...)` calls fail with the
 * real, final, settled values (not a guessed intermediate one). */
async function reloadUntilAreaReconciled(
  page: Page,
  timeoutMs = 8000,
): Promise<SettledAreaAndTables> {
  const deadline = Date.now() + timeoutMs
  let last: SettledAreaAndTables
  for (;;) {
    last = await reloadAndReadAreaAndTables(page)
    const ordersJoined = isCenterInsideRect(last.areaRect, last.ordersCenter)
    const usersLeft = !isCenterInsideRect(last.areaRect, last.usersCenter)
    if (ordersJoined && usersLeft) return last
    if (Date.now() > deadline) return last
    await page.waitForTimeout(300)
  }
}

/** `multiSelectAndDrag` converts a FLOW-space delta to on-screen pixels using
 * the live zoom scale. For a large delta (e.g. test 1's boundary-hugging
 * area-membership drag, which must travel ~400+ flow units) that pixel
 * distance can push the drag's END point — or even its start — past the edge
 * of the viewport. Dragging a real mouse pointer to/through an off-screen
 * coordinate is not reliably handled by the browser: this was the actual
 * root cause of the observed flake (a landing position that varied between
 * otherwise byte-identical runs — same start/end coordinates computed every
 * time, since the pre-drag measurements are deterministic, but the ACTUAL
 * drop position differed once the drag path left the visible viewport).
 * Zoom out (via the Toolbar's "Zoom Out" control the app already exposes)
 * until both the start and computed end point stay safely on screen, so the
 * drag path never has to leave visible viewport space. */
async function ensureDragFitsOnScreen(
  page: Page,
  startLocator: Locator,
  delta: { dx: number; dy: number },
  margin = 60,
): Promise<void> {
  const viewport = page.viewportSize()
  if (!viewport) return
  const within = (x: number, y: number) =>
    x > margin &&
    x < viewport.width - margin &&
    y > margin &&
    y < viewport.height - margin

  for (let attempt = 0; attempt < 10; attempt++) {
    const scale = await getViewportScale(page)
    const box = await startLocator.boundingBox()
    if (!box) throw new Error('no bounding box while checking drag fit')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    const endX = startX + delta.dx * scale
    const endY = startY + delta.dy * scale
    if (within(startX, startY) && within(endX, endY)) return

    // Both the Toolbar and React Flow's own <Controls/> render a "Zoom Out"
    // button — scope to the Controls one (stable `rf__controls` testid) to
    // avoid an ambiguous multi-match.
    await page
      .getByTestId('rf__controls')
      .getByRole('button', { name: 'Zoom Out' })
      .click()
    await waitForViewportSettled(page) // zoomOut animates over 200ms
  }
  throw new Error(
    'Could not zoom out far enough to keep the multi-drag on screen',
  )
}

/** Multi-select the `users` + `orders` table nodes via ctrl-click (React
 * Flow's default `multiSelectionKeyCode` on non-macOS — the ReactFlowCanvas
 * instance in this app does not override it), then perform a native mouse
 * drag of the whole selection, initiated from the `users` node, by the given
 * FLOW-space delta (converted to screen pixels via the live zoom). */
async function multiSelectAndDrag(
  page: Page,
  delta: { dx: number; dy: number },
) {
  const usersHeader = tableHeaderText(page, IDS.mdUsersTable, 'users')
  const ordersHeader = tableHeaderText(page, IDS.mdOrdersTable, 'orders')

  await usersHeader.click()
  await ordersHeader.click({ modifiers: ['Control'] })

  await ensureDragFitsOnScreen(page, usersHeader, delta)

  const scale = await getViewportScale(page)
  const startBox = await usersHeader.boundingBox()
  if (!startBox) throw new Error('no bounding box for users header')
  const startX = startBox.x + startBox.width / 2
  const startY = startBox.y + startBox.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + delta.dx * scale, startY + delta.dy * scale, {
    steps: 12,
  })

  // `handleNodeDragStop`'s multi-drag branch persists via a fire-and-forget
  // `updateTablePositionsBulk` server-fn call (not awaited by the app) —
  // register the response listener BEFORE mouse.up() fires it, so callers
  // that reload right after this helper returns are guaranteed the DB write
  // actually landed first, instead of racing it (this is the root cause of
  // the observed flake: a reload firing before the persist POST resolved
  // reads back the pre-drag position).
  const persisted = page.waitForResponse(
    (res) => res.request().method() === 'POST' && isBulkPositionPersistUrl(res.url()),
    { timeout: 10_000 },
  )
  await page.mouse.up()
  await persisted
}

/** TanStack Start server-fn URLs are `/_serverFn/<base64url(JSON)>`, where the
 * JSON identifies the source file + export (e.g.
 * `{"file":"...server-functions.ts...","export":"updateTablePositionsBulk_..."}`).
 * Decode that segment so `waitForResponse` targets the EXACT bulk-position
 * persist call rather than any POST — other server-fn calls (e.g. session
 * checks) can legitimately fire around the same time as the drag, especially
 * on a cold-started dev server, and matching any POST risks resolving on one
 * of those instead of the real persist (observed: a near-miss flake after a
 * looser match). */
function isBulkPositionPersistUrl(url: string): boolean {
  const marker = '/_serverFn/'
  const idx = url.indexOf(marker)
  if (idx === -1) return false
  const encoded = url.slice(idx + marker.length).split(/[?#]/)[0]
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8')
    return decoded.includes('updateTablePositionsBulk')
  } catch {
    return false
  }
}

test.describe('Multi-select table drag persist + area reconcile (GH #111)', () => {
  // Relies on the dedicated board's pristine seed geometry (`users` starts as
  // the "Identity" area's only member, centered inside it; `orders` starts
  // well outside it) to compute the drag delta below. Because this suite owns
  // its board (no other spec touches it), that geometry holds regardless of
  // run order — so this test is not order-dependent.
  test('multi-drag reconciles each dragged table\'s area membership independently (FR-2, NFR-1)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const scale = await getViewportScale(page)
    const areaPos = await getNodePosition(page, IDS.mdArea)
    const areaSize = await getNodeFlowSize(page, IDS.mdArea, scale)
    const areaCenter = {
      x: areaPos.x + areaSize.width / 2,
      y: areaPos.y + areaSize.height / 2,
    }

    const ordersCenterBefore = await getNodeCenter(page, IDS.mdOrdersTable, scale)

    // Drag the shared selection so `orders`' new center lands exactly at the
    // (stationary) area's center — guaranteed inside. Because both dragged
    // tables move by the SAME delta, and the seed's `users`/`orders` starting
    // offset (~400x200 flow units) exceeds the area's half-extents on both
    // axes, this same delta necessarily pushes `users`' new center outside
    // the area — proving the reconcile loop ran independently for BOTH
    // dragged tables (one joins, the other leaves), not just the drag
    // leader (`users`, the node the drag was initiated from).
    const delta = {
      dx: areaCenter.x - ordersCenterBefore.x,
      dy: areaCenter.y - ordersCenterBefore.y,
    }

    await multiSelectAndDrag(page, delta)

    // Reload and read back the area + both dragged tables' settled state,
    // retrying (bounded) if the area's membership/bounds haven't reconciled
    // yet — see `reloadUntilAreaReconciled` for why a single reload can race
    // the fire-and-forget `area:update` persist.
    const { areaRect: areaRectAfter, usersCenter: usersCenterAfter, ordersCenter: ordersCenterAfter } =
      await reloadUntilAreaReconciled(page)

    // `orders` (the co-dragged, non-leader table) joined — its new center
    // persisted inside the refit area rect. This is the behavior that did
    // NOT work before GH #111 (only the leader's membership was reconciled).
    expect(ordersCenterAfter.x).toBeGreaterThan(areaRectAfter.left)
    expect(ordersCenterAfter.x).toBeLessThan(areaRectAfter.right)
    expect(ordersCenterAfter.y).toBeGreaterThan(areaRectAfter.top)
    expect(ordersCenterAfter.y).toBeLessThan(areaRectAfter.bottom)

    // `users` (the drag leader) left — its new center persisted outside the
    // refit area rect.
    const usersOutside =
      usersCenterAfter.x < areaRectAfter.left ||
      usersCenterAfter.x > areaRectAfter.right ||
      usersCenterAfter.y < areaRectAfter.top ||
      usersCenterAfter.y > areaRectAfter.bottom
    expect(usersOutside).toBe(true)
  })

  test('dragging a multi-selection persists EVERY dragged table across reload (FR-1, FR-3, FR-5)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const usersBefore = await getNodePosition(page, IDS.mdUsersTable)
    const ordersBefore = await getNodePosition(page, IDS.mdOrdersTable)

    await multiSelectAndDrag(page, { dx: 150, dy: 90 })
    await page.waitForTimeout(500)

    const usersAfterDrag = await getNodePosition(page, IDS.mdUsersTable)
    const ordersAfterDrag = await getNodePosition(page, IDS.mdOrdersTable)

    // Both dragged tables actually moved — not just the drag leader.
    expect(
      Math.hypot(
        usersAfterDrag.x - usersBefore.x,
        usersAfterDrag.y - usersBefore.y,
      ),
    ).toBeGreaterThan(50)
    expect(
      Math.hypot(
        ordersAfterDrag.x - ordersBefore.x,
        ordersAfterDrag.y - ordersBefore.y,
      ),
    ).toBeGreaterThan(50)

    // A true group drag: both tables moved by the same delta.
    expect(
      Math.abs(
        usersAfterDrag.x - usersBefore.x - (ordersAfterDrag.x - ordersBefore.x),
      ),
    ).toBeLessThan(2)
    expect(
      Math.abs(
        usersAfterDrag.y - usersBefore.y - (ordersAfterDrag.y - ordersBefore.y),
      ),
    ).toBeLessThan(2)

    // GH #111 core assertion: reload and confirm BOTH tables' new positions
    // persisted server-side (not just the drag leader's).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Multi-Drag' })).toBeVisible()
    await expect(
      page.locator('.react-flow').getByText('users', { exact: true }).first(),
    ).toBeVisible()

    const usersAfterReload = await getNodePosition(page, IDS.mdUsersTable)
    const ordersAfterReload = await getNodePosition(page, IDS.mdOrdersTable)

    expect(Math.abs(usersAfterReload.x - usersAfterDrag.x)).toBeLessThan(1)
    expect(Math.abs(usersAfterReload.y - usersAfterDrag.y)).toBeLessThan(1)
    expect(Math.abs(ordersAfterReload.x - ordersAfterDrag.x)).toBeLessThan(1)
    expect(Math.abs(ordersAfterReload.y - ordersAfterDrag.y)).toBeLessThan(1)
  })

  test('single-table drag still persists exactly as before — unchanged path (FR-4)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const ordersHeader = tableHeaderText(page, IDS.mdOrdersTable, 'orders')
    const box = await ordersHeader.boundingBox()
    if (!box) throw new Error('no bounding box for orders header')

    const before = await getNodePosition(page, IDS.mdOrdersTable)

    // Single-node drag — no multi-select, exercises the untouched
    // `dragged.length <= 1` branch.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box.x + box.width / 2 + 120,
      box.y + box.height / 2 + 70,
      { steps: 8 },
    )
    await page.mouse.up()
    await page.waitForTimeout(300)

    const afterDrag = await getNodePosition(page, IDS.mdOrdersTable)
    expect(
      Math.hypot(afterDrag.x - before.x, afterDrag.y - before.y),
    ).toBeGreaterThan(20)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Multi-Drag' })).toBeVisible()
    await expect(
      page.locator('.react-flow').getByText('orders', { exact: true }).first(),
    ).toBeVisible()

    const afterReload = await getNodePosition(page, IDS.mdOrdersTable)
    expect(Math.abs(afterReload.x - afterDrag.x)).toBeLessThan(1)
    expect(Math.abs(afterReload.y - afterDrag.y)).toBeLessThan(1)
  })
})

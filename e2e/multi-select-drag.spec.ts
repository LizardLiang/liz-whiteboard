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

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('orders', { exact: true }).first(),
  ).toBeVisible()
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

/** Multi-select the `users` + `orders` table nodes via ctrl-click (React
 * Flow's default `multiSelectionKeyCode` on non-macOS — the ReactFlowCanvas
 * instance in this app does not override it), then perform a native mouse
 * drag of the whole selection, initiated from the `users` node, by the given
 * FLOW-space delta (converted to screen pixels via the live zoom). */
async function multiSelectAndDrag(
  page: Page,
  delta: { dx: number; dy: number },
) {
  const usersHeader = tableHeaderText(page, IDS.usersTable, 'users')
  const ordersHeader = tableHeaderText(page, IDS.ordersTable, 'orders')

  await usersHeader.click()
  await ordersHeader.click({ modifiers: ['Control'] })

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
  await page.mouse.up()
}

test.describe('Multi-select table drag persist + area reconcile (GH #111)', () => {
  // Runs FIRST and against pristine seed positions deliberately — the
  // computed drag delta below relies on the seed's known geometry (`users`
  // starts as the "Identity" area's only member, centered inside it;
  // `orders` starts well outside it). Later tests read positions live and
  // don't depend on absolute state, so ordering only matters for this one.
  test('multi-drag reconciles each dragged table\'s area membership independently (FR-2, NFR-1)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const scale = await getViewportScale(page)
    const areaPos = await getNodePosition(page, IDS.area)
    const areaSize = await getNodeFlowSize(page, IDS.area, scale)
    const areaCenter = {
      x: areaPos.x + areaSize.width / 2,
      y: areaPos.y + areaSize.height / 2,
    }

    const ordersCenterBefore = await getNodeCenter(page, IDS.ordersTable, scale)

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
    // Let the optimistic area:update / area membership emits settle before
    // reloading.
    await page.waitForTimeout(500)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(
      page.locator('.react-flow').getByText('orders', { exact: true }).first(),
    ).toBeVisible()

    const scaleAfter = await getViewportScale(page)
    const areaPosAfter = await getNodePosition(page, IDS.area)
    const areaSizeAfter = await getNodeFlowSize(page, IDS.area, scaleAfter)
    const areaRectAfter = {
      left: areaPosAfter.x,
      top: areaPosAfter.y,
      right: areaPosAfter.x + areaSizeAfter.width,
      bottom: areaPosAfter.y + areaSizeAfter.height,
    }

    const [usersCenterAfter, ordersCenterAfter] = await Promise.all([
      getNodeCenter(page, IDS.usersTable, scaleAfter),
      getNodeCenter(page, IDS.ordersTable, scaleAfter),
    ])

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

    const usersBefore = await getNodePosition(page, IDS.usersTable)
    const ordersBefore = await getNodePosition(page, IDS.ordersTable)

    await multiSelectAndDrag(page, { dx: 150, dy: 90 })
    await page.waitForTimeout(500)

    const usersAfterDrag = await getNodePosition(page, IDS.usersTable)
    const ordersAfterDrag = await getNodePosition(page, IDS.ordersTable)

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
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(
      page.locator('.react-flow').getByText('users', { exact: true }).first(),
    ).toBeVisible()

    const usersAfterReload = await getNodePosition(page, IDS.usersTable)
    const ordersAfterReload = await getNodePosition(page, IDS.ordersTable)

    expect(Math.abs(usersAfterReload.x - usersAfterDrag.x)).toBeLessThan(1)
    expect(Math.abs(usersAfterReload.y - usersAfterDrag.y)).toBeLessThan(1)
    expect(Math.abs(ordersAfterReload.x - ordersAfterDrag.x)).toBeLessThan(1)
    expect(Math.abs(ordersAfterReload.y - ordersAfterDrag.y)).toBeLessThan(1)
  })

  test('single-table drag still persists exactly as before — unchanged path (FR-4)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const ordersHeader = tableHeaderText(page, IDS.ordersTable, 'orders')
    const box = await ordersHeader.boundingBox()
    if (!box) throw new Error('no bounding box for orders header')

    const before = await getNodePosition(page, IDS.ordersTable)

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

    const afterDrag = await getNodePosition(page, IDS.ordersTable)
    expect(
      Math.hypot(afterDrag.x - before.x, afterDrag.y - before.y),
    ).toBeGreaterThan(20)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(
      page.locator('.react-flow').getByText('orders', { exact: true }).first(),
    ).toBeVisible()

    const afterReload = await getNodePosition(page, IDS.ordersTable)
    expect(Math.abs(afterReload.x - afterDrag.x)).toBeLessThan(1)
    expect(Math.abs(afterReload.y - afterDrag.y)).toBeLessThan(1)
  })
})

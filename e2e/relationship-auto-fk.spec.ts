// e2e/relationship-auto-fk.spec.ts
// Ticket #6257: building a connection turns the source field's FK flag on, and
// removing the last connection from that field turns it off again. The source
// field is the column the user drags FROM (the DDL generator emits
// FOREIGN KEY (<source column>)). The flag is read back through the table
// fields window, which lists each column with its PK/FK badges.
//
// Auth + seed follow version-history.spec.ts: storageState from global-setup,
// board seeded by `bun run e2e/seed-relationship-auto-fk.ts`.
//
// Live broadcast to OTHER clients needs the single-process prod build (`io` is
// null in the dev Vite process; see playwright.config.ts), so peer sync is not
// asserted. Persistence is asserted by reloading the page.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { HEADER_H, ROW_H, getViewportScale, tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const WB_URL = `/whiteboard/${IDS.autoFkWhiteboard}`
const CUSTOMER_ID_ROW = 1

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-relationship-auto-fk.ts'], {
    stdio: 'inherit',
  })
})

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E Auto FK' })).toBeVisible()
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
  for (const name of ['orders', 'customers', 'segments']) {
    await expect(tableNode(page, name).first()).toBeVisible()
  }
  await page.waitForLoadState('networkidle')
  // Relationship deletes travel over the socket, which connects after mount.
  await expect(page.getByText(/^(Reconnecting|Disconnected) —/)).toHaveCount(0)
}

/** Point inside a column row, biased toward its right edge (handle side). */
async function rowPoint(page: Page, tableName: string, rowIndex: number) {
  const box = (await tableNode(page, tableName).first().boundingBox())!
  const zoom = await getViewportScale(page)
  return {
    x: box.x + box.width * 0.85,
    y: box.y + (HEADER_H + rowIndex * ROW_H + ROW_H / 2) * zoom,
  }
}

/** Real drag from orders.customer_id to `targetTable`'s id column. */
async function connect(
  page: Page,
  targetTableId: string,
  targetColumnId: string,
) {
  const sourceHandle = page.locator(
    `[data-handleid="${IDS.autoFkOrdersTable}__${IDS.autoFkOrdersCustomerId}__right__source"]`,
  )
  const targetHandle = page.locator(
    `[data-handleid="${targetTableId}__${targetColumnId}__left__target"]`,
  )
  await expect(sourceHandle).toHaveCount(1)
  await expect(targetHandle).toHaveCount(1)

  // Hover the row so the source handle arms, then press on the handle itself.
  const row = await rowPoint(page, 'orders', CUSTOMER_ID_ROW)
  await page.mouse.move(row.x, row.y)
  await page.mouse.move(row.x, row.y)
  const s = (await sourceHandle.boundingBox())!
  const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const t = (await targetHandle.boundingBox())!
  const to = { x: t.x + t.width / 2, y: t.y + t.height / 2 }
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 10 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()

  await expect(
    page.getByRole('heading', { name: 'Set Relationship Cardinality' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { name: 'Set Relationship Cardinality' }),
  ).toBeHidden()
}

const drawer = (page: Page) => page.getByTestId('table-fields-drawer')

/** Open the fields window for `orders`; returns its customer_id and total rows. */
async function openOrdersFields(page: Page) {
  await tableNode(page, 'orders')
    .first()
    .click({ position: { x: 20, y: 8 } })
  await expect(
    drawer(page).getByRole('heading', { name: 'Fields of orders' }),
  ).toBeVisible()
  const rows = drawer(page).getByTestId('fields-drawer-row')
  await expect(rows).toHaveCount(7)
  return {
    customerId: rows.filter({ hasText: 'customer_id' }),
    all: rows,
  }
}

async function closeDrawer(page: Page) {
  await drawer(page)
    .getByRole('button', { name: 'Close fields drawer' })
    .click()
  await expect(drawer(page)).toBeHidden()
}

/** Delete the connection that ends on `targetTableId`. Two lines from one
 *  field overlap near the source, so click the stroke close to its target. */
async function deleteEdge(page: Page, targetTableId?: string) {
  const edge = targetTableId
    ? page.locator(`.react-flow__edge[aria-label$="to ${targetTableId}"]`)
    : page.locator('.react-flow__edge').first()
  const stroke = edge.locator('path.react-flow__edge-path').first()
  await stroke.waitFor({ state: 'attached' })
  // Click a point on the stroke clear of the label/delete button at the midpoint.
  const fraction = targetTableId ? 0.8 : 0.25
  const point = await stroke.evaluate((el: SVGPathElement, frac: number) => {
    const svg = el.ownerSVGElement!
    const ctm = el.getScreenCTM()!
    const at = el.getPointAtLength(el.getTotalLength() * frac)
    const p = svg.createSVGPoint()
    p.x = at.x
    p.y = at.y
    const screen = p.matrixTransform(ctm)
    return { x: screen.x, y: screen.y }
  }, fraction)
  await page.mouse.click(point.x, point.y)
  await expect(edge).toHaveClass(/selected/)
  await page.keyboard.press('Delete')
}

test.describe('Relationship auto-sets the source field FK (#6257)', () => {
  test('drag-connect turns FK on for the source field, it survives reload, and deleting the connection turns it off', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Baseline: no field on orders carries FK.
    let fields = await openOrdersFields(page)
    await expect(fields.all.getByText('FK', { exact: true })).toHaveCount(0)
    await closeDrawer(page)

    await connect(page, IDS.autoFkCustomersTable, IDS.autoFkCustomersId)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    // FK badge appears on the source field only, without a reload.
    fields = await openOrdersFields(page)
    await expect(
      fields.customerId.getByText('FK', { exact: true }),
    ).toBeVisible()
    await expect(fields.all.getByText('FK', { exact: true })).toHaveCount(1)
    await closeDrawer(page)

    // Persisted: still there after a reload, and the target column has none.
    await page.reload()
    await openWhiteboard(page)
    fields = await openOrdersFields(page)
    await expect(
      fields.customerId.getByText('FK', { exact: true }),
    ).toBeVisible()
    await expect(fields.all.getByText('FK', { exact: true })).toHaveCount(1)
    await closeDrawer(page)

    // Delete the connection: the badge goes, and stays gone after a reload.
    await deleteEdge(page)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await page.reload()
    await openWhiteboard(page)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    fields = await openOrdersFields(page)
    await expect(fields.all.getByText('FK', { exact: true })).toHaveCount(0)
  })

  test('deleting one of two connections from the same field keeps FK on', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await connect(page, IDS.autoFkCustomersTable, IDS.autoFkCustomersId)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    await connect(page, IDS.autoFkSegmentsTable, IDS.autoFkSegmentsId)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)

    await deleteEdge(page, IDS.autoFkSegmentsTable)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    await page.reload()
    await openWhiteboard(page)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    const fields = await openOrdersFields(page)
    await expect(
      fields.customerId.getByText('FK', { exact: true }),
    ).toBeVisible()
  })
})

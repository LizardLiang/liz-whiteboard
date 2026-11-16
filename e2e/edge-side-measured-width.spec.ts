// e2e/edge-side-measured-width.spec.ts
// Edge side choice must use each table's RENDERED width. A table with long
// column and type names renders far wider than DEFAULT_NODE_WIDTH (250). When
// routing fell back to the default, a wide table "ended" far left of its real
// right edge, so a partner that sits just right of that default edge — but
// left of the real one — looked "clearly to the right": the edge left the
// partner's LEFT side, entered the wide table's RIGHT side, ran behind the
// wide table and hid its label there.
//
// The default-width pass ran after every props sync (page load, drag stop of
// ANY table): the props sync replaces React Flow's nodes, the new objects
// carry no measured size, and the old one-shot post-measure re-route had
// already fired. This test covers load, a drag of an unrelated table, and a
// reload.
//
// Seeded inline under Bun (Playwright's runner is Node, no bun:sqlite); the
// seed resets only this board, so it is safe to run before every test.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS as SHARED } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const IDS = {
  whiteboard: 'e5e00000-0000-4000-8000-000000000001',
  orders: 'e5e00000-0000-4000-8000-000000000011',
  payments: 'e5e00000-0000-4000-8000-000000000012',
  audit: 'e5e00000-0000-4000-8000-000000000013',
  relationship: 'e5e00000-0000-4000-8000-000000000031',
}

// `customer_orders` renders ~600 px wide. `payments` starts at x 300: right
// of the default edge (0 + 250 + 20) but well left of the real one, and below
// it so the two do not overlap.
const ORDERS = { x: 0, y: 0 }
const PAYMENTS = { x: 300, y: 620 }
const AUDIT = { x: -700, y: 0 }

const SEED_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const I = JSON.parse(process.env.SEED_IDS)
const G = JSON.parse(process.env.SEED_GEOMETRY)
const now = Date.now()
db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(I.whiteboard)
db.query('INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
  .run(I.whiteboard, 'E2E Edge Side Measured Width', process.env.PROJECT_ID, null, null, null, now, now)
const table = db.query('INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
table.run(I.orders, I.whiteboard, 'customer_orders', null, G.orders.x, G.orders.y, null, null, now, now)
table.run(I.payments, I.whiteboard, 'payments', null, G.payments.x, G.payments.y, null, null, now, now)
table.run(I.audit, I.whiteboard, 'audit_log', null, G.audit.x, G.audit.y, null, null, now, now)
const col = db.query('INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
let n = 0
const cid = () => 'e5e00000-0000-4000-8001-' + String(++n).padStart(12, '0')
const ordersId = cid()
col.run(ordersId, I.orders, 'id', 'BIGINT', 1, 0, 1, 0, 0, now, now)
const ordersCols = [
  ['order_number_for_customer_service_lookup', 'VARCHAR(20)'],
  ['status', "ENUM('draft','placed','paid','shipped','cancelled')"],
  ['subtotal_amount_before_discounts', 'DECIMAL(12,2)'],
  ['shipping_address_snapshot', 'JSONB'],
  ['cancelled_reason', 'VARCHAR(255)'],
  ['created_at', 'TIMESTAMPTZ'],
]
ordersCols.forEach(([name, type], i) => col.run(cid(), I.orders, name, type, 0, 0, 0, 1, i + 1, now, now))
col.run(cid(), I.payments, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
const paymentsFk = cid()
col.run(paymentsFk, I.payments, 'order_id', 'BIGINT', 0, 1, 0, 0, 1, now, now)
col.run(cid(), I.payments, 'amount', 'DECIMAL(12,2)', 0, 0, 0, 0, 2, now, now)
col.run(cid(), I.payments, 'gateway', 'VARCHAR(32)', 0, 0, 0, 0, 3, now, now)
col.run(cid(), I.audit, 'id', 'BIGSERIAL', 1, 0, 1, 0, 0, now, now)
col.run(cid(), I.audit, 'action', 'VARCHAR(64)', 0, 0, 0, 0, 1, now, now)
db.query('INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(I.relationship, I.whiteboard, I.payments, I.orders, paymentsFk, ordersId, 'MANY_TO_ONE', 'pays', null, now, now)
console.log('[e2e edge-side-measured-width] seeded')
`

test.beforeEach(() => {
  execFileSync('bun', ['-e', SEED_SCRIPT], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROJECT_ID: SHARED.project,
      SEED_IDS: JSON.stringify(IDS),
      SEED_GEOMETRY: JSON.stringify({
        orders: ORDERS,
        payments: PAYMENTS,
        audit: AUDIT,
      }),
    },
  })
})

/** The edge path's first and last point, in flow coordinates. */
async function edgeEnds(page: Page) {
  return page
    .locator(`path.react-flow__edge-path[id="${IDS.relationship}"]`)
    .evaluate((el: SVGPathElement) => {
      const start = el.getPointAtLength(0)
      const end = el.getPointAtLength(el.getTotalLength())
      return { startX: start.x, endX: end.x }
    })
}

/** A node's flow-space left, right and centre x, from its rendered box. */
async function flowBox(page: Page, name: string) {
  const box = await tableNode(page, name).first().boundingBox()
  const pane = await page.locator('.react-flow__viewport').evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return { tx: m.e, scale: m.a }
  })
  const paneBox = await page.locator('.react-flow').first().boundingBox()
  if (!box || !paneBox) throw new Error(`no box for ${name}`)
  const toFlow = (x: number) => (x - paneBox.x - pane.tx) / pane.scale
  return {
    left: toFlow(box.x),
    right: toFlow(box.x + box.width),
    centre: toFlow(box.x + box.width / 2),
  }
}

/** Both ends must sit on the RIGHT side: right of each table's centre. */
async function expectBothEndsRight(page: Page) {
  const payments = await flowBox(page, 'payments')
  const orders = await flowBox(page, 'customer_orders')
  const { startX, endX } = await edgeEnds(page)
  // Source = payments, target = customer_orders.
  expect(startX).toBeGreaterThan(payments.centre)
  expect(endX).toBeGreaterThan(orders.centre)
}

test('an edge to a wide table uses its rendered width to pick sides', async ({
  page,
}) => {
  await page.goto(`/whiteboard/${IDS.whiteboard}`)
  await expect(tableNode(page, 'customer_orders').first()).toBeVisible()
  await expect(tableNode(page, 'payments').first()).toBeVisible()
  const edge = page.locator(
    `path.react-flow__edge-path[id="${IDS.relationship}"]`,
  )
  await expect(edge).toHaveCount(1)
  // Let every re-route settle, then read once (a poll could pass on an early,
  // correct frame).
  await page.waitForTimeout(1500)

  // Sanity: the seed really puts payments right of the DEFAULT width edge but
  // left of the RENDERED right edge of customer_orders.
  const orders = await flowBox(page, 'customer_orders')
  const payments = await flowBox(page, 'payments')
  expect(payments.left).toBeGreaterThan(orders.left + 250 + 20)
  expect(payments.left).toBeLessThan(orders.right)

  await expectBothEndsRight(page)

  // Drag an UNRELATED table: its drag stop re-syncs every node from props,
  // which used to re-route this edge with default widths.
  const audit = await tableNode(page, 'audit_log').first().boundingBox()
  if (!audit) throw new Error('no audit_log box')
  await page.mouse.move(audit.x + 30, audit.y + 8)
  await page.mouse.down()
  await page.mouse.move(audit.x + 50, audit.y + 30, { steps: 5 })
  await page.mouse.move(audit.x + 70, audit.y + 50, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  await expectBothEndsRight(page)

  // Same answer after a reload (the page-load path).
  await page.reload()
  await expect(edge).toHaveCount(1)
  await page.waitForTimeout(1500)
  await expectBothEndsRight(page)
})

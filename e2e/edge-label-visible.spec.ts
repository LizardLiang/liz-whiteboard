// e2e/edge-label-visible.spec.ts
// A relationship label must stay readable. The canvas layer paints tables
// ABOVE the React Flow renderer that holds edge labels, so a label whose pill
// lands on a table is painted over. getSmoothStepPath has no obstacle
// avoidance: a right->right C-curve between two stacked tables runs up past a
// third table, and the path midpoint (the label) lands under it.
//
// Fix under test: the label slides along its own line to the nearest point no
// table covers; when no such point exists it is drawn in a layer above the
// canvas tables.
//
// Seeded inline under Bun (Playwright's runner is Node, no bun:sqlite); each
// seed resets only its own boards, so it is safe to run before every test.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS as SHARED } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const P = '1abe1a00-0000-4000-8000'
const IDS = {
  slideBoard: `${P}-000000000001`,
  coveredBoard: `${P}-000000000002`,
}

type Col = [name: string, type: string, pk: 0 | 1, fk: 0 | 1]
interface TableSeed {
  id: string
  name: string
  x: number
  y: number
  cols: Array<Col>
}
interface BoardSeed {
  id: string
  name: string
  tables: Array<TableSeed>
  // [sourceTable, sourceColumn, targetTable, targetColumn]
  relationship: [string, string, string, string]
  label: string
}

const wideCols = (extra: number): Array<Col> => [
  ['id', 'BIGINT', 1, 0],
  ['order_number_for_customer_service_lookup', 'VARCHAR(20)', 0, 0],
  ['subtotal_amount_before_discounts', 'DECIMAL(12,2)', 0, 0],
  ['shipping_address_snapshot_json_document', 'JSONB', 0, 0],
  ...Array.from({ length: extra }, (_, i): Col => [
    `audit_trail_field_${i + 1}`,
    'VARCHAR(64)',
    0,
    0,
  ]),
]

const LABEL = 'settles the order'

// payments (source) and orders (target) are stacked in one column, so the edge
// is a right->right C-curve. order_line_items sits to their right, between
// them, exactly where the curve's vertical run (and its midpoint) passes.
const SLIDE: BoardSeed = {
  id: IDS.slideBoard,
  name: 'E2E Edge Label Slide',
  label: LABEL,
  tables: [
    {
      id: `${P}-000000000011`,
      name: 'payment_transactions',
      x: 0,
      y: 0,
      cols: [
        ['id', 'UUID', 1, 0],
        ['order_id', 'BIGINT', 0, 1],
        ['amount', 'DECIMAL(12,2)', 0, 0],
        ['gateway', 'VARCHAR(32)', 0, 0],
      ],
    },
    {
      id: `${P}-000000000012`,
      name: 'customer_orders',
      x: 0,
      y: 900,
      cols: wideCols(2),
    },
    {
      id: `${P}-000000000013`,
      name: 'order_line_items',
      x: 120,
      y: 380,
      cols: wideCols(2),
    },
    {
      id: `${P}-000000000014`,
      name: 'audit_log',
      x: -700,
      y: 0,
      cols: [
        ['id', 'BIGSERIAL', 1, 0],
        ['action', 'VARCHAR(64)', 0, 0],
      ],
    },
  ],
  relationship: ['payment_transactions', 'order_id', 'customer_orders', 'id'],
}

// A tall table sits over both endpoints, so no point of the line is free.
const COVERED: BoardSeed = {
  id: IDS.coveredBoard,
  name: 'E2E Edge Label Covered',
  label: LABEL,
  tables: [
    {
      id: `${P}-000000000021`,
      name: 'payment_transactions',
      x: 0,
      y: 0,
      cols: [
        ['id', 'UUID', 1, 0],
        ['order_id', 'BIGINT', 0, 1],
      ],
    },
    {
      id: `${P}-000000000022`,
      name: 'customer_orders',
      x: 0,
      y: 120,
      cols: [
        ['id', 'BIGINT', 1, 0],
        ['status', 'VARCHAR(20)', 0, 0],
      ],
    },
    {
      id: `${P}-000000000023`,
      name: 'order_archive_snapshot',
      x: -40,
      y: -30,
      cols: wideCols(10),
    },
  ],
  relationship: ['payment_transactions', 'order_id', 'customer_orders', 'id'],
}

const SEED_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const B = JSON.parse(process.env.SEED_BOARD)
const now = Date.now()
db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(B.id)
db.query('INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
  .run(B.id, B.name, process.env.PROJECT_ID, null, null, null, now, now)
const table = db.query('INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
const col = db.query('INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
let n = 0
const colIds = {}
for (const t of B.tables) {
  table.run(t.id, B.id, t.name, null, t.x, t.y, null, null, now, now)
  t.cols.forEach(([name, type, pk, fk], i) => {
    const id = '1abe1a0' + B.id.slice(-1) + '-0000-4000-8001-' + String(++n).padStart(12, '0')
    colIds[t.name + '.' + name] = id
    col.run(id, t.id, name, type, pk, fk, pk, pk ? 0 : 1, i, now, now)
  })
}
const idOf = (name) => B.tables.find((t) => t.name === name).id
const [st, sc, tt, tc] = B.relationship
db.query('INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(B.id.slice(0, -3) + '3' + B.id.slice(-1) + '1', B.id, idOf(st), idOf(tt), colIds[st + '.' + sc], colIds[tt + '.' + tc], 'MANY_TO_ONE', B.label, null, now, now)
console.log('[e2e edge-label-visible] seeded ' + B.name)
`

function seed(board: BoardSeed) {
  execFileSync('bun', ['-e', SEED_SCRIPT], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROJECT_ID: SHARED.project,
      SEED_BOARD: JSON.stringify(board),
    },
  })
}

/** The label pill: the element holding the label text, wherever it renders. */
function pill(page: Page) {
  return page
    .locator(
      '.react-flow__edgelabel-renderer, [data-testid="edge-label-top-layer"]',
    )
    .getByText(LABEL, { exact: true })
}

async function tableBoxes(page: Page, names: Array<string>) {
  const boxes = []
  for (const name of names) {
    const box = await tableNode(page, name).first().boundingBox()
    if (!box) throw new Error(`no box for ${name}`)
    boxes.push({ name, ...box })
  }
  return boxes
}

/** The pill must be visible and overlap no table node's box. */
async function expectPillClearOfTables(page: Page, names: Array<string>) {
  const el = pill(page)
  await expect(el).toHaveCount(1)
  const box = await el.boundingBox()
  if (!box) throw new Error('label pill has no box')
  for (const t of await tableBoxes(page, names)) {
    const overlaps =
      box.x < t.x + t.width &&
      box.x + box.width > t.x &&
      box.y < t.y + t.height &&
      box.y + box.height > t.y
    expect(overlaps, `label pill overlaps table ${t.name}`).toBe(false)
  }
}

const SLIDE_TABLES = SLIDE.tables.map((t) => t.name)

async function openBoard(page: Page, id: string, names: Array<string>) {
  await page.goto(`/whiteboard/${id}`)
  for (const name of names) {
    await expect(tableNode(page, name).first()).toBeVisible()
  }
  await expect(pill(page)).toHaveCount(1)
  // Let every re-route and measure pass settle, then read once.
  await page.waitForTimeout(1500)
}

test('a label whose midpoint sits on a third table slides clear of every table', async ({
  page,
}) => {
  seed(SLIDE)
  await openBoard(page, SLIDE.id, SLIDE_TABLES)

  // Router decision (obstacle routing): the line now bends around
  // order_line_items instead of running through it, so its midpoint no longer
  // lands on that table. The label must still end up clear of every table, so
  // the checks below stay; the slide itself is covered by the covered-label
  // test and edge-label-placement unit tests.
  const items = (await tableBoxes(page, ['order_line_items']))[0]
  const edge = page.locator(
    `path.react-flow__edge-path[id="${SLIDE.id.slice(0, -3)}3${SLIDE.id.slice(-1)}1"]`,
  )
  const mid = await edge.evaluate((el: SVGPathElement) => {
    const m = el.getPointAtLength(el.getTotalLength() / 2)
    const ctm = el.getScreenCTM()
    if (!ctm) throw new Error('no CTM')
    return { x: m.x * ctm.a + ctm.e, y: m.y * ctm.d + ctm.f }
  })
  const midInsideItems =
    mid.x > items.x &&
    mid.x < items.x + items.width &&
    mid.y > items.y &&
    mid.y < items.y + items.height
  expect(midInsideItems).toBe(false)

  await expectPillClearOfTables(page, SLIDE_TABLES)

  // Drag an UNRELATED table: its drag stop re-syncs every node from props.
  const audit = await tableNode(page, 'audit_log').first().boundingBox()
  if (!audit) throw new Error('no audit_log box')
  await page.mouse.move(audit.x + 30, audit.y + 8)
  await page.mouse.down()
  await page.mouse.move(audit.x + 50, audit.y + 30, { steps: 5 })
  await page.mouse.move(audit.x + 70, audit.y + 50, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  await expectPillClearOfTables(page, SLIDE_TABLES)

  // Same answer after a reload (the page-load path).
  await page.reload()
  await expect(pill(page)).toHaveCount(1)
  await page.waitForTimeout(1500)
  await expectPillClearOfTables(page, SLIDE_TABLES)
})

test('a label with no free point on its line is drawn above the canvas tables', async ({
  page,
}) => {
  seed(COVERED)
  await openBoard(
    page,
    COVERED.id,
    COVERED.tables.map((t) => t.name),
  )
  const layer = page.locator('[data-testid="edge-label-top-layer"]')
  await expect(layer.getByText(LABEL, { exact: true })).toBeVisible()
  // The canvas table layer must sit below the layer holding the label.
  const order = await page.evaluate(() => {
    const z = (sel: string) =>
      Number(getComputedStyle(document.querySelector(sel)!).zIndex)
    return {
      canvas: z('[data-testid="canvas-node-layer"]'),
      labels: z('[data-testid="edge-label-top-layer"]'),
    }
  })
  expect(order.labels).toBeGreaterThan(order.canvas)
})

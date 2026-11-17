// e2e/edge-obstacle-routing.spec.ts
// A relationship line must route AROUND tables, not through them. The old
// getSmoothStepPath read only the 2 endpoint positions, so any table sitting
// between them was crossed. The router (orthogonal-router.ts) now plans a
// path around every table, picks the left/right side of each end, and
// re-routes when a table moves.
//
// Cases: (1) a table on the old straight path; (2) dragging a table onto a
// line, before and after reload; (3) a blocked right side makes the line
// leave from the left; (4) two lines through one gap stay >= 5 px apart.
//
// The line is read from the DOM path `d` (sampled along its length), so the
// test checks what the user sees. The persisted result is asserted via
// reload: Socket.IO broadcasts only exist in the single-process prod build,
// not in the dev Vite process this suite runs against.
//
// Seeded inline under Bun (Playwright's runner is Node, no bun:sqlite); each
// seed resets only its own boards, so it is safe to run before every test.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS as SHARED } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const P = '0b570000-0000-4000-8000'
const BOARD = (n: number) => `${P}-0000000000${String(n).padStart(2, '0')}`

interface TableSeed {
  name: string
  x: number
  y: number
  cols: Array<string>
}
interface BoardSeed {
  id: string
  name: string
  tables: Array<TableSeed>
  // [sourceTable, sourceColumn, targetTable, targetColumn]
  rels: Array<[string, string, string, string]>
}

const longName = 'customer_order_fulfilment_and_shipping_status_history'
const cjkName = '訂單明細與出貨狀態紀錄表'

/** 8-15 realistic columns; the first is the primary key. */
const cols = (n: number, extra: Array<string> = []): Array<string> =>
  [
    'id',
    ...extra,
    'created_at_timestamp_with_timezone',
    '客戶備註說明',
    'shipping_address_snapshot_json_document',
    'status',
    'updated_at',
    'tenant_id',
    'is_archived',
    'external_reference_number_for_lookup',
    'notes',
    'currency_code',
    'version',
    'deleted_at',
    'owner_id',
  ].slice(0, n)

const refCols = ['ref_one', 'ref_two']

function board(
  n: number,
  name: string,
  tables: Array<TableSeed>,
  rels: BoardSeed['rels'],
): BoardSeed {
  return { id: BOARD(n), name, tables, rels }
}

// 1: A (left) -> C (right) with B in the middle, on the old straight path. Z
// has no relationships at all.
const BETWEEN = board(
  1,
  'E2E Edge Obstacle Between',
  [
    { name: 'accounts_receivable', x: 0, y: 0, cols: cols(9, refCols) },
    { name: longName, x: 520, y: 0, cols: cols(14) },
    { name: cjkName, x: 1040, y: 0, cols: cols(10) },
    { name: 'orphan_lookup_table', x: 0, y: 700, cols: cols(8) },
  ],
  [['accounts_receivable', 'ref_one', cjkName, 'id']],
)

// 2: B starts well below the A-C line; the test drags it onto the line.
const DRAG = board(
  2,
  'E2E Edge Obstacle Drag',
  [
    { name: 'accounts_receivable', x: 0, y: 0, cols: cols(9, refCols) },
    { name: cjkName, x: 1040, y: 0, cols: cols(10) },
    { name: longName, x: 520, y: 650, cols: cols(14) },
    { name: 'orphan_lookup_table', x: 0, y: 700, cols: cols(8) },
  ],
  [['accounts_receivable', 'ref_one', cjkName, 'id']],
)

// 3: E sits just right of A (the test moves it there), so A's right side is
// blocked; C is to the right of both.
const BLOCKED = board(
  3,
  'E2E Edge Obstacle Blocked',
  [
    { name: 'accounts_receivable', x: 0, y: 0, cols: cols(9, refCols) },
    { name: longName, x: 700, y: 0, cols: cols(14) },
    { name: cjkName, x: 1300, y: 0, cols: cols(10) },
  ],
  [['accounts_receivable', 'ref_one', cjkName, 'id']],
)

// 4: two lines between adjacent rows of A and C, both through the gap around B.
const PARALLEL = board(
  4,
  'E2E Edge Obstacle Parallel',
  [
    { name: 'accounts_receivable', x: 0, y: 0, cols: cols(9, refCols) },
    { name: longName, x: 520, y: 0, cols: cols(14) },
    { name: cjkName, x: 1040, y: 0, cols: cols(10, ['id2']) },
  ],
  [
    ['accounts_receivable', 'ref_one', cjkName, 'id'],
    ['accounts_receivable', 'ref_two', cjkName, 'id2'],
  ],
)

const relId = (b: BoardSeed, i: number) => `${P}-9${b.id.slice(-2)}00000000${i}`

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
const colIds = {}
const tableIds = {}
let n = 0
B.tables.forEach((t, ti) => {
  const tid = '0b57d0' + B.id.slice(-2) + '-0000-4000-8000-' + String(ti + 1).padStart(12, '0')
  tableIds[t.name] = tid
  table.run(tid, B.id, t.name, null, t.x, t.y, null, null, now, now)
  t.cols.forEach((name, i) => {
    const id = '0b57c0' + B.id.slice(-2) + '-0000-4000-8001-' + String(++n).padStart(12, '0')
    colIds[t.name + '.' + name] = id
    col.run(id, tid, name, i === 0 ? 'UUID' : 'VARCHAR(64)', i === 0 ? 1 : 0, 0, i === 0 ? 1 : 0, i === 0 ? 0 : 1, i, now, now)
  })
})
const rel = db.query('INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
B.rels.forEach(([st, sc, tt, tc], i) => {
  rel.run(B.relIds[i], B.id, tableIds[st], tableIds[tt], colIds[st + '.' + sc], colIds[tt + '.' + tc], 'MANY_TO_ONE', null, null, now, now)
})
console.log('[e2e edge-obstacle-routing] seeded ' + B.name)
`

function seed(b: BoardSeed) {
  execFileSync('bun', ['-e', SEED_SCRIPT], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROJECT_ID: SHARED.project,
      SEED_BOARD: JSON.stringify({
        ...b,
        relIds: b.rels.map((_, i) => relId(b, i)),
      }),
    },
  })
}

interface Pt {
  x: number
  y: number
}
interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The line as points in flow coordinates (sampled along its length), plus the
 * transform that maps flow coordinates to the screen. */
async function readLine(page: Page, id: string) {
  return page
    .locator(`path.react-flow__edge-path[id="${id}"]`)
    .evaluate((el: SVGPathElement) => {
      const ctm = el.getScreenCTM()
      if (!ctm) throw new Error('no CTM')
      const total = el.getTotalLength()
      const pts: Array<{ x: number; y: number }> = []
      for (let l = 0; l <= total; l += 1) {
        const p = el.getPointAtLength(l)
        pts.push({ x: p.x, y: p.y })
      }
      return { pts, ctm: { a: ctm.a, d: ctm.d, e: ctm.e, f: ctm.f } }
    })
}

/** A table's box in flow coordinates. */
async function flowBox(
  page: Page,
  name: string,
  ctm: { a: number; d: number; e: number; f: number },
): Promise<Box> {
  const b = await tableNode(page, name).first().boundingBox()
  if (!b) throw new Error(`no box for ${name}`)
  return {
    x: (b.x - ctm.e) / ctm.a,
    y: (b.y - ctm.f) / ctm.d,
    width: b.width / ctm.a,
    height: b.height / ctm.d,
  }
}

const inside = (p: Pt, b: Box, shrink = 2) =>
  p.x > b.x + shrink &&
  p.x < b.x + b.width - shrink &&
  p.y > b.y + shrink &&
  p.y < b.y + b.height - shrink

async function expectLineClearsTables(
  page: Page,
  id: string,
  names: Array<string>,
) {
  const { pts, ctm } = await readLine(page, id)
  expect(pts.length).toBeGreaterThan(10)
  for (const name of names) {
    const box = await flowBox(page, name, ctm)
    const hit = pts.find((p) => inside(p, box))
    expect(hit, `line ${id} runs through ${name}`).toBeUndefined()
  }
}

async function openBoard(page: Page, b: BoardSeed) {
  await page.goto(`/whiteboard/${b.id}`)
  for (const t of b.tables) {
    await expect(tableNode(page, t.name).first()).toBeVisible()
  }
  await expect(
    page.locator(`path.react-flow__edge-path[id="${relId(b, 0)}"]`),
  ).toHaveCount(1)
  // Let every measure and re-route pass settle, then read once.
  await page.waitForTimeout(1500)
}

async function dragTable(
  page: Page,
  name: string,
  dxScreen: number,
  dyScreen: number,
) {
  const box = await tableNode(page, name).first().boundingBox()
  if (!box) throw new Error(`no box for ${name}`)
  const sx = box.x + 40
  const sy = box.y + 10
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + dxScreen / 2, sy + dyScreen / 2, { steps: 8 })
  await page.mouse.move(sx + dxScreen, sy + dyScreen, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
}

test('case 1: a table on the old straight path is routed around', async ({
  page,
}) => {
  seed(BETWEEN)
  await openBoard(page, BETWEEN)
  const names = BETWEEN.tables.map((t) => t.name)
  await expectLineClearsTables(page, relId(BETWEEN, 0), [
    longName,
    'orphan_lookup_table',
  ])
  // The endpoint tables are also never entered (the line stays on their edge).
  await expectLineClearsTables(page, relId(BETWEEN, 0), names)
})

test('case 2: dragging a table onto a line re-routes it, and it survives a reload', async ({
  page,
}) => {
  seed(DRAG)
  await openBoard(page, DRAG)
  const id = relId(DRAG, 0)
  const before = await readLine(page, id)
  const b0 = await flowBox(page, longName, before.ctm)
  const a0 = await flowBox(page, 'accounts_receivable', before.ctm)
  // Move the middle table up so it spans the A-C line's height (A's port rows).
  const dyFlow = a0.y - 40 - b0.y
  await dragTable(page, longName, 0, dyFlow * before.ctm.d)
  await expectLineClearsTables(page, id, [longName])
  // The table really moved onto the old line's height.
  const after = await readLine(page, id)
  const b1 = await flowBox(page, longName, after.ctm)
  expect(b1.y).toBeLessThan(a0.y + 200)

  await page.reload()
  await expect(
    page.locator(`path.react-flow__edge-path[id="${id}"]`),
  ).toHaveCount(1)
  await page.waitForTimeout(1500)
  await expectLineClearsTables(page, id, [longName])
})

test('case 3: a blocked right side makes the line leave from the left', async ({
  page,
}) => {
  seed(BLOCKED)
  await openBoard(page, BLOCKED)
  const id = relId(BLOCKED, 0)
  const start = await readLine(page, id)
  const a = await flowBox(page, 'accounts_receivable', start.ctm)
  // Free right side: the line leaves A on its right.
  expect(start.pts[0].x).toBeGreaterThan(a.x + a.width - 1)

  // Park the middle table 20 px right of A: its padded box covers A's stub.
  const mid = await flowBox(page, longName, start.ctm)
  const dxFlow = a.x + a.width + 20 - mid.x
  await dragTable(page, longName, dxFlow * start.ctm.d, 0)

  const moved = await readLine(page, id)
  const a2 = await flowBox(page, 'accounts_receivable', moved.ctm)
  expect(moved.pts[0].x, 'line leaves from the left side of A').toBeLessThan(
    a2.x + 1,
  )
  await expectLineClearsTables(page, id, [longName, cjkName])
})

test('case 4: two lines through one gap draw at least 5 px apart', async ({
  page,
}) => {
  seed(PARALLEL)
  await openBoard(page, PARALLEL)
  const one = await readLine(page, relId(PARALLEL, 0))
  const two = await readLine(page, relId(PARALLEL, 1))
  const mid = await flowBox(page, longName, one.ctm)
  const inMid = (p: Pt) => p.x > mid.x + 4 && p.x < mid.x + mid.width - 4
  const a = one.pts.filter(inMid)
  const b = two.pts.filter(inMid)
  expect(a.length).toBeGreaterThan(20)
  expect(b.length).toBeGreaterThan(20)
  // Compare the lines column by column over the middle table's width.
  let minGap = Infinity
  for (const p of a) {
    const q = b.find((r) => Math.abs(r.x - p.x) < 0.75)
    if (q) minGap = Math.min(minGap, Math.abs(q.y - p.y))
  }
  expect(minGap).toBeGreaterThanOrEqual(5)
  await expectLineClearsTables(page, relId(PARALLEL, 0), [longName])
  await expectLineClearsTables(page, relId(PARALLEL, 1), [longName])
})

// e2e/auto-layout-quality.spec.ts
// End-to-end coverage for the Auto Layout engine rewrite: the layout that
// PERSISTS after the Auto Layout button, and after a SQL import (which runs
// the same engine on the server), must be a readable layered layout:
//   1. no two tables overlap,
//   2. the hub (fact table) sits between the leftmost and rightmost tables,
//   3. every relationship joins tables in the same or an adjacent column.
//
// CI does NOT run Playwright, so this spec is a LOCAL gate: run
// `bun run test:e2e e2e/auto-layout-quality.spec.ts` before shipping layout
// changes.
//
// Positions are read from the database after a reload (the persisted result),
// by shelling out to Bun — Playwright's runner is Node and has no bun:sqlite.
// Table widths are NULL in the database (like real tables), so the geometry
// checks use the engine's 250 px minimum width; every seeded column name is
// short enough that the real width is that minimum. Heights follow
// calculateTableHeight (40 header + 28 per column + 12 padding).
//
// The seed (e2e/seed-auto-layout-quality.ts) leaves NULL heights and a tangled
// starting grid, so a pass is the engine's work.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const TABLE_MIN_WIDTH = 250
const TABLE_COUNT = 9
const RELATIONSHIP_COUNT = 8
const HUB = 'fact_sales'

// The same snowflake as the seed: one fact table, six dimensions, two of them
// snowflaked (dim_product -> dim_category, dim_customer -> dim_geography).
// One line per table: a taller paste area pushes the dialog's Import button
// out of the 1000 px viewport.
const DDL = `CREATE TABLE fact_sales (id UUID PRIMARY KEY, customer_id UUID REFERENCES dim_customer(id), product_id UUID REFERENCES dim_product(id), date_id UUID REFERENCES dim_date(id), store_id UUID REFERENCES dim_store(id), employee_id UUID REFERENCES dim_employee(id), promo_id UUID REFERENCES dim_promo(id), amount VARCHAR(20));
CREATE TABLE dim_customer (id UUID PRIMARY KEY, full_name VARCHAR(50), geography_id UUID REFERENCES dim_geography(id));
CREATE TABLE dim_product (id UUID PRIMARY KEY, title VARCHAR(50), category_id UUID REFERENCES dim_category(id));
CREATE TABLE dim_date (id UUID PRIMARY KEY, day INT, month INT);
CREATE TABLE dim_store (id UUID PRIMARY KEY, store_name VARCHAR(50));
CREATE TABLE dim_employee (id UUID PRIMARY KEY, emp_name VARCHAR(50));
CREATE TABLE dim_promo (id UUID PRIMARY KEY, promo_name VARCHAR(50));
CREATE TABLE dim_category (id UUID PRIMARY KEY, cat_name VARCHAR(50));
CREATE TABLE dim_geography (id UUID PRIMARY KEY, country VARCHAR(50));`

interface PersistedTable {
  id: string
  name: string
  x: number
  y: number
  columnCount: number
}

interface PersistedLayout {
  tables: Array<PersistedTable>
  relationships: Array<{ source: string; target: string }>
}

interface Box {
  name: string
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
}

// Runs under Bun and prints the board's persisted layout as JSON.
const READ_LAYOUT_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db', { readonly: true })
const wb = process.env.WB_ID
const tables = db.query(
  'SELECT t.id, t.name, t.positionX AS x, t.positionY AS y, (SELECT COUNT(*) FROM "Column" c WHERE c.tableId = t.id) AS columnCount FROM "DiagramTable" t WHERE t.whiteboardId = ?',
).all(wb)
const relationships = db.query(
  'SELECT sourceTableId AS source, targetTableId AS target FROM "Relationship" WHERE whiteboardId = ?',
).all(wb)
console.log(JSON.stringify({ tables, relationships }))
`

function readPersistedLayout(whiteboardId: string): PersistedLayout {
  const out = execFileSync('bun', ['-e', READ_LAYOUT_SCRIPT], {
    env: { ...process.env, WB_ID: whiteboardId },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop() as string) as PersistedLayout
}

function toBoxes(tables: Array<PersistedTable>): Array<Box> {
  return tables.map((t) => ({
    name: t.name,
    left: t.x,
    right: t.x + TABLE_MIN_WIDTH,
    top: t.y,
    bottom: t.y + 40 + t.columnCount * 28 + 12,
    centerX: t.x + TABLE_MIN_WIDTH / 2,
  }))
}

// Columns: tables in one engine column share a left or right edge, so their
// x ranges overlap heavily; tables in different columns are separated by a
// gap. Sweep the boxes by left edge and start a new column when a box begins
// past the right edge of the current column.
function assignColumns(boxes: Array<Box>): Map<string, number> {
  const sorted = [...boxes].sort((a, b) => a.left - b.left)
  const columnOf = new Map<string, number>()
  let column = -1
  let columnRight = -Infinity
  for (const box of sorted) {
    if (box.left >= columnRight) {
      column++
      columnRight = box.right
    } else {
      columnRight = Math.max(columnRight, box.right)
    }
    columnOf.set(box.name, column)
  }
  return columnOf
}

function assertLayoutQuality(layout: PersistedLayout) {
  expect(layout.tables).toHaveLength(TABLE_COUNT)
  expect(layout.relationships).toHaveLength(RELATIONSHIP_COUNT)
  const boxes = toBoxes(layout.tables)

  // 1. No overlap.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap =
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false)
    }
  }

  // 2. Hub centred: strictly between the outermost table centres.
  const hub = boxes.find((b) => b.name === HUB)
  expect(hub, 'hub table persisted').toBeDefined()
  const centres = boxes.map((b) => b.centerX)
  expect(hub!.centerX).toBeGreaterThan(Math.min(...centres))
  expect(hub!.centerX).toBeLessThan(Math.max(...centres))

  // 3. Every relationship spans at most one column step.
  const columnOf = assignColumns(boxes)
  const nameById = new Map(layout.tables.map((t) => [t.id, t.name]))
  for (const rel of layout.relationships) {
    const source = nameById.get(rel.source) as string
    const target = nameById.get(rel.target) as string
    const step = Math.abs(
      (columnOf.get(source) as number) - (columnOf.get(target) as number),
    )
    expect(
      step,
      `${source} -> ${target} spans ${step} columns`,
    ).toBeLessThanOrEqual(1)
  }
}

async function openBoard(page: Page, whiteboardId: string, title: string) {
  await page.goto(`/whiteboard/${whiteboardId}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-auto-layout-quality.ts'], {
    stdio: 'inherit',
  })
})

test.describe('Auto Layout quality', () => {
  test('Auto Layout button persists a non-overlapping, hub-centred, adjacent-column layout', async ({
    page,
  }) => {
    await openBoard(
      page,
      IDS.autoLayoutQualityWhiteboard,
      'E2E Auto-Layout Quality',
    )
    await expect(tableNode(page, HUB).first()).toBeVisible()

    // The tangled seed grid must not already satisfy the assertions.
    expect(() =>
      assertLayoutQuality(readPersistedLayout(IDS.autoLayoutQualityWhiteboard)),
    ).toThrow()

    await page.getByRole('button', { name: 'Auto Layout' }).click()
    await expect(
      page.getByText(`Layout applied to ${TABLE_COUNT} tables`),
    ).toBeVisible()

    // Persistence is the contract: reload, then read what the server stored.
    await page.reload()
    await expect(tableNode(page, HUB).first()).toBeVisible()
    assertLayoutQuality(readPersistedLayout(IDS.autoLayoutQualityWhiteboard))
  })

  test('SQL import of the snowflake DDL persists a non-overlapping, hub-centred, adjacent-column layout', async ({
    page,
  }) => {
    await openBoard(
      page,
      IDS.autoLayoutQualityImportWhiteboard,
      'E2E Auto-Layout Quality Import',
    )

    await page.getByRole('button', { name: 'Import SQL' }).click()
    await expect(
      page.getByRole('heading', { name: 'Import SQL' }),
    ).toBeVisible()
    await page.locator('#import-sql-text').fill(DDL)
    await expect(
      page.getByText(new RegExp(`${TABLE_COUNT} tables,\\s*\\d+ columns`)),
    ).toBeVisible()
    await expect(
      page.getByText(new RegExp(`${RELATIONSHIP_COUNT} relationships\\b`)),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(tableNode(page, HUB).first()).toBeVisible()

    await page.reload()
    await expect(tableNode(page, HUB).first()).toBeVisible()
    assertLayoutQuality(
      readPersistedLayout(IDS.autoLayoutQualityImportWhiteboard),
    )
  })
})

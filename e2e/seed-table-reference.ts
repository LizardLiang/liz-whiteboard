// e2e/seed-table-reference.ts
// Seed for the cross-file reference suite (LizMeter #83). Run under BUN
// (needs bun:sqlite): `bun run e2e/seed-table-reference.ts`.
//
// Owns TWO boards in the shared e2e project, because the whole feature is about
// pointing from one file at another: `trLocal` is where the reference node goes,
// `trSource` owns the table it points at. Idempotent — deletes and recreates
// both boards, so a suite that creates a reference and never removes it still
// starts clean on the next run.
//
// Depends on e2e/seed.ts having created the user and project first.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

// Deleting the boards cascades their tables, columns, relationships — and any
// reference node a previous run left behind, since a reference IS a table row.
for (const id of [IDS.trLocalWhiteboard, IDS.trSourceWhiteboard]) {
  db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(id)
}

function board(id: string, name: string) {
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, name, IDS.project, null, null, null, now, now)
}

function table(
  id: string,
  whiteboardId: string,
  name: string,
  x: number,
  y: number,
) {
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(id, whiteboardId, name, null, x, y, 240, 160, now, now)
}

function col(
  id: string,
  tableId: string,
  name: string,
  dataType: string,
  pk: number,
  order: number,
) {
  db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, tableId, name, dataType, pk, 0, 0, pk ? 0 : 1, order, now, now)
}

board(IDS.trLocalWhiteboard, 'E2E Ref Local')
board(IDS.trSourceWhiteboard, 'E2E Ref Billing')

table(IDS.trInvoicesTable, IDS.trLocalWhiteboard, 'invoices', 140, 140)
col(IDS.trInvoicesId, IDS.trInvoicesTable, 'id', 'UUID', 1, 0)

table(IDS.trOrdersTable, IDS.trSourceWhiteboard, 'orders', 200, 200)
col(IDS.trOrdersId, IDS.trOrdersTable, 'id', 'UUID', 1, 0)
col(IDS.trOrdersCustomerId, IDS.trOrdersTable, 'customer_id', 'UUID', 0, 1)

console.log(
  `[e2e seed] table references ok — local ${IDS.trLocalWhiteboard}, source ${IDS.trSourceWhiteboard}`,
)

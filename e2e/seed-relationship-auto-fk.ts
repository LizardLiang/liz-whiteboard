// e2e/seed-relationship-auto-fk.ts
// Seed for relationship-auto-fk.spec.ts. Run under BUN (needs bun:sqlite):
// `bun run e2e/seed-relationship-auto-fk.ts`.
//
// Resets ONE dedicated whiteboard (IDS.autoFkWhiteboard): three tables with
// realistic column lists, NO relationship and NO column flagged FK, so every
// FK badge the spec sees was set by the app. Does not touch "User" or
// "Project" (see seed-relationship.ts for why).
import './busy-report'
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.autoFkWhiteboard)
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.autoFkWhiteboard,
  'E2E Auto FK',
  IDS.project,
  null,
  null,
  null,
  now,
  now,
)

const table = (id: string, name: string, x: number, y: number) =>
  db
    .query(
      'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, IDS.autoFkWhiteboard, name, null, x, y, 240, 260, now, now)

// Source table on the left, target tables on the right, well separated.
table(IDS.autoFkOrdersTable, 'orders', 120, 160)
table(IDS.autoFkCustomersTable, 'customers', 760, 100)
table(IDS.autoFkSegmentsTable, 'segments', 760, 520)

const col = (
  id: string | null,
  tableId: string,
  name: string,
  type: string,
  pk: number,
  ord: number,
) =>
  db
    .query(
      'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id ?? crypto.randomUUID(),
      tableId,
      name,
      type,
      pk,
      0,
      0,
      pk ? 0 : 1,
      ord,
      now,
      now,
    )

const O = IDS.autoFkOrdersTable
col(IDS.autoFkOrdersId, O, 'id', 'UUID', 1, 0)
col(IDS.autoFkOrdersCustomerId, O, 'customer_id', 'UUID', 0, 1)
col(null, O, 'status', 'VARCHAR', 0, 2)
col(null, O, 'total', 'DECIMAL', 0, 3)
col(null, O, 'currency', 'VARCHAR', 0, 4)
col(null, O, 'placed_at', 'TIMESTAMP', 0, 5)
col(null, O, 'notes', 'TEXT', 0, 6)

const C = IDS.autoFkCustomersTable
col(IDS.autoFkCustomersId, C, 'id', 'UUID', 1, 0)
col(null, C, 'email', 'VARCHAR', 0, 1)
col(null, C, 'display_name', 'VARCHAR', 0, 2)
col(null, C, 'phone', 'VARCHAR', 0, 3)
col(null, C, 'created_at', 'TIMESTAMP', 0, 4)
col(null, C, 'marketing_opt_in', 'BOOLEAN', 0, 5)

const S = IDS.autoFkSegmentsTable
col(IDS.autoFkSegmentsId, S, 'id', 'UUID', 1, 0)
col(null, S, 'name', 'VARCHAR', 0, 1)
col(null, S, 'rule', 'TEXT', 0, 2)
col(null, S, 'created_at', 'TIMESTAMP', 0, 3)

console.log(
  `[e2e seed-relationship-auto-fk] ok — whiteboard ${IDS.autoFkWhiteboard}`,
)

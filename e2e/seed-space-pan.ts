// e2e/seed-space-pan.ts
// Deterministic seed for the space-to-pan suite (e2e/space-pan.spec.ts).
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-space-pan.ts`.
//
// Why its own script, and why it re-runs before EVERY test: the suite's
// control case drags a table with space UP, which moves and persists it. That
// control is what makes the modifier assertions mean something — without it,
// "the table did not move" would also pass on a board where nothing can be
// dragged at all. Resetting the board first keeps the moved position out of
// the next test and out of every other spec.
//
// It resets ONLY this board — it never touches IDS.user or IDS.project, so it
// is safe to run mid-suite: deleting the User row (as e2e/seed.ts does) would
// invalidate the storageState session global-setup.ts logged in with.
// e2e/seed.ts must have run first, since the board hangs off IDS.project.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
// SQLite defaults foreign_keys OFF per-connection; enable so the whiteboard
// DELETE below cascades to its tables/columns like the app's own connection
// (src/db.ts) does.
db.exec('PRAGMA foreign_keys = ON')
// This script re-seeds once per test, so it races the live dev server's own
// WAL writer more often than a once-per-run seed. busy_timeout makes SQLite
// retry internally instead of throwing SQLITE_BUSY.
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.spWhiteboard)

db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.spWhiteboard,
  'E2E Space Pan',
  IDS.project,
  null,
  null,
  null,
  now,
  now,
)

function table(id: string, name: string, positionX: number, positionY: number) {
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    IDS.spWhiteboard,
    name,
    null,
    positionX,
    positionY,
    240,
    160,
    now,
    now,
  )
}

function col(id: string, tableId: string, name: string) {
  db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, tableId, name, 'UUID', 1, 0, 0, 0, 0, now, now)
}

// GEOMETRY — two tables, far enough apart that `fitView` leaves plenty of
// empty pane between them. The suite needs both an ON-NODE press (the case
// that used to drag the table) and an EMPTY-PANE press, and it locates the
// empty one by measuring the gap rather than guessing a screen point.
table(IDS.spUsersTable, 'users', 120, 140)
table(IDS.spOrdersTable, 'orders', 900, 140)
col(IDS.spUsersId, IDS.spUsersTable, 'id')
col(IDS.spOrdersId, IDS.spOrdersTable, 'id')

console.log(`[e2e seed-space-pan] ok — whiteboard ${IDS.spWhiteboard}`)

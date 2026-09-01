// e2e/seed-area-draw.ts
// Deterministic seed for the draw-an-area-around-tables suite (todo #55).
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-area-draw.ts`.
//
// Why its own script, and why it re-runs before EVERY test: that suite CREATES
// areas and never restores them, so a second run against a board left dirty by
// the first would start with a stale area already enclosing the tables — the
// exact state its assertions are trying to distinguish from. Resetting the
// board first is what makes the suite re-runnable. Same rationale (and same
// shape) as e2e/seed-canvas.ts.
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
// DELETE below cascades to its tables/columns/areas like the app's own
// connection (src/db.ts) does.
db.exec('PRAGMA foreign_keys = ON')
// This script re-seeds once per test, so it races the live dev server's own
// WAL writer more often than a once-per-run seed. busy_timeout makes SQLite
// retry internally instead of throwing SQLITE_BUSY.
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.adWhiteboard)

db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.adWhiteboard,
  'E2E Area Draw',
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
    IDS.adWhiteboard,
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

// GEOMETRY — the whole point of this fixture. `accounts` and `invoices` sit
// side by side near the origin so ONE drawn rectangle can enclose both, while
// `audit` sits far to the right so the same rectangle provably leaves it out.
// A drawn area that swallowed everything on the board would pass a
// "did they get grouped?" assertion for the wrong reason; `audit` is the
// control that makes the assertion mean something.
table(IDS.adAccountsTable, 'accounts', 120, 140)
table(IDS.adInvoicesTable, 'invoices', 420, 140)
table(IDS.adAuditTable, 'audit', 1400, 140)
col(IDS.adAccountsId, IDS.adAccountsTable, 'id')
col(IDS.adInvoicesId, IDS.adInvoicesTable, 'id')
col(IDS.adAuditId, IDS.adAuditTable, 'id')

console.log(`[e2e seed-area-draw] ok — whiteboard ${IDS.adWhiteboard}`)

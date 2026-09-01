// e2e/seed-handle-visibility.ts
// Seed for canvas-handle-visibility.spec.ts. Run under BUN (needs
// bun:sqlite): `bun run e2e/seed-handle-visibility.ts`.
//
// Resets ONE dedicated whiteboard (IDS.handleVisWhiteboard) holding two
// tables and NO relationship between them — the spec creates one live via a
// real drag-to-connect gesture, so this board must start clean or the
// "relationship created" assertion would pass trivially. Deliberately does
// NOT touch "User" or "Project" the way e2e/seed.ts does: deleting the e2e
// user cascades to "Session", which would invalidate the storageState
// cookie every spec is authenticated with (same rationale as
// seed-relationship.ts).
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
// Cascade child rows on the whiteboard delete below, like src/db.ts does.
db.exec('PRAGMA foreign_keys = ON')
// The live dev server holds its own WAL writer against this same file, so a
// concurrent seed run hits SQLITE_BUSY without this (seed.ts documents the
// identical failure).
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

// Wipe and recreate the board — cascades to DiagramTable / Column /
// Relationship, so a prior run's created relationship never leaks into this
// one.
db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.handleVisWhiteboard)

db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.handleVisWhiteboard,
  'E2E Handle Visibility',
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
    .run(id, IDS.handleVisWhiteboard, name, null, x, y, 240, 160, now, now)

// Well separated horizontally and vertically-aligned so the drag from
// `users`'s right-side handle to `orders`'s left-side handle is a short,
// unambiguous horizontal gesture — and so `users`'s LEFT edge (the pixel
// probe target for the visibility check) has open canvas to its left with
// nothing else painted there.
table(IDS.handleVisUsersTable, 'users', 200, 200)
table(IDS.handleVisOrdersTable, 'orders', 700, 200)

const col = (
  cid: string,
  tid: string,
  name: string,
  type: string,
  pk: number,
  fk: number,
  ord: number,
) =>
  db
    .query(
      'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(cid, tid, name, type, pk, fk, 0, 0, ord, now, now)

col(IDS.handleVisUsersId, IDS.handleVisUsersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.handleVisOrdersUserId, IDS.handleVisOrdersTable, 'user_id', 'UUID', 0, 1, 0)

// No Relationship row — the spec creates one live via drag-to-connect.

console.log(
  `[e2e seed-handle-visibility] ok — whiteboard ${IDS.handleVisWhiteboard}`,
)

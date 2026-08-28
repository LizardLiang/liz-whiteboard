// e2e/seed-relationship.ts
// Seed for relationship-deletion.spec.ts. Run under BUN (needs bun:sqlite):
// `bun run e2e/seed-relationship.ts`.
//
// Resets ONE dedicated whiteboard (IDS.relDelWhiteboard) holding two tables
// and one relationship between them. Deliberately does NOT touch "User" or
// "Project" the way e2e/seed.ts does: deleting the e2e user cascades to
// "Session", which would invalidate the storageState cookie every spec is
// authenticated with — fatal for a script that has to run in `beforeEach`.
// Each test in that spec deletes the relationship, so it must be restored
// before the next one rather than once per suite.
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
// Relationship, so a prior run's mutated positions never leak into this one.
db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.relDelWhiteboard)

db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.relDelWhiteboard,
  'E2E Relation Delete',
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
    .run(id, IDS.relDelWhiteboard, name, null, x, y, 240, 160, now, now)

// Well separated so the relationship edge has a long, easily-clickable span
// between the two nodes, and so the drag in the spec cannot land `orders` on
// top of `users`.
table(IDS.relDelUsersTable, 'users', 120, 120)
table(IDS.relDelOrdersTable, 'orders', 620, 420)

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

col(IDS.relDelUsersId, IDS.relDelUsersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.relDelOrdersId, IDS.relDelOrdersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.relDelOrdersUserId, IDS.relDelOrdersTable, 'user_id', 'UUID', 0, 1, 1)

db.query(
  'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.relDelRelationship,
  IDS.relDelWhiteboard,
  IDS.relDelOrdersTable,
  IDS.relDelUsersTable,
  IDS.relDelOrdersUserId,
  IDS.relDelUsersId,
  'MANY_TO_ONE',
  'belongs to',
  null,
  now,
  now,
)

console.log(`[e2e seed-relationship] ok — whiteboard ${IDS.relDelWhiteboard}`)

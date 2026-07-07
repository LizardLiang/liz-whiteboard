// e2e/seed.ts
// Deterministic seed for the version-history Playwright suite. Run under BUN
// (needs bun:sqlite): `bun run e2e/seed.ts`. Idempotent — wipes and recreates
// the e2e user + its project/whiteboard so every run starts from a known
// 2-table diagram (users + orders + a relationship + an area).
//
// Password hashing is replicated inline from src/lib/auth/password.ts
// (SHA-256 pre-hash → bcrypt cost 12) rather than imported, to keep this
// script free of app path-alias resolution.
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import { E2E_USER, IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

const db = new Database(DB_PATH)
// SQLite defaults foreign_keys OFF per-connection; enable so the cleanup
// DELETEs below cascade to ProjectMember / Whiteboard / tables like the app's
// own connection (src/db.ts) does.
db.exec('PRAGMA foreign_keys = ON')
const now = Date.now()

// Wipe any prior e2e user (cascades project → whiteboard → tables/…)
const prior = db
  .query('SELECT id FROM "User" WHERE username = ?')
  .get(E2E_USER.username) as { id: string } | null
if (prior) {
  db.query('DELETE FROM "Project" WHERE ownerId = ?').run(prior.id)
  db.query('DELETE FROM "User" WHERE id = ?').run(prior.id)
}
// Also clear any leftover rows on the fixed ids (defensive; explicit child
// deletes in case a prior run left rows behind with foreign_keys OFF).
db.query('DELETE FROM "ProjectMember" WHERE projectId = ? OR userId = ?').run(
  IDS.project,
  IDS.user,
)
db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.project)
db.query('DELETE FROM "User" WHERE id = ?').run(IDS.user)

db.query(
  'INSERT INTO "User" (id, username, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(
  IDS.user,
  E2E_USER.username,
  E2E_USER.email,
  await hashPassword(E2E_USER.password),
  now,
  now,
)

db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(IDS.project, 'E2E Project', 'version-history e2e', now, now, IDS.user)

db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.project, IDS.user, 'ADMIN', now, now)

db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(IDS.whiteboard, 'E2E ERD', IDS.project, null, null, null, now, now)

db.query(
  'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.usersTable,
  IDS.whiteboard,
  'users',
  'app users',
  120,
  120,
  240,
  160,
  now,
  now,
)
db.query(
  'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.ordersTable,
  IDS.whiteboard,
  'orders',
  'customer orders',
  520,
  320,
  240,
  160,
  now,
  now,
)

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
col(IDS.usersId, IDS.usersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.usersEmail, IDS.usersTable, 'email', 'VARCHAR', 0, 0, 1)
col(IDS.ordersId, IDS.ordersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.ordersUserId, IDS.ordersTable, 'user_id', 'UUID', 0, 1, 1)

db.query(
  'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.relationship,
  IDS.whiteboard,
  IDS.ordersTable,
  IDS.usersTable,
  IDS.ordersUserId,
  IDS.usersId,
  'MANY_TO_ONE',
  'belongs to',
  null,
  now,
  now,
)

db.query(
  'INSERT INTO "Area" (id, whiteboardId, name, color, positionX, positionY, width, height, memberTableIds, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.area,
  IDS.whiteboard,
  'Identity',
  '#8b5cf6',
  80,
  80,
  320,
  240,
  JSON.stringify([IDS.usersTable]),
  now,
  now,
)

// Remove any snapshots from a prior run so the list starts empty.
db.query('DELETE FROM "WhiteboardSnapshot" WHERE whiteboardId = ?').run(
  IDS.whiteboard,
)

// Remove any comments from a prior run (canvas-comments e2e, GH #110) so
// every run starts with an empty thread list. Defensive — the Project
// cascade-delete above already removes these via Comment's FK to
// Whiteboard, but the "leftover rows on the fixed ids" clause further up
// re-inserts the SAME whiteboard id without going through that cascade.
db.query('DELETE FROM "Comment" WHERE whiteboardId = ?').run(IDS.whiteboard)

console.log(`[e2e seed] ok — whiteboard ${IDS.whiteboard}`)

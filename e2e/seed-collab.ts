// e2e/seed-collab.ts
// ADDITIVE seed for a 3-user co-editing dogfood session. Run under BUN:
//   bun run e2e/seed-collab.ts
// Creates 3 users (alice/bob/carol) who all share ONE whiteboard with edit
// rights (alice OWNER, bob+carol EDITOR), plus a small 2-table diagram to
// edit. Idempotent: removes ONLY its own fixed IDs first, so your existing
// data/app.db content is left untouched.
//
// Password hashing replicated inline from src/lib/auth/password.ts
// (SHA-256 pre-hash → bcrypt cost 12).
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import {
  COLLAB_PASSWORD,
  COLLAB_USERS,
  COLLAB_ID as ID,
} from './seed-collab-constants'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
const now = Date.now()

// --- Clean up ONLY our own fixed rows (cascades to whiteboard/tables/…) ---
db.query('DELETE FROM "Project" WHERE id = ?').run(ID.project)
for (const u of COLLAB_USERS) {
  db.query('DELETE FROM "User" WHERE id = ?').run(u.id)
}

// --- Users ---
for (const u of COLLAB_USERS) {
  db.query(
    'INSERT INTO "User" (id, username, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(u.id, u.username, u.email, await hashPassword(COLLAB_PASSWORD), now, now)
}

// --- Project (owned by alice) ---
db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(ID.project, 'Co-Editing Dogfood', '3-user real-time test', now, now, ID.alice)

// --- Members: alice OWNER, bob + carol EDITOR (all can edit) ---
for (const u of COLLAB_USERS) {
  db.query(
    'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), ID.project, u.id, u.role, now, now)
}

// --- Shared whiteboard ---
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(ID.whiteboard, 'Team ERD', ID.project, null, null, null, now, now)

// --- Two tables to edit ---
const table = db.query(
  'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
)
table.run(ID.usersTable, ID.whiteboard, 'users', 'app users', 160, 160, 240, 160, now, now)
table.run(ID.ordersTable, ID.whiteboard, 'orders', 'customer orders', 560, 360, 240, 160, now, now)

const col = (
  id: string,
  tableId: string,
  name: string,
  dataType: string,
  pk: number,
  fk: number,
  order: number,
) =>
  db
    .query(
      'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, tableId, name, dataType, pk, fk, 0, fk ? 1 : 0, order, now, now)

col(ID.usersId, ID.usersTable, 'id', 'UUID', 1, 0, 0)
col(ID.usersEmail, ID.usersTable, 'email', 'VARCHAR', 0, 0, 1)
col(ID.ordersId, ID.ordersTable, 'id', 'UUID', 1, 0, 0)
col(ID.ordersUserId, ID.ordersTable, 'user_id', 'UUID', 0, 1, 1)

// --- Second board: one area (3 members, all inside it) + 2 ungrouped tables ---
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(ID.areaWhiteboard, 'Area ERD', ID.project, null, null, null, now, now)

const areaTables: Array<[string, string, number, number]> = [
  [ID.areaMember1, 'a_orders', 140, 170],
  [ID.areaMember2, 'a_items', 400, 400],
  [ID.areaMember3, 'a_refunds', 140, 420],
  [ID.areaFree1, 'a_customers', 820, 120],
  [ID.areaFree2, 'a_audit', 820, 360],
]
const pkIds = new Map<string, string>()
const fkIds = new Map<string, string>()
for (const [id, name, x, y] of areaTables) {
  table.run(id, ID.areaWhiteboard, name, null, x, y, null, null, now, now)
  const pk = crypto.randomUUID()
  const fk = crypto.randomUUID()
  pkIds.set(id, pk)
  fkIds.set(id, fk)
  col(pk, id, 'id', 'UUID', 1, 0, 0)
  col(fk, id, 'ref_id', 'UUID', 0, 1, 1)
}
const rel = (source: string, target: string) =>
  db
    .query(
      'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      crypto.randomUUID(),
      ID.areaWhiteboard,
      source,
      target,
      fkIds.get(source),
      pkIds.get(target),
      'MANY_TO_ONE',
      null,
      null,
      now,
      now,
    )
rel(ID.areaMember2, ID.areaMember1)
rel(ID.areaMember3, ID.areaFree2)
db.query(
  'INSERT INTO "Area" (id, whiteboardId, name, color, positionX, positionY, width, height, memberTableIds, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  ID.area,
  ID.areaWhiteboard,
  'Billing',
  '#8b5cf6',
  100,
  100,
  620,
  520,
  JSON.stringify([ID.areaMember1, ID.areaMember2, ID.areaMember3]),
  now,
  now,
)

// --- Canvas board with one 2 x 3 table (e2e/canvas-table-coedit.spec.ts) ---
db.query(
  'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(ID.canvasBoard, 'Team Canvas', ID.project, null, now, now)
const coeditRows = [
  { id: 'row-1', height: 40 },
  { id: 'row-2', height: 40 },
]
const coeditCols = [
  { id: 'col-1', width: 120 },
  { id: 'col-2', width: 120 },
  { id: 'col-3', width: 120 },
]
db.query(
  'INSERT INTO "CanvasElement" (id, boardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
).run(
  ID.coeditTable,
  ID.canvasBoard,
  'table',
  200,
  200,
  360,
  80,
  0,
  1,
  null,
  JSON.stringify({
    fill: 'none',
    stroke: '#94a3b8',
    strokeWidth: 1,
    fontSize: 14,
    color: '#0f172a',
  }),
  JSON.stringify({
    kind: 'table',
    table: { rows: coeditRows, cols: coeditCols, cells: {}, headerRow: false },
  }),
  now,
  now,
)

db.close()

console.log(
  `[seed-collab] ok — whiteboard ${ID.whiteboard}; users: ${COLLAB_USERS.map((u) => `${u.email}(${u.role})`).join(', ')}; password ${COLLAB_PASSWORD}`,
)

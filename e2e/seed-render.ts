// e2e/seed-render.ts
// Deterministic seed for e2e/board-render.spec.ts (MCP board images). Run under
// BUN (needs bun:sqlite): `bun run e2e/seed-render.ts`. Idempotent: wipes and
// recreates a DEDICATED project (IDS.renderProject) holding one ER whiteboard
// and one canvas board. Reuses IDS.user (seeded by e2e/seed.ts) as ADMIN.
//
// Both boards carry Chinese labels and one element far from the rest, so the
// spec can assert CJK text paints and that the tile grid spans several tiles.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.renderProject)

db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(
  IDS.renderProject,
  'E2E Render Project',
  'board-render e2e',
  now,
  now,
  IDS.user,
)
db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.renderProject, IDS.user, 'ADMIN', now, now)

// ── ER whiteboard ───────────────────────────────────────────────────────────
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.renderWhiteboard,
  'E2E 渲染',
  IDS.renderProject,
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
    .run(id, IDS.renderWhiteboard, name, null, x, y, 240, 160, now, now)
const col = (
  id: string,
  tableId: string,
  name: string,
  type: string,
  pk: number,
  fk: number,
  order: number,
) =>
  db
    .query(
      'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, tableId, name, type, pk, fk, 0, 0, order, now, now)

table(IDS.renderUsersTable, '用户表', 0, 0)
table(IDS.renderOrdersTable, '订单', 420, 80)
table(IDS.renderFarTable, 'far_away', 4400, 3000)
col(IDS.renderUsersId, IDS.renderUsersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.renderUsersName, IDS.renderUsersTable, '姓名', 'VARCHAR', 0, 0, 1)
col(IDS.renderOrdersId, IDS.renderOrdersTable, 'id', 'UUID', 1, 0, 0)
col(IDS.renderOrdersUserId, IDS.renderOrdersTable, 'user_id', 'UUID', 0, 1, 1)
col(IDS.renderFarId, IDS.renderFarTable, 'id', 'UUID', 1, 0, 0)

db.query(
  'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.renderRelationship,
  IDS.renderWhiteboard,
  IDS.renderOrdersTable,
  IDS.renderUsersTable,
  IDS.renderOrdersUserId,
  IDS.renderUsersId,
  'MANY_TO_ONE',
  null,
  null,
  now,
  now,
)

// ── Canvas board ────────────────────────────────────────────────────────────
db.query(
  'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(IDS.renderCanvasBoard, 'E2E 画布', IDS.renderProject, null, now, now)

const element = (
  id: string,
  kind: 'rectangle' | 'text',
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  zIndex: number,
) =>
  db
    .query(
      'INSERT INTO "CanvasElement" (id, boardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      IDS.renderCanvasBoard,
      kind,
      x,
      y,
      w,
      h,
      0,
      zIndex,
      text,
      JSON.stringify({
        fill: 'rgba(59, 130, 246, 0.10)',
        stroke: '#3b82f6',
        strokeWidth: 2,
        fontSize: 20,
        color: '#0f172a',
      }),
      JSON.stringify({ kind }),
      now,
      now,
    )

element(IDS.renderCanvasRect, 'rectangle', 100, 100, 320, 180, '画布矩形', 0)
element(IDS.renderCanvasText, 'text', 140, 340, 260, 40, '你好，世界', 1)
element(IDS.renderCanvasFar, 'rectangle', 4400, 3000, 320, 180, 'far canvas', 2)

console.log(`[e2e seed-render] ok - whiteboard ${IDS.renderWhiteboard}`)

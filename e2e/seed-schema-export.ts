// e2e/seed-schema-export.ts
// Deterministic seed for e2e/schema-export.spec.ts. Run under BUN:
// `bun run e2e/seed-schema-export.ts`. Idempotent — wipes and recreates a
// dedicated project (IDS.schemaExpProject) owned by IDS.user, with:
//   - "Schema Export ERD": customers + orders, one MANY_TO_ONE relationship.
//     The customers description holds XML/HTML special characters and the
//     email column a Chinese description, so the spec can check escaping
//     and Unicode in every format.
//   - "Schema Export Empty": no tables (the export item must be disabled).
import './busy-report'
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.schemaExpProject)
db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(
  IDS.schemaExpProject,
  'Schema Export Project',
  'schema export e2e',
  now,
  now,
  IDS.user,
)
db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.schemaExpProject, IDS.user, 'ADMIN', now, now)

function whiteboard(id: string, name: string) {
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, name, IDS.schemaExpProject, null, null, null, now, now)
}

function table(
  id: string,
  name: string,
  description: string | null,
  x: number,
) {
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(id, IDS.schemaExpBoard, name, description, x, 160, null, null, now, now)
}

function column(
  id: string,
  tableId: string,
  name: string,
  dataType: string,
  order: number,
  flags: { pk?: boolean; fk?: boolean; unique?: boolean; nullable?: boolean },
  description: string | null = null,
) {
  db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, description, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    tableId,
    name,
    dataType,
    flags.pk ? 1 : 0,
    flags.fk ? 1 : 0,
    flags.unique ? 1 : 0,
    flags.nullable ? 1 : 0,
    description,
    order,
    now,
    now,
  )
}

whiteboard(IDS.schemaExpBoard, 'Schema Export ERD')
whiteboard(IDS.schemaExpEmptyBoard, 'Schema Export Empty')

table(IDS.schemaExpCustomers, 'customers', 'VIP & <gold> "tier"', 120)
table(IDS.schemaExpOrders, 'orders', null, 560)

column(IDS.schemaExpCustomersId, IDS.schemaExpCustomers, 'id', 'uuid', 0, {
  pk: true,
})
column(
  IDS.schemaExpCustomersEmail,
  IDS.schemaExpCustomers,
  'email',
  'varchar',
  1,
  { unique: true, nullable: true },
  '登入用電子郵件',
)
column(IDS.schemaExpOrdersId, IDS.schemaExpOrders, 'id', 'uuid', 0, {
  pk: true,
})
column(
  IDS.schemaExpOrdersCustomerId,
  IDS.schemaExpOrders,
  'customer_id',
  'uuid',
  1,
  { fk: true },
)

db.query(
  'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.schemaExpRelationship,
  IDS.schemaExpBoard,
  IDS.schemaExpOrders,
  IDS.schemaExpCustomers,
  IDS.schemaExpOrdersCustomerId,
  IDS.schemaExpCustomersId,
  'MANY_TO_ONE',
  'placed by',
  null,
  now,
  now,
)

db.close()
console.log(`[e2e seed] schema export ok — whiteboard ${IDS.schemaExpBoard}`)

// e2e/seed-changelog.ts
// Seed for e2e/schema-changelog.spec.ts (and for looking at the Changes tab by
// hand). Three boards, all in the shared e2e project (see changelog-constants):
//   history - 16 tables plus a long, deterministic change history: single
//             edits by two people, an AI-agent edit, a layout move, an SQL
//             import batch, a restore batch, a table-delete batch, and 60
//             older single edits so the list pages.
//   live    - the same 16 tables with relationships and no history; the spec
//             edits it through the UI.
//   empty   - no tables, no history.
// Idempotent: each run deletes its own boards (cascade) and recreates them.
//
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-changelog.ts`
import './busy-report'
import { Database } from 'bun:sqlite'
import { CL_IDS, SEED_TABLES, dayAt } from './changelog-constants'
import { E2E_USER, IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname
const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

let seq = 0
const id = (prefix: string) =>
  `${prefix}000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

for (const wb of Object.values(CL_IDS))
  db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(wb)

const boards: Array<[string, string]> = [
  [CL_IDS.history, 'E2E Changelog History'],
  [CL_IDS.live, 'E2E Changelog Live'],
  [CL_IDS.empty, 'E2E Changelog Empty'],
]
for (const [wb, name] of boards) {
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(wb, name, IDS.project, null, null, null, now, now)
}

interface Placed {
  tableId: string
  columnIds: Map<string, string>
}

/** Insert the 16 tables of a board on a 4 x 4 grid. */
function seedTables(whiteboardId: string): Map<string, Placed> {
  const placed = new Map<string, Placed>()
  SEED_TABLES.forEach((table, index) => {
    const tableId = id('e2')
    db.query(
      'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      tableId,
      whiteboardId,
      table.name,
      null,
      80 + (index % 4) * 560,
      80 + Math.floor(index / 4) * 360,
      null,
      null,
      now,
      now,
    )
    const columnIds = new Map<string, string>()
    table.columns.forEach((column, order) => {
      const columnId = id('e3')
      columnIds.set(column.name, columnId)
      db.query(
        'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, description, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        columnId,
        tableId,
        column.name,
        column.type,
        column.pk ? 1 : 0,
        column.fk ? 1 : 0,
        0,
        column.nullable ? 1 : 0,
        null,
        order,
        now,
        now,
      )
    })
    placed.set(table.name, { tableId, columnIds })
  })
  return placed
}

const live = seedTables(CL_IDS.live)
const history = seedTables(CL_IDS.history)

// Relationships on the live board, so a table delete cascades to some.
const link = (from: string, fromCol: string, to: string) => {
  const source = live.get(from)!
  const target = live.get(to)!
  db.query(
    'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id('e4'),
    CL_IDS.live,
    source.tableId,
    target.tableId,
    source.columnIds.get(fromCol)!,
    target.columnIds.get('id')!,
    'MANY_TO_ONE',
    null,
    null,
    now,
    now,
  )
}
link('orders', 'account_id', 'accounts')
link('order_items', 'order_id', 'orders')
link('order_items', 'product_id', 'products')
link('shipments', 'order_id', 'orders')
link('payments', 'order_id', 'orders')
link('invoices', 'payment_id', 'payments')
link('notifications', 'account_id', 'accounts')

// ── Change history of the `history` board ───────────────────────────────────
// A second person: the VIEWER member when it exists (seed-stress creates it),
// else no user row, which stores a null actor id.
const peer = db
  .query('SELECT id FROM "User" WHERE id = ?')
  .get(IDS.viewerUser) as { id: string } | null
const PEER = { id: peer?.id ?? null, name: 'e2e_viewer' }
const ME = { id: IDS.user, name: E2E_USER.username }

interface EventSeed {
  at: number
  actor: { id: string | null; name: string }
  agent?: boolean
  category?: 'schema' | 'layout'
  entityType: string
  action: string
  entityName: string | null
  tableName?: string | null
  before?: unknown
  after?: unknown
  batchId?: string
  batchKind?: string
}

const insertEvent = db.query(
  'INSERT INTO "SchemaChangeEvent" ("id","whiteboardId","batchId","batchKind","actorUserId","actorName","viaAgent","category","entityType","action","entityId","entityName","tableId","tableName","before","after","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
)
let tick = 0
function event(e: EventSeed) {
  const placed = e.tableName ? history.get(e.tableName) : undefined
  insertEvent.run(
    id('e5'),
    CL_IDS.history,
    e.batchId ?? null,
    e.batchKind ?? null,
    e.actor.id,
    e.actor.name,
    e.agent ? 1 : 0,
    e.category ?? 'schema',
    e.entityType,
    e.action,
    id('e6'),
    e.entityName,
    placed?.tableId ?? null,
    e.tableName ?? null,
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    // One extra millisecond per row keeps the order of events in one batch.
    e.at + ++tick,
  )
}

// 60 older single edits, so the list needs a second page.
for (let i = 0; i < 60; i++) {
  event({
    at: dayAt(12 + Math.floor(i / 6), 9) + i * 60_000,
    actor: ME,
    entityType: 'column',
    action: 'update',
    entityName: `noise_${String(i).padStart(2, '0')}`,
    tableName: 'audit_log',
    before: { description: `old ${i}` },
    after: { description: `new ${i}` },
  })
}

event({
  at: dayAt(10),
  actor: ME,
  entityType: 'table',
  action: 'create',
  entityName: '使用者帳號資料表',
  tableName: '使用者帳號資料表',
  after: { name: '使用者帳號資料表', description: null },
})
event({
  at: dayAt(9),
  actor: ME,
  entityType: 'column',
  action: 'create',
  entityName: '電子郵件',
  tableName: '使用者帳號資料表',
  after: { name: '電子郵件', dataType: 'VARCHAR', isNullable: false, order: 1 },
})
event({
  at: dayAt(6),
  actor: PEER,
  entityType: 'column',
  action: 'update',
  entityName: 'email',
  tableName: 'accounts',
  before: { name: 'mail' },
  after: { name: 'email' },
})
event({
  at: dayAt(5),
  actor: ME,
  agent: true,
  entityType: 'column',
  action: 'update',
  entityName: 'status',
  tableName: 'orders',
  before: { dataType: 'VARCHAR' },
  after: { dataType: 'TEXT' },
})
event({
  at: dayAt(5, 14),
  actor: ME,
  category: 'layout',
  entityType: 'table',
  action: 'move',
  entityName: 'orders',
  tableName: 'orders',
  before: { positionX: 500, positionY: 300 },
  after: { positionX: 640, positionY: 420 },
})

// An SQL import: 4 tables and 8 columns in one batch.
const IMPORT_BATCH = 'e7000000-0000-4000-8000-000000000001'
for (const name of [
  'import_users',
  'import_posts',
  'import_tags',
  'import_votes',
]) {
  event({
    at: dayAt(3),
    actor: ME,
    entityType: 'table',
    action: 'create',
    entityName: name,
    tableName: name,
    after: { name },
    batchId: IMPORT_BATCH,
    batchKind: 'sql-import',
  })
  for (const column of ['id', `${name}_label`]) {
    event({
      at: dayAt(3),
      actor: ME,
      entityType: 'column',
      action: 'create',
      entityName: column,
      tableName: name,
      after: { name: column, dataType: 'VARCHAR' },
      batchId: IMPORT_BATCH,
      batchKind: 'sql-import',
    })
  }
}

// A restore: three deletes, three creates and the marker naming the version.
const RESTORE_BATCH = 'e7000000-0000-4000-8000-000000000002'
for (const action of ['delete', 'create']) {
  for (const name of ['billing_a', 'billing_b', 'billing_c']) {
    event({
      at: dayAt(2),
      actor: PEER,
      entityType: 'table',
      action,
      entityName: name,
      tableName: name,
      ...(action === 'delete' ? { before: { name } } : { after: { name } }),
      batchId: RESTORE_BATCH,
      batchKind: 'restore',
    })
  }
}
event({
  at: dayAt(2),
  actor: PEER,
  entityType: 'board',
  action: 'update',
  entityName: 'Before the billing rewrite',
  after: {
    restoredVersion: {
      snapshotId: 'e8000000-0000-4000-8000-000000000001',
      label: 'Before the billing rewrite',
      createdAt: new Date(dayAt(8)).toISOString(),
    },
  },
  batchId: RESTORE_BATCH,
  batchKind: 'restore',
})

// A table delete that took a relationship and two columns with it.
const DELETE_BATCH = 'e7000000-0000-4000-8000-000000000003'
const deleteStep = (entityType: string, entityName: string, before: unknown) =>
  event({
    at: dayAt(1),
    actor: ME,
    entityType,
    action: 'delete',
    entityName,
    tableName: 'legacy_audit_log',
    before,
    batchId: DELETE_BATCH,
    batchKind: 'table-delete',
  })
deleteStep('relationship', 'legacy_audit_log.actor_id -> accounts.id', {
  cardinality: 'MANY_TO_ONE',
})
deleteStep('column', 'actor_id', { name: 'actor_id', dataType: 'UUID' })
deleteStep('column', 'id', { name: 'id', dataType: 'UUID' })
deleteStep('table', 'legacy_audit_log', { name: 'legacy_audit_log' })

event({
  at: now - 2 * 3_600_000,
  actor: PEER,
  entityType: 'column',
  action: 'create',
  entityName: 'tracking_code',
  tableName: 'orders',
  after: { name: 'tracking_code', dataType: 'VARCHAR', isNullable: true },
})

db.close()
console.log('seed-changelog: done')

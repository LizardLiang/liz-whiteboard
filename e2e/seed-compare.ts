// e2e/seed-compare.ts
// Seed for e2e/version-compare.spec.ts (and for looking at the compare view by
// hand). One board, "E2E Compare", with four saved versions and a current
// board that has moved on from all of them:
//   v1 "Baseline"                 users(id, mail, 暱稱) orders(id, user_id, total VARCHAR)
//                                 products(id, title); orders.user_id -> users.id
//   v2 "After the billing rewrite" renames users.mail -> email, drops 暱稱, adds
//                                 users.created_at, orders.total VARCHAR -> DECIMAL,
//                                 adds table invoices (+ relationship), moves users
//   v2 copy "Same as ..."         identical to v2 (an empty compare)
//   v3 "Layout pass"              v2 with products moved (layout only)
//   current                       renames products -> catalog_items, drops
//                                 orders.total, drops invoices -> orders
// A second board has no versions. Idempotent; run under BUN:
//   bun run e2e/seed-compare.ts
import './busy-report'
import { Database } from 'bun:sqlite'
import { CMP_IDS, CMP_NAMES, CMP_VERSIONS } from './compare-constants'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname
const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()
const HOUR = 3_600_000

for (const wb of Object.values(CMP_IDS))
  db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(wb)
for (const [wb, name] of [
  [CMP_IDS.board, 'E2E Compare'],
  [CMP_IDS.empty, 'E2E Compare Empty'],
] as const) {
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(wb, name, IDS.project, null, null, null, now, now)
}

const uuid = (n: number) =>
  `c2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T = {
  users: uuid(1),
  orders: uuid(2),
  products: uuid(3),
  invoices: uuid(4),
}
const C = {
  usersId: uuid(11),
  usersMail: uuid(12),
  usersNick: uuid(13),
  usersCreated: uuid(14),
  ordersId: uuid(21),
  ordersUser: uuid(22),
  ordersTotal: uuid(23),
  productsId: uuid(31),
  productsTitle: uuid(32),
  invoicesId: uuid(41),
  invoicesOrder: uuid(42),
}
const R = { ordersUsers: uuid(51), invoicesOrders: uuid(52) }

interface Col {
  id: string
  name: string
  dataType: string
  pk?: boolean
}
interface Tbl {
  id: string
  name: string
  x: number
  y: number
  cols: Array<Col>
}
interface Rel {
  id: string
  source: string
  target: string
  sourceCol: string
  targetCol: string
}
interface State {
  tables: Array<Tbl>
  rels: Array<Rel>
}

const idCol = (id: string): Col => ({
  id,
  name: 'id',
  dataType: 'UUID',
  pk: true,
})

const v1: State = {
  tables: [
    {
      id: T.users,
      name: 'users',
      x: 80,
      y: 80,
      cols: [
        idCol(C.usersId),
        { id: C.usersMail, name: 'mail', dataType: 'VARCHAR' },
        { id: C.usersNick, name: CMP_NAMES.cjkColumn, dataType: 'VARCHAR' },
      ],
    },
    {
      id: T.orders,
      name: 'orders',
      x: 520,
      y: 80,
      cols: [
        idCol(C.ordersId),
        { id: C.ordersUser, name: 'user_id', dataType: 'UUID' },
        { id: C.ordersTotal, name: 'total', dataType: 'VARCHAR' },
      ],
    },
    {
      id: T.products,
      name: 'products',
      x: 80,
      y: 400,
      cols: [
        idCol(C.productsId),
        { id: C.productsTitle, name: 'title', dataType: 'VARCHAR' },
      ],
    },
  ],
  rels: [
    {
      id: R.ordersUsers,
      source: T.orders,
      target: T.users,
      sourceCol: C.ordersUser,
      targetCol: C.usersId,
    },
  ],
}

const v2: State = {
  tables: [
    {
      ...v1.tables[0],
      x: 120,
      cols: [
        idCol(C.usersId),
        { id: C.usersMail, name: 'email', dataType: 'VARCHAR' },
        { id: C.usersCreated, name: 'created_at', dataType: 'TIMESTAMP' },
      ],
    },
    {
      ...v1.tables[1],
      cols: [
        idCol(C.ordersId),
        { id: C.ordersUser, name: 'user_id', dataType: 'UUID' },
        { id: C.ordersTotal, name: 'total', dataType: 'DECIMAL' },
      ],
    },
    v1.tables[2],
    {
      id: T.invoices,
      name: CMP_NAMES.longTable,
      x: 520,
      y: 400,
      cols: [
        idCol(C.invoicesId),
        { id: C.invoicesOrder, name: 'order_id', dataType: 'UUID' },
      ],
    },
  ],
  rels: [
    ...v1.rels,
    {
      id: R.invoicesOrders,
      source: T.invoices,
      target: T.orders,
      sourceCol: C.invoicesOrder,
      targetCol: C.ordersId,
    },
  ],
}

const v3: State = {
  tables: v2.tables.map((t) =>
    t.id === T.products ? { ...t, x: 900, y: 600 } : t,
  ),
  rels: v2.rels,
}

const current: State = {
  tables: v3.tables.map((t) => {
    if (t.id === T.products) return { ...t, name: 'catalog_items' }
    if (t.id === T.orders)
      return { ...t, cols: t.cols.filter((c) => c.id !== C.ordersTotal) }
    return t
  }),
  rels: v3.rels.filter((r) => r.id !== R.invoicesOrders),
}

const iso = (ms: number) => new Date(ms).toISOString()

function payload(state: State) {
  return {
    whiteboard: { name: 'E2E Compare', canvasState: null, textSource: null },
    tables: state.tables.map((t) => ({
      id: t.id,
      whiteboardId: CMP_IDS.board,
      name: t.name,
      description: null,
      positionX: t.x,
      positionY: t.y,
      width: null,
      height: null,
      sourceWhiteboardId: null,
      sourceTableId: null,
      createdAt: iso(now),
      updatedAt: iso(now),
      columns: t.cols.map((c, order) => ({
        id: c.id,
        tableId: t.id,
        name: c.name,
        dataType: c.dataType,
        isPrimaryKey: Boolean(c.pk),
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: null,
        order,
        sourceColumnId: null,
        createdAt: iso(now),
        updatedAt: iso(now),
      })),
    })),
    relationships: state.rels.map((r) => ({
      id: r.id,
      whiteboardId: CMP_IDS.board,
      sourceTableId: r.source,
      targetTableId: r.target,
      sourceColumnId: r.sourceCol,
      targetColumnId: r.targetCol,
      cardinality: 'MANY_TO_ONE',
      label: null,
      routingPoints: null,
      createdAt: iso(now),
      updatedAt: iso(now),
    })),
    areas: [],
    shapes: [],
    connectors: [],
  }
}

const saveVersion = (
  n: number,
  label: string,
  state: State,
  ageHours: number,
) =>
  db
    .query(
      'INSERT INTO "WhiteboardSnapshot" (id, whiteboardId, label, payload, createdByUserId, isAuto, createdAt) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      `c3000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      CMP_IDS.board,
      label,
      JSON.stringify(payload(state)),
      IDS.user,
      0,
      now - ageHours * HOUR,
    )

saveVersion(1, CMP_VERSIONS.v1, v1, 4)
saveVersion(2, CMP_VERSIONS.v2, v2, 3)
saveVersion(3, CMP_VERSIONS.v2copy, v2, 2)
saveVersion(4, CMP_VERSIONS.v3, v3, 1)

// The live board is `current`.
for (const t of current.tables) {
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(t.id, CMP_IDS.board, t.name, null, t.x, t.y, null, null, now, now)
  t.cols.forEach((c, order) => {
    db.query(
      'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, description, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      c.id,
      t.id,
      c.name,
      c.dataType,
      c.pk ? 1 : 0,
      0,
      0,
      0,
      null,
      order,
      now,
      now,
    )
  })
}
for (const r of current.rels) {
  db.query(
    'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    r.id,
    CMP_IDS.board,
    r.source,
    r.target,
    r.sourceCol,
    r.targetCol,
    'MANY_TO_ONE',
    null,
    null,
    now,
    now,
  )
}

console.log(`Seeded compare boards in ${DB_PATH}`)

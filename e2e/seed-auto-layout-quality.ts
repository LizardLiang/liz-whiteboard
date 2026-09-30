// e2e/seed-auto-layout-quality.ts
// Seed for the Auto Layout engine quality e2e (auto-layout-quality.spec.ts).
//
// Board 1 (IDS.autoLayoutQualityWhiteboard): a snowflake schema — one fact
// table, six dimensions, two of them snowflaked (dim_product -> dim_category,
// dim_customer -> dim_geography). Every DiagramTable `height` and `width` is
// NULL, like a freshly created table (see seed-autolayout.ts for why). The
// starting positions are a deliberately tangled grid: the fact table sits in a
// corner and related tables are scattered, so a passing layout has to be the
// engine's work, not the seed's.
//
// Board 2 (IDS.autoLayoutQualityImportWhiteboard): an EMPTY board the spec
// fills through Import SQL.
//
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-auto-layout-quality.ts`
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import { E2E_USER, IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

interface SnowflakeTable {
  name: string
  // Columns after the `id` primary key: [name, referenced table or null].
  columns: Array<[string, string | null]>
  // Starting grid cell (col, row) — scrambled on purpose.
  cell: [number, number]
}

const SNOWFLAKE: Array<SnowflakeTable> = [
  {
    name: 'fact_sales',
    columns: [
      ['customer_id', 'dim_customer'],
      ['product_id', 'dim_product'],
      ['date_id', 'dim_date'],
      ['store_id', 'dim_store'],
      ['employee_id', 'dim_employee'],
      ['promo_id', 'dim_promo'],
      ['amount', null],
    ],
    cell: [0, 0],
  },
  {
    name: 'dim_customer',
    columns: [
      ['full_name', null],
      ['geography_id', 'dim_geography'],
    ],
    cell: [2, 2],
  },
  {
    name: 'dim_product',
    columns: [
      ['title', null],
      ['category_id', 'dim_category'],
    ],
    cell: [0, 2],
  },
  {
    name: 'dim_date',
    columns: [
      ['day', null],
      ['month', null],
    ],
    cell: [1, 1],
  },
  { name: 'dim_store', columns: [['store_name', null]], cell: [2, 0] },
  { name: 'dim_employee', columns: [['emp_name', null]], cell: [1, 2] },
  { name: 'dim_promo', columns: [['promo_name', null]], cell: [0, 1] },
  { name: 'dim_category', columns: [['cat_name', null]], cell: [2, 1] },
  { name: 'dim_geography', columns: [['country', null]], cell: [1, 0] },
]

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

async function main() {
  const db = new Database(DB_PATH)
  db.exec('PRAGMA foreign_keys = ON')
  const now = Date.now()

  const existingUser = db
    .query('SELECT id FROM "User" WHERE id = ?')
    .get(IDS.user) as { id: string } | null
  if (!existingUser) {
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
  }
  const existingProject = db
    .query('SELECT id FROM "Project" WHERE id = ?')
    .get(IDS.project) as { id: string } | null
  if (!existingProject) {
    db.query(
      'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
    ).run(IDS.project, 'E2E Project', 'version-history e2e', now, now, IDS.user)
  }
  const existingMember = db
    .query('SELECT id FROM "ProjectMember" WHERE projectId = ? AND userId = ?')
    .get(IDS.project, IDS.user) as { id: string } | null
  if (!existingMember) {
    db.query(
      'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
    ).run(crypto.randomUUID(), IDS.project, IDS.user, 'ADMIN', now, now)
  }

  const insertBoard = db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  )
  for (const [id, name] of [
    [IDS.autoLayoutQualityWhiteboard, 'E2E Auto-Layout Quality'],
    [IDS.autoLayoutQualityImportWhiteboard, 'E2E Auto-Layout Quality Import'],
  ]) {
    // Wipe + recreate every run — cascades to tables/columns/relationships.
    db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(id)
    insertBoard.run(id, name, IDS.project, null, null, null, now, now)
  }

  const insertTable = db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
  const insertColumn = db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
  const insertRelationship = db.query(
    'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )

  const CELL_W = 330
  const CELL_H = 520
  const tableIdByName = new Map<string, string>()
  const pkIdByName = new Map<string, string>()
  const fkColumns: Array<{
    table: string
    columnId: string
    references: string
  }> = []

  for (const t of SNOWFLAKE) {
    const tableId = crypto.randomUUID()
    tableIdByName.set(t.name, tableId)
    insertTable.run(
      tableId,
      IDS.autoLayoutQualityWhiteboard,
      t.name,
      null,
      t.cell[0] * CELL_W,
      t.cell[1] * CELL_H,
      null,
      null,
      now,
      now,
    )
    const pkId = crypto.randomUUID()
    pkIdByName.set(t.name, pkId)
    insertColumn.run(pkId, tableId, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
    t.columns.forEach(([colName, ref], i) => {
      const columnId = crypto.randomUUID()
      insertColumn.run(
        columnId,
        tableId,
        colName,
        ref ? 'UUID' : 'VARCHAR',
        0,
        ref ? 1 : 0,
        0,
        1,
        i + 1,
        now,
        now,
      )
      if (ref) fkColumns.push({ table: t.name, columnId, references: ref })
    })
  }

  for (const fk of fkColumns) {
    insertRelationship.run(
      crypto.randomUUID(),
      IDS.autoLayoutQualityWhiteboard,
      tableIdByName.get(fk.table),
      tableIdByName.get(fk.references),
      fk.columnId,
      pkIdByName.get(fk.references),
      'MANY_TO_ONE',
      null,
      null,
      now,
      now,
    )
  }

  console.log(
    `[e2e seed-auto-layout-quality] ok — ${SNOWFLAKE.length} tables, ${fkColumns.length} relationships`,
  )
}

await main()

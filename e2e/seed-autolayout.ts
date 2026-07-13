// e2e/seed-autolayout.ts
// Dedicated seed for the Auto-Layout LOD sizing + minimap z-index e2e
// (GH #151, autolayout-lod-minimap.spec.ts). Mirrors e2e/seed-stress.ts's
// conventions (shared e2e user/project, own dedicated whiteboard id) but
// deliberately leaves every DiagramTable's `height` NULL — see
// fixtures.ts's `autoLayoutWhiteboard` comment for why: seed-stress.ts's
// hardcoded `height: 160` gets applied by React Flow as an explicit inline
// CSS height on the node wrapper, which pins `node.measured.height` to a
// constant regardless of LOD collapse and masks Bug 1 entirely. Leaving
// `height` NULL matches how real user-created tables are persisted
// (`diagram-table.ts` defaults to `null`), so `convert-to-nodes.ts` leaves
// `node.height` `undefined` and the wrapper auto-sizes to its actual
// rendered content — reproducing the LOD-trimmed vs. full-detail height
// difference Auto-Layout must size against.
//
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-autolayout.ts`
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import { E2E_USER, IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

// >= 4 tables (spec-delta requirement), 10 columns each — enough columns
// that the LOD-collapsed (header-only, 34px) vs. full-detail (34 + 10*28 =
// 314px) height delta is large relative to the 48px minimum layout gap.
const TABLE_COUNT = 5
const COLUMNS_PER_TABLE = 10

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

async function main() {
  const db = new Database(DB_PATH)
  db.exec('PRAGMA foreign_keys = ON')
  const now = Date.now()

  // Ensure the shared e2e user/project/membership exist (runnable standalone,
  // same defensive pattern as seed-stress.ts).
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

  // Wipe + recreate this board every run — cascades to DiagramTable/Column/
  // Relationship via the schema's FKs.
  db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(
    IDS.autoLayoutWhiteboard,
  )
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    IDS.autoLayoutWhiteboard,
    `E2E Auto-Layout LOD (${TABLE_COUNT})`,
    IDS.project,
    null,
    null,
    null,
    now,
    now,
  )

  // Deliberately NULL width/height (see header comment) — matches a real
  // freshly-created table, letting React Flow auto-size the node wrapper to
  // its actual rendered content instead of pinning it via inline CSS.
  const insertTable = db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
  const insertColumn = db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
  const insertRelationship = db.query(
    'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )

  // Grid layout, spaced generously — Auto-Layout will reposition everything
  // anyway; this is just a sane starting point (mirrors seed-stress.ts).
  const COLS = Math.max(1, Math.ceil(Math.sqrt(TABLE_COUNT)))
  const CELL_W = 400
  const CELL_H = 400

  const tableIds: Array<string> = []
  const pkColumnIdByTable: Array<string> = []

  for (let i = 0; i < TABLE_COUNT; i++) {
    const tableId = crypto.randomUUID()
    tableIds.push(tableId)
    const col = i % COLS
    const row = Math.floor(i / COLS)
    insertTable.run(
      tableId,
      IDS.autoLayoutWhiteboard,
      `autolayout_table_${i}`,
      `Auto-Layout LOD e2e fixture table ${i}`,
      col * CELL_W,
      row * CELL_H,
      null,
      null,
      now,
      now,
    )

    const pkColumnId = crypto.randomUUID()
    pkColumnIdByTable.push(pkColumnId)
    insertColumn.run(pkColumnId, tableId, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
    for (let c = 1; c < COLUMNS_PER_TABLE; c++) {
      insertColumn.run(
        crypto.randomUUID(),
        tableId,
        `field_${c}`,
        'VARCHAR',
        0,
        0,
        0,
        1,
        c,
        now,
        now,
      )
    }
  }

  // Simple connected chain (table i -> table i-1) so the layout engine sees
  // a realistic connected graph rather than N isolated nodes.
  let relationshipCount = 0
  for (let i = 1; i < TABLE_COUNT; i++) {
    const fkColumnId = crypto.randomUUID()
    insertColumn.run(
      fkColumnId,
      tableIds[i],
      `autolayout_table_${i - 1}_id`,
      'UUID',
      0,
      1,
      0,
      1,
      100 + relationshipCount,
      now,
      now,
    )
    insertRelationship.run(
      crypto.randomUUID(),
      IDS.autoLayoutWhiteboard,
      tableIds[i],
      tableIds[i - 1],
      fkColumnId,
      pkColumnIdByTable[i - 1],
      'MANY_TO_ONE',
      null,
      null,
      now,
      now,
    )
    relationshipCount++
  }

  console.log(
    `[e2e seed-autolayout] ok — whiteboard ${IDS.autoLayoutWhiteboard} (${TABLE_COUNT} tables, ${relationshipCount} relationships)`,
  )
}

await main()

// e2e/seed-stress.ts
// Parameterized stress-test seed for the React Flow perf work (GH #121).
// Mirrors e2e/seed.ts's conventions but builds N tables (~8-12 columns each)
// plus a realistic connected web of relationships, driven by the
// STRESS_TABLE_COUNT env var (default 100). Run under BUN (needs bun:sqlite):
//   bun run e2e/seed-stress.ts
//   STRESS_TABLE_COUNT=30 bun run e2e/seed-stress.ts
//
// Reuses the shared e2e user/project (creating them if this is run standalone
// for manual profiling, without global-setup's seed.ts having run first) but
// owns a DEDICATED whiteboard id so it never collides with — or gets wiped
// by — the version-history / multi-select-drag boards seed.ts owns.
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import { E2E_USER, E2E_VIEWER_USER, IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const TABLE_COUNT = Math.max(1, Number(process.env.STRESS_TABLE_COUNT ?? 100))
const COLUMNS_PER_TABLE_MIN = 8
const COLUMNS_PER_TABLE_MAX = 12
const COLUMN_TYPES = [
  'UUID',
  'VARCHAR',
  'TEXT',
  'INTEGER',
  'BOOLEAN',
  'TIMESTAMP',
  'DECIMAL',
  'JSON',
]

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

// Small deterministic PRNG (LCG) — same STRESS_TABLE_COUNT always produces
// the same board shape, so before/after profiling runs are comparable.
let prngState = 42
function nextRandom(): number {
  prngState = (prngState * 1103515245 + 12345) & 0x7fffffff
  return prngState / 0x7fffffff
}

async function main() {
  const db = new Database(DB_PATH)
  // SQLite defaults foreign_keys OFF per-connection; enable so the whiteboard
  // delete below cascades to DiagramTable → Column/Relationship like the
  // app's own connection (src/db.ts) does.
  db.exec('PRAGMA foreign_keys = ON')
  const now = Date.now()

  // Ensure the shared e2e user/project/membership exist — this script must
  // also be runnable standalone (manual profiling) without e2e/seed.ts
  // having run first. Never wipes them (unlike seed.ts) since other specs'
  // boards hang off the same user/project.
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

  // Second, VIEWER-role project member (tactical plan: canvas-table-
  // affordances) — a real authenticated session distinct from the public
  // share-link path (viewerRole=null there gates BOTH canEdit AND
  // canComment to false, so it can't discriminate the "Comment=viewer+,
  // Note=editor+" permission split). canvas-affordances.spec.ts logs in as
  // this user via the real /login form to test that split for real.
  const existingViewerUser = db
    .query('SELECT id FROM "User" WHERE id = ?')
    .get(IDS.viewerUser) as { id: string } | null
  if (!existingViewerUser) {
    db.query(
      'INSERT INTO "User" (id, username, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
    ).run(
      IDS.viewerUser,
      E2E_VIEWER_USER.username,
      E2E_VIEWER_USER.email,
      await hashPassword(E2E_VIEWER_USER.password),
      now,
      now,
    )
  }

  // Dedicated project/whiteboard for the viewer permission test — NOT
  // IDS.project (see IDS.viewerProject's fixtures.ts comment for why: a
  // second ProjectMember row on the SHARED "E2E Project" pushed
  // canvas-edit-overlay.spec.ts's own Share panel viewer test's "Revoke"
  // button out of the dialog's viewport, a real cross-spec regression).
  // Wiped + recreated every run (cascades ProjectMember/Whiteboard/
  // DiagramTable/Column via their FKs) so it's always in a known state.
  db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.viewerProject)
  db.query(
    'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
  ).run(
    IDS.viewerProject,
    'E2E Viewer Project',
    'canvas-table-affordances viewer-permission-gate e2e',
    now,
    now,
    IDS.user,
  )
  db.query(
    'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), IDS.viewerProject, IDS.user, 'ADMIN', now, now)
  db.query(
    'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(
    crypto.randomUUID(),
    IDS.viewerProject,
    IDS.viewerUser,
    'VIEWER',
    now,
    now,
  )
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    IDS.viewerWhiteboard,
    'E2E Viewer Whiteboard',
    IDS.viewerProject,
    null,
    null,
    null,
    now,
    now,
  )
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(
    IDS.viewerTable,
    IDS.viewerWhiteboard,
    'viewer_test_table',
    'Viewer permission gate test table note.',
    0,
    0,
    240,
    160,
    now,
    now,
  )
  db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), IDS.viewerTable, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)

  // Wipe any prior stress board — cascades to its DiagramTable/Column/
  // Relationship/Area rows via the schema's ON DELETE CASCADE FKs.
  db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.stressWhiteboard)

  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    IDS.stressWhiteboard,
    `E2E Stress (${TABLE_COUNT})`,
    IDS.project,
    null,
    null,
    null,
    now,
    now,
  )

  const insertTable = db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
  const insertColumn = db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
  const insertRelationship = db.query(
    'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )

  // Grid layout so the stress board is navigable in the app (not a pile at
  // the origin) — roughly square aspect ratio regardless of N.
  const COLS = Math.max(1, Math.ceil(Math.sqrt(TABLE_COUNT)))
  const CELL_W = 320
  const CELL_H = 280

  const tableIds: Array<string> = []
  const pkColumnIdByTable: Array<string> = []

  for (let i = 0; i < TABLE_COUNT; i++) {
    const tableId = crypto.randomUUID()
    tableIds.push(tableId)
    const col = i % COLS
    const row = Math.floor(i / COLS)
    insertTable.run(
      tableId,
      IDS.stressWhiteboard,
      `stress_table_${i}`,
      `Stress fixture table ${i}`,
      col * CELL_W,
      row * CELL_H,
      240,
      160,
      now,
      now,
    )

    const columnCount =
      COLUMNS_PER_TABLE_MIN +
      Math.floor(
        nextRandom() * (COLUMNS_PER_TABLE_MAX - COLUMNS_PER_TABLE_MIN + 1),
      )
    const pkColumnId = crypto.randomUUID()
    pkColumnIdByTable.push(pkColumnId)
    insertColumn.run(pkColumnId, tableId, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
    for (let c = 1; c < columnCount; c++) {
      const dataType =
        COLUMN_TYPES[Math.floor(nextRandom() * COLUMN_TYPES.length)]
      insertColumn.run(
        crypto.randomUUID(),
        tableId,
        `field_${c}`,
        dataType,
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

  // Realistic connected web: each table (after the first) gets an FK column
  // pointing at an earlier table's primary key. Produces a connected,
  // acyclic-ish graph like a real ERD rather than a fully-random tangle.
  let relationshipCount = 0
  for (let i = 1; i < TABLE_COUNT; i++) {
    const targetIndex = Math.floor(nextRandom() * i)
    const fkColumnId = crypto.randomUUID()
    insertColumn.run(
      fkColumnId,
      tableIds[i],
      `stress_table_${targetIndex}_id`,
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
      IDS.stressWhiteboard,
      tableIds[i],
      tableIds[targetIndex],
      fkColumnId,
      pkColumnIdByTable[targetIndex],
      'MANY_TO_ONE',
      null,
      null,
      now,
      now,
    )
    relationshipCount++
  }

  // Field-note fixture (tactical plan: canvas-field-note-popover) — no
  // seeded column otherwise carries a `description` (only tables do, via
  // insertTable above), so a field-note glyph would never render. Set one
  // on stress_table_0's PK column (`id`, order 0 — the earliest/first row)
  // so canvas-field-note.spec.ts has a stable, guaranteed rowIndex=0
  // coordinate to click regardless of table iteration order elsewhere.
  db.query('UPDATE "Column" SET description = ? WHERE id = ?').run(
    'Stress fixture field note for stress_table_0.id.',
    pkColumnIdByTable[0],
  )

  console.log(
    `[e2e seed-stress] ok — whiteboard ${IDS.stressWhiteboard} (${TABLE_COUNT} tables, ${relationshipCount} relationships)`,
  )
}

await main()

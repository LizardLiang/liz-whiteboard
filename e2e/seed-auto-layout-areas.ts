// e2e/seed-auto-layout-areas.ts
// Seed for the area-aware Auto Layout e2e (auto-layout-areas.spec.ts).
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-auto-layout-areas.ts`.
//
// One area with three member tables placed messily (the third sticks out of
// the box), two ungrouped tables overlapping the area, one relationship
// between two members and one from a member to an ungrouped table.
// Resets ONLY this board, so it is safe to run before every test. e2e/seed.ts
// must have run first (the board hangs off IDS.project). Table width/height
// are NULL like real tables; the spec uses the client's 220 px default width.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.alaWhiteboard)
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.alaWhiteboard,
  'E2E Auto-Layout Areas',
  IDS.project,
  null,
  null,
  null,
  now,
  now,
)

const tables: Array<[string, string, number, number]> = [
  [IDS.alaMember1, 'orders', 130, 150],
  [IDS.alaMember2, 'items', 140, 330],
  // Centre sits inside the box, but the table sticks out of its right edge.
  [IDS.alaMember3, 'refunds', 420, 160],
  [IDS.alaFree1, 'customers', 260, 240],
  [IDS.alaFree2, 'audit', 380, 120],
]
const pkIds = new Map<string, string>()
const fkIds = new Map<string, string>()
for (const [id, name, x, y] of tables) {
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(id, IDS.alaWhiteboard, name, null, x, y, null, null, now, now)
  const pk = crypto.randomUUID()
  const fk = crypto.randomUUID()
  pkIds.set(id, pk)
  fkIds.set(id, fk)
  const col = db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
  col.run(pk, id, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
  col.run(fk, id, 'ref_id', 'UUID', 0, 1, 0, 1, 1, now, now)
}

function rel(source: string, target: string) {
  db.query(
    'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    crypto.randomUUID(),
    IDS.alaWhiteboard,
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
}
rel(IDS.alaMember2, IDS.alaMember1) // member -> member
rel(IDS.alaMember3, IDS.alaFree2) // member -> ungrouped

db.query(
  'INSERT INTO "Area" (id, whiteboardId, name, color, positionX, positionY, width, height, memberTableIds, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.alaArea,
  IDS.alaWhiteboard,
  'Billing',
  '#8b5cf6',
  100,
  100,
  500,
  420,
  JSON.stringify([IDS.alaMember1, IDS.alaMember2, IDS.alaMember3]),
  now,
  now,
)

console.log(`[e2e seed-auto-layout-areas] ok — whiteboard ${IDS.alaWhiteboard}`)

// e2e/seed-multi-drag-area.ts
// Seed for multi-drag-area-members.spec.ts (#2258). Run under BUN:
// `bun run e2e/seed-multi-drag-area.ts`. One area holding three member tables
// plus one ungrouped table well clear of the area. Resets ONLY this board, so
// it is safe to run before every test. e2e/seed.ts must have run first.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(IDS.mdaWhiteboard)
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.mdaWhiteboard,
  'E2E Multi-Drag Area',
  IDS.project,
  null,
  null,
  null,
  now,
  now,
)

const tables: Array<[string, string, number, number]> = [
  [IDS.mdaMember1, 'alpha', 140, 160],
  [IDS.mdaMember2, 'bravo', 140, 340],
  [IDS.mdaMember3, 'charlie', 420, 160],
  [IDS.mdaFree, 'delta', 1000, 160],
]
for (const [id, name, x, y] of tables) {
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(id, IDS.mdaWhiteboard, name, null, x, y, null, null, now, now)
  db.query(
    'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), id, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
}

db.query(
  'INSERT INTO "Area" (id, whiteboardId, name, color, positionX, positionY, width, height, memberTableIds, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  IDS.mdaArea,
  IDS.mdaWhiteboard,
  'Group',
  '#8b5cf6',
  100,
  100,
  700,
  500,
  JSON.stringify([IDS.mdaMember1, IDS.mdaMember2, IDS.mdaMember3]),
  now,
  now,
)

console.log(`[e2e seed-multi-drag-area] ok — whiteboard ${IDS.mdaWhiteboard}`)

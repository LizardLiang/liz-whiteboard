// e2e/db-snapshot.ts
// Prints one whiteboard's persisted geometry and rows as JSON, so a spec can
// prove an interaction changed nothing. Run under BUN (needs bun:sqlite):
// `bun run e2e/db-snapshot.ts <whiteboardId>`. Read-only.
import { Database } from 'bun:sqlite'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname
const whiteboardId = process.argv[2]
if (!whiteboardId) throw new Error('usage: db-snapshot.ts <whiteboardId>')

const db = new Database(DB_PATH, { readonly: true })
db.exec('PRAGMA busy_timeout = 5000')
const rows = (sql: string) => db.query(sql).all(whiteboardId)

console.log(
  JSON.stringify({
    areas: rows(
      'SELECT id, name, positionX, positionY, width, height, memberTableIds FROM "Area" WHERE whiteboardId = ? ORDER BY id',
    ),
    tables: rows(
      'SELECT id, name, positionX, positionY, width, height FROM "DiagramTable" WHERE whiteboardId = ? ORDER BY id',
    ),
    relationships: rows(
      'SELECT id, sourceColumnId, targetColumnId, cardinality FROM "Relationship" WHERE whiteboardId = ? ORDER BY id',
    ),
    shapes: rows(
      'SELECT id, positionX, positionY, width, height FROM "Shape" WHERE whiteboardId = ? ORDER BY id',
    ),
    connectors: rows(
      'SELECT id, sourceShapeId, targetShapeId FROM "Connector" WHERE whiteboardId = ? ORDER BY id',
    ),
  }),
)

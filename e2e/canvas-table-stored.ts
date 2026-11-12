// e2e/canvas-table-stored.ts
// Prints the STORED grid of the first table element on a canvas board as JSON
// (null when there is none), so a spec can wait on what the server persisted
// instead of the optimistic scene. Run under BUN (needs bun:sqlite):
// `bun run e2e/canvas-table-stored.ts <boardId>`. Read-only.
import { Database } from 'bun:sqlite'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname
const boardId = process.argv[2]
if (!boardId) throw new Error('usage: canvas-table-stored.ts <boardId>')

const db = new Database(DB_PATH, { readonly: true })
db.exec('PRAGMA busy_timeout = 30000')
const row = db
  .query(
    `SELECT props FROM "CanvasElement" WHERE boardId = ? AND kind = 'table' ORDER BY createdAt LIMIT 1`,
  )
  .get(boardId) as { props: string | null } | null
const props = row?.props ? JSON.parse(row.props) : null
console.log(JSON.stringify(props?.table ?? null))

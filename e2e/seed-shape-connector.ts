// e2e/seed-shape-connector.ts
// Seed for e2e/shape-connector-outline.spec.ts. Run under BUN (needs
// bun:sqlite): `bun run e2e/seed-shape-connector.ts`. Runs after seed-canvas.ts
// (the spec's beforeEach does both) and turns the seeded connector board's
// target into a DIAMOND with an UNANCHORED connector, so the connector's end
// is derived from the centre-to-centre ray. A side-midpoint anchor would land
// on a diamond vertex with or without the fix and prove nothing.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

db.query('UPDATE "CanvasElement" SET kind = ?, props = ? WHERE id = ?').run(
  'diamond',
  JSON.stringify({ kind: 'diamond' }),
  IDS.canvasConnTarget,
)
db.query('UPDATE "CanvasElement" SET props = ? WHERE id = ?').run(
  JSON.stringify({
    kind: 'connector',
    sourceElementId: IDS.canvasConnSource,
    targetElementId: IDS.canvasConnTarget,
    routing: 'straight',
  }),
  IDS.canvasConnector,
)

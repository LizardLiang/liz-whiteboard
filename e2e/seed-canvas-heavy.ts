// e2e/seed-canvas-heavy.ts
// A canvas board with a wide spread of elements, for the text-cache and
// viewport-culling spec. Run under BUN after seed-stress.ts and seed-canvas.ts
// (it adds a board to IDS.canvasProject). Idempotent: it deletes its own board
// first.
//
// Layout, in world units (the default camera shows about x 0..1600, y 0..1000):
//   - `heavyEdit`   a short text label in view, at (100, 150), 360 x 240
//   - `heavyFar`    a text label at x = 3000, far to the right of the view
//   - `heavyLeft` / `heavyRight` two small shapes at x = -2500 and x = 6000,
//     joined by a straight connector at y = 440 that crosses the view while
//     both of its ends are off-screen
//   - a 12 x 8 grid of labelled shapes from y = 500 down, most of them
//     outside the view
import './busy-report'
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'
import { HEAVY_BOARD, HEAVY_EDIT, HEAVY_FAR } from './canvas-heavy-ids'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname
const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

db.query('DELETE FROM "CanvasBoard" WHERE id = ?').run(HEAVY_BOARD)
db.query(
  'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(HEAVY_BOARD, 'E2E Canvas Heavy', IDS.canvasProject, null, now, now)

const shapeStyle = {
  fill: 'rgba(59, 130, 246, 0.10)',
  stroke: '#3b82f6',
  strokeWidth: 2,
  fontSize: 16,
  color: '#0f172a',
}
// A text label has no fill and no stroke, so every painted pixel is a glyph.
const labelStyle = { ...shapeStyle, fill: 'none', strokeWidth: 0, fontSize: 28 }

const insert = db.query(
  'INSERT INTO "CanvasElement" (id, boardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
)
let z = 0
function add(opts: {
  id?: string
  kind: 'rectangle' | 'text' | 'connector'
  x: number
  y: number
  w: number
  h: number
  text?: string | null
  style?: object
  props?: object
}) {
  const id = opts.id ?? crypto.randomUUID()
  insert.run(
    id,
    HEAVY_BOARD,
    opts.kind,
    opts.x,
    opts.y,
    opts.w,
    opts.h,
    0,
    (z += 1),
    opts.text ?? null,
    JSON.stringify(opts.style ?? shapeStyle),
    JSON.stringify(opts.props ?? { kind: opts.kind }),
    now,
    now,
  )
  return id
}

db.exec('BEGIN')
add({
  id: HEAVY_EDIT,
  kind: 'text',
  x: 100,
  y: 150,
  w: 360,
  h: 240,
  text: 'Hi',
  style: labelStyle,
})
add({
  id: HEAVY_FAR,
  kind: 'text',
  x: 3000,
  y: 150,
  w: 360,
  h: 240,
  text: 'FAR AWAY LABEL',
  style: labelStyle,
})
const left = add({
  kind: 'rectangle',
  x: -2500,
  y: 415,
  w: 50,
  h: 50,
})
const right = add({
  kind: 'rectangle',
  x: 6000,
  y: 415,
  w: 50,
  h: 50,
})
add({
  kind: 'connector',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  props: {
    kind: 'connector',
    sourceElementId: left,
    targetElementId: right,
    routing: 'straight',
  },
})
for (let row = 0; row < 8; row += 1) {
  for (let col = 0; col < 12; col += 1) {
    add({
      kind: 'rectangle',
      x: col * 500,
      y: 500 + row * 400,
      w: 260,
      h: 180,
      text: `Cell ${row}-${col}: quarterly planning notes that wrap across several lines`,
    })
  }
}
db.exec('COMMIT')
console.log('seeded canvas heavy board', HEAVY_BOARD)

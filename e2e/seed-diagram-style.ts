// e2e/seed-diagram-style.ts
// Seed for e2e/canvas-diagram-style.spec.ts. Run under BUN (needs bun:sqlite)
// AFTER seed-canvas.ts, which creates IDS.canvasProject and its members.
//
// Board: ellipse start -> rect A -> rect B -> rect C, plus an unconnected note.
// Fills are the default blue swatch and the board has NO settings value, so
// the board must open in the default `card` style.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

db.query('DELETE FROM "CanvasBoard" WHERE id = ?').run(IDS.canvasStyleBoard)
db.query(
  'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(
  IDS.canvasStyleBoard,
  'E2E Diagram Style',
  IDS.canvasProject,
  null,
  now,
  now,
)

const STYLE = JSON.stringify({
  fill: 'rgba(59, 130, 246, 0.10)',
  stroke: '#3b82f6',
  strokeWidth: 2,
  fontSize: 16,
  color: '#0f172a',
})

function shape(
  id: string,
  kind: 'rectangle' | 'ellipse',
  x: number,
  y: number,
  w: number,
  h: number,
  text: string | null,
  zIndex: number,
) {
  db.query(
    'INSERT INTO "CanvasElement" (id, boardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    IDS.canvasStyleBoard,
    kind,
    x,
    y,
    w,
    h,
    0,
    zIndex,
    text,
    STYLE,
    JSON.stringify({ kind }),
    now,
    now,
  )
}

function connector(id: string, source: string, target: string, zIndex: number) {
  db.query(
    'INSERT INTO "CanvasElement" (id, boardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    IDS.canvasStyleBoard,
    'connector',
    0,
    0,
    1,
    1,
    0,
    zIndex,
    null,
    STYLE,
    JSON.stringify({
      kind: 'connector',
      sourceElementId: source,
      targetElementId: target,
      routing: 'straight',
    }),
    now,
    now,
  )
}

shape(IDS.canvasStyleStart, 'ellipse', 300, 300, 160, 100, 'Start', 0)
shape(
  IDS.canvasStyleRectA,
  'rectangle',
  560,
  290,
  200,
  120,
  'Validate\nchecks input',
  1,
)
shape(
  IDS.canvasStyleRectB,
  'rectangle',
  860,
  290,
  200,
  120,
  'Save\nwrites the row',
  2,
)
shape(
  IDS.canvasStyleRectC,
  'rectangle',
  1160,
  290,
  200,
  120,
  'Notify\nsends mail',
  3,
)
shape(IDS.canvasStyleNote, 'rectangle', 560, 560, 200, 120, 'Side note', 4)
connector(
  IDS.canvasStyleConnStartA,
  IDS.canvasStyleStart,
  IDS.canvasStyleRectA,
  5,
)
connector(IDS.canvasStyleConnAB, IDS.canvasStyleRectA, IDS.canvasStyleRectB, 6)
connector(IDS.canvasStyleConnBC, IDS.canvasStyleRectB, IDS.canvasStyleRectC, 7)

console.log('[e2e seed-diagram-style] diagram style board ready')

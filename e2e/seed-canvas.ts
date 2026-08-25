// e2e/seed-canvas.ts
// Deterministic seed for the FigJam canvas-engine Playwright suite (Wave 5).
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-canvas.ts`. Idempotent —
// wipes and recreates a DEDICATED project (IDS.canvasProject) with two canvas
// boards, so this suite's destructive cases never touch a shared board.
//
// Mirrors e2e/seed-shapes.ts exactly, including why it exists as its own
// script: this suite re-seeds before EVERY test because its cases create,
// move, resize and delete elements.
//
// Reuses IDS.user (ADMIN, seeded by e2e/seed.ts) and IDS.viewerUser (VIEWER,
// seeded by e2e/seed-stress.ts) as this project's members — both scripts must
// run before this one. global-setup.ts runs seed.ts; this suite's own
// test.beforeAll runs seed-stress.ts.
//
// Two boards, deliberately:
//   canvasBoard       — the editor board. Every mutating test uses it.
//   canvasViewerBoard — read-only gate only. Kept separate so the VIEWER
//                       assertions can never race a mutating test.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
// SQLite defaults foreign_keys OFF per-connection; enable so the cleanup
// DELETE below cascades project -> boards -> elements exactly as the app's own
// connection (src/db.ts) does.
db.exec('PRAGMA foreign_keys = ON')
// This script re-seeds once per test, unlike the once-per-file seed.ts, which
// raises real contention odds against the live dev server's own WAL writer.
// busy_timeout makes SQLite retry internally instead of throwing SQLITE_BUSY.
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

// ── Wipe prior rows on the fixed ids (defensive, mirrors seed-shapes.ts) ────
db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.canvasProject)

// Housekeeping: a manual browser-check board was left on this id during the
// Wave 4 verification round. It belongs to no suite and must not exist when
// the e2e run starts.
db.query('DELETE FROM "CanvasBoard" WHERE id = ?').run(
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
)

db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(
  IDS.canvasProject,
  'E2E Canvas Project',
  'figjam canvas-engine e2e',
  now,
  now,
  IDS.user,
)

db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.canvasProject, IDS.user, 'ADMIN', now, now)
db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(
  crypto.randomUUID(),
  IDS.canvasProject,
  IDS.viewerUser,
  'VIEWER',
  now,
  now,
)

function board(id: string, name: string) {
  db.query(
    'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(id, name, IDS.canvasProject, null, now, now)
}

/**
 * Style and props are written as JSON exactly as `createCanvasElement` does.
 * `props.kind` MUST equal `kind` — the same cross-check the Zod schema and the
 * socket handler enforce, so a seed row that violated it would be a row the
 * app itself would refuse to write.
 */
function element(opts: {
  id: string
  boardId: string
  kind: 'rectangle' | 'text'
  x: number
  y: number
  w: number
  h: number
  text: string | null
  zIndex: number
}) {
  db.query(
    'INSERT INTO "CanvasElement" (id, boardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    opts.id,
    opts.boardId,
    opts.kind,
    opts.x,
    opts.y,
    opts.w,
    opts.h,
    0,
    opts.zIndex,
    opts.text,
    JSON.stringify({
      fill: 'rgba(59, 130, 246, 0.10)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      fontSize: 16,
      color: '#0f172a',
    }),
    JSON.stringify({ kind: opts.kind }),
    now,
    now,
  )
}

board(IDS.canvasBoard, 'E2E Canvas')
board(IDS.canvasViewerBoard, 'E2E Canvas Viewer')

// One seeded rectangle, well clear of the top-left toolbar (which sits at
// roughly x<200, y<80 in screen space at the default camera) so a pointer
// aimed at it never lands on a button instead.
element({
  id: IDS.canvasRect,
  boardId: IDS.canvasBoard,
  kind: 'rectangle',
  x: 300,
  y: 300,
  w: 200,
  h: 140,
  text: null,
  zIndex: 0,
})

// A seeded text element with known content, for the reload/read paths.
element({
  id: IDS.canvasText,
  boardId: IDS.canvasBoard,
  kind: 'text',
  x: 300,
  y: 520,
  w: 240,
  h: 48,
  text: 'seeded label',
  zIndex: 1,
})

element({
  id: IDS.canvasViewerRect,
  boardId: IDS.canvasViewerBoard,
  kind: 'rectangle',
  x: 300,
  y: 300,
  w: 200,
  h: 140,
  text: null,
  zIndex: 0,
})

console.log(`[e2e seed-canvas] ok — board ${IDS.canvasBoard}`)

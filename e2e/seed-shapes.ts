// e2e/seed-shapes.ts
// Deterministic seed for the shapes-and-connectors Playwright suite. Run
// under BUN (needs bun:sqlite): `bun run e2e/seed-shapes.ts`. Idempotent —
// wipes and recreates a DEDICATED project/whiteboard (IDS.shapesProject/
// shapesWhiteboard) so this suite's destructive cases (E2E-20's full-board
// wipe via legacy-snapshot restore) never touch the shared e2e board.
//
// Reuses IDS.user (ADMIN, seeded by e2e/seed.ts) and IDS.viewerUser (VIEWER,
// seeded by e2e/seed-stress.ts) as this project's members — both scripts
// must run before this one; global-setup.ts runs seed.ts, and this suite's
// own test.beforeAll runs seed-stress.ts then this script (mirrors
// canvas-affordances.spec.ts's pattern).
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
// This script re-seeds once per e2e test (test.beforeEach), unlike the
// once-per-file seed.ts/seed-stress.ts — that raises real contention odds
// against the live dev server's own WAL writer. busy_timeout makes SQLite
// retry internally instead of throwing SQLITE_BUSY immediately.
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

// ── Wipe prior rows on the fixed ids (defensive, mirrors seed.ts) ──────────
db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.shapesProject)

db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(
  IDS.shapesProject,
  'E2E Shapes Project',
  'shapes-and-connectors e2e',
  now,
  now,
  IDS.user,
)

db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.shapesProject, IDS.user, 'ADMIN', now, now)
db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(
  crypto.randomUUID(),
  IDS.shapesProject,
  IDS.viewerUser,
  'VIEWER',
  now,
  now,
)

db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(
  IDS.shapesWhiteboard,
  'E2E Shapes',
  IDS.shapesProject,
  null,
  null,
  null,
  now,
  now,
)

function insertShape(opts: {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  text: string | null
  props: Record<string, unknown>
}) {
  db.query(
    'INSERT INTO "Shape" (id, whiteboardId, kind, positionX, positionY, width, height, rotation, "zIndex", text, style, props, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    opts.id,
    IDS.shapesWhiteboard,
    opts.kind,
    opts.x,
    opts.y,
    opts.w,
    opts.h,
    0,
    0,
    opts.text,
    JSON.stringify({
      fill: 'none',
      stroke: 'slate',
      strokeWidth: 2,
      strokeStyle: 'solid',
      fontSize: 16,
      textColor: 'auto',
    }),
    JSON.stringify(opts.props),
    now,
    now,
  )
}

insertShape({
  id: IDS.rectShape,
  kind: 'rectangle',
  x: 120,
  y: 120,
  w: 160,
  h: 100,
  text: 'Rect label',
  props: { kind: 'rectangle' },
})
insertShape({
  id: IDS.ellipseShape,
  kind: 'ellipse',
  x: 420,
  y: 120,
  w: 160,
  h: 100,
  text: null,
  props: { kind: 'ellipse' },
})
insertShape({
  id: IDS.diamondShape,
  kind: 'diamond',
  x: 720,
  y: 120,
  w: 160,
  h: 100,
  text: null,
  props: { kind: 'diamond' },
})
insertShape({
  id: IDS.textShape,
  kind: 'text',
  x: 120,
  y: 320,
  w: 200,
  h: 40,
  text: 'Hello text shape',
  props: { kind: 'text' },
})
insertShape({
  id: IDS.lineShape,
  kind: 'line',
  x: 420,
  y: 320,
  w: 160,
  h: 48,
  text: null,
  props: {
    kind: 'line',
    x1: 0,
    y1: 0.5,
    x2: 1,
    y2: 0.5,
    arrowStart: false,
    arrowEnd: true,
  },
})

db.query(
  'INSERT INTO "Connector" (id, whiteboardId, sourceShapeId, targetShapeId, style, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
).run(
  IDS.shapeConnector,
  IDS.shapesWhiteboard,
  IDS.rectShape,
  IDS.ellipseShape,
  JSON.stringify({
    stroke: 'slate',
    strokeWidth: 2,
    strokeStyle: 'solid',
    arrowStart: false,
    arrowEnd: true,
  }),
  now,
  now,
)

// Clean up any prior snapshots on this board so the legacy-payload test
// (E2E-20) is the only one present.
db.query('DELETE FROM "WhiteboardSnapshot" WHERE whiteboardId = ?').run(
  IDS.shapesWhiteboard,
)

// A payload captured BEFORE shapes existed (FR-035a): no `shapes`/
// `connectors` key at all — the real shape of every snapshot saved before
// this feature shipped.
const legacyPayload = {
  whiteboard: { name: 'E2E Shapes', canvasState: null, textSource: null },
  tables: [],
  relationships: [],
  areas: [],
  // Deliberately no `shapes`/`connectors` keys.
}
db.query(
  'INSERT INTO "WhiteboardSnapshot" (id, whiteboardId, label, payload, createdByUserId, isAuto, createdAt) VALUES (?,?,?,?,?,?,?)',
).run(
  IDS.legacySnapshot,
  IDS.shapesWhiteboard,
  'Pre-shapes legacy version',
  JSON.stringify(legacyPayload),
  IDS.user,
  0,
  now - 1000,
)

console.log(`[e2e seed-shapes] ok — whiteboard ${IDS.shapesWhiteboard}`)

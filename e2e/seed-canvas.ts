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
  kind: 'rectangle' | 'ellipse' | 'text' | 'connector' | 'group'
  x: number
  y: number
  w: number
  h: number
  text: string | null
  zIndex: number
  /**
   * Endpoints for a `connector`, which are its ONLY real content — a
   * connector's stored geometry is a degenerate 1x1 placeholder and its shape
   * is derived from these two elements' live bounds every frame.
   *
   * Each end is EITHER an existing element's id OR a free point — never
   * both, mirroring schema.ts's `hasExactlyOneEnd` refinement.
   * `sourcePoint`/`targetPoint` (canvas-cmd-k-search-panel tactical plan)
   * are what let a seeded connector's far end be a free point instead of a
   * dedicated extra element.
   */
  connector?: {
    sourceElementId?: string
    targetElementId?: string
    sourcePoint?: { x: number; y: number }
    targetPoint?: { x: number; y: number }
    routing: string
    sourceAnchor?: string
    targetAnchor?: string
  }
  /**
   * Direct member ids for a `group` (canvas-element-grouping tactical plan,
   * Wave 1) — the group's ONLY real content beyond its own frame
   * (x/y/w/h ARE real for a group, unlike a connector's placeholder: the
   * frame is stored, explicit, and never re-derived from members).
   */
  childIds?: Array<string>
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
    JSON.stringify(
      opts.connector
        ? {
            kind: 'connector',
            // `?? null`, not left undefined: schema.ts's flat storage shape
            // requires the KEY present (nullable), never absent — see its
            // own comment on why an attached end became nullable when free
            // ends were added.
            sourceElementId: opts.connector.sourceElementId ?? null,
            targetElementId: opts.connector.targetElementId ?? null,
            ...(opts.connector.sourcePoint
              ? { sourcePoint: opts.connector.sourcePoint }
              : {}),
            ...(opts.connector.targetPoint
              ? { targetPoint: opts.connector.targetPoint }
              : {}),
            routing: opts.connector.routing,
            ...(opts.connector.sourceAnchor
              ? { sourceAnchor: opts.connector.sourceAnchor }
              : {}),
            ...(opts.connector.targetAnchor
              ? { targetAnchor: opts.connector.targetAnchor }
              : {}),
          }
        : opts.childIds
          ? { kind: 'group', childIds: opts.childIds }
          : { kind: opts.kind },
    ),
    now,
    now,
  )
}

board(IDS.canvasBoard, 'E2E Canvas')
board(IDS.canvasViewerBoard, 'E2E Canvas Viewer')
board(IDS.canvasConnectorBoard, 'E2E Canvas Connectors')
board(IDS.canvasGroupBoard, 'E2E Canvas Grouping')
board(IDS.canvasSearchBoard, 'E2E Canvas Search')

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

// A second element and a connector on the VIEWER board, so the read-only gate
// can assert the absence of BOTH quick-create affordances — the four creation
// handles and the routing picker — without needing a second board or a
// share-link round trip.
element({
  id: IDS.canvasViewerConnTarget,
  boardId: IDS.canvasViewerBoard,
  kind: 'rectangle',
  x: 700,
  y: 520,
  w: 200,
  h: 140,
  text: null,
  zIndex: 1,
})
element({
  id: IDS.canvasViewerConnector,
  boardId: IDS.canvasViewerBoard,
  kind: 'connector',
  x: 400,
  y: 370,
  w: 1,
  h: 1,
  text: null,
  zIndex: 2,
  connector: {
    sourceElementId: IDS.canvasViewerRect,
    targetElementId: IDS.canvasViewerConnTarget,
    routing: 'straight',
  },
})

// ── connector board (canvas quick-create-handles, Wave 6) ───────────────────
//
// Two rectangles offset on BOTH axes, joined by one connector. The vertical
// offset is deliberate: between two horizontally-aligned elements an elbow
// degenerates into the same straight horizontal line, so a routing-picker
// test on that layout could not tell the three modes apart at all.
element({
  id: IDS.canvasConnSource,
  boardId: IDS.canvasConnectorBoard,
  kind: 'rectangle',
  x: 300,
  y: 260,
  w: 160,
  h: 120,
  text: null,
  zIndex: 0,
})
element({
  id: IDS.canvasConnTarget,
  boardId: IDS.canvasConnectorBoard,
  kind: 'rectangle',
  x: 700,
  y: 480,
  w: 160,
  h: 120,
  text: null,
  zIndex: 1,
})
element({
  id: IDS.canvasConnector,
  boardId: IDS.canvasConnectorBoard,
  kind: 'connector',
  // The degenerate placeholder the schema's `.positive()` width/height
  // requires and that nothing ever reads — see createCanvasElementSchema.
  x: 380,
  y: 320,
  w: 1,
  h: 1,
  text: null,
  zIndex: 2,
  connector: {
    sourceElementId: IDS.canvasConnSource,
    targetElementId: IDS.canvasConnTarget,
    routing: 'straight',
    // Anchored to the sides a user would have dragged between, so the seeded
    // connector exercises the same path a created one does.
    sourceAnchor: 'right',
    targetAnchor: 'left',
  },
})

// ── grouping board (canvas-element-grouping tactical plan, Wave 8) ─────────
//
// `canvasGroupRectA`/`canvasGroupRectB` side by side, bound into
// `canvasGroup` — the frame is the members' own tight union (A8), stored
// explicitly rather than derived, and its zIndex sits ONE BELOW its lowest
// member's (mirrors `groupSelection`'s own invariant, so hit-testing a
// member does not get shadowed by the group's own frame).
element({
  id: IDS.canvasGroupRectA,
  boardId: IDS.canvasGroupBoard,
  kind: 'rectangle',
  x: 300,
  y: 300,
  w: 150,
  h: 100,
  text: null,
  zIndex: 1,
})
element({
  id: IDS.canvasGroupRectB,
  boardId: IDS.canvasGroupBoard,
  kind: 'rectangle',
  x: 550,
  y: 300,
  w: 150,
  h: 100,
  text: null,
  zIndex: 2,
})
element({
  id: IDS.canvasGroup,
  boardId: IDS.canvasGroupBoard,
  kind: 'group',
  x: 300,
  y: 300,
  w: 400,
  h: 100,
  text: null,
  zIndex: 0,
  childIds: [IDS.canvasGroupRectA, IDS.canvasGroupRectB],
})

// An element OUTSIDE the group, joined to a MEMBER of it — proves a bound
// connector visibly follows when the group (and that member) move.
element({
  id: IDS.canvasGroupExternalRect,
  boardId: IDS.canvasGroupBoard,
  kind: 'rectangle',
  x: 300,
  y: 550,
  w: 150,
  h: 100,
  text: null,
  zIndex: 3,
})
element({
  id: IDS.canvasGroupConnector,
  boardId: IDS.canvasGroupBoard,
  kind: 'connector',
  x: 375,
  y: 400,
  w: 1,
  h: 1,
  text: null,
  zIndex: 4,
  connector: {
    sourceElementId: IDS.canvasGroupRectA,
    targetElementId: IDS.canvasGroupExternalRect,
    routing: 'straight',
  },
})

// A loose (non-member) element, well clear of `canvasGroup`'s frame — the
// drag-into-a-group's-frame membership test's starting point.
element({
  id: IDS.canvasGroupLooseRect,
  boardId: IDS.canvasGroupBoard,
  kind: 'rectangle',
  x: 900,
  y: 300,
  w: 150,
  h: 100,
  text: null,
  zIndex: 5,
})

// A TWO-LEVEL nested group — `canvasGroupOuter` -> `canvasGroupInner` ->
// {canvasGroupInnerA, canvasGroupInnerB} — the one fixture the "ungroup
// dissolves exactly one level" test needs. `canvasGroupOuter`'s frame is the
// SAME rect as `canvasGroupInner`'s (a group containing only one group has
// no wider bounds to unify) — realistic, since `boundsOfMany` on a
// single-group selection always produces exactly this.
element({
  id: IDS.canvasGroupInnerA,
  boardId: IDS.canvasGroupBoard,
  kind: 'rectangle',
  x: 300,
  y: 700,
  w: 120,
  h: 80,
  text: null,
  zIndex: 8,
})
element({
  id: IDS.canvasGroupInnerB,
  boardId: IDS.canvasGroupBoard,
  kind: 'rectangle',
  x: 500,
  y: 700,
  w: 120,
  h: 80,
  text: null,
  zIndex: 9,
})
element({
  id: IDS.canvasGroupInner,
  boardId: IDS.canvasGroupBoard,
  kind: 'group',
  x: 300,
  y: 700,
  w: 320,
  h: 80,
  text: null,
  zIndex: 7,
  childIds: [IDS.canvasGroupInnerA, IDS.canvasGroupInnerB],
})
element({
  id: IDS.canvasGroupOuter,
  boardId: IDS.canvasGroupBoard,
  kind: 'group',
  x: 300,
  y: 700,
  w: 320,
  h: 80,
  text: null,
  zIndex: 6,
  childIds: [IDS.canvasGroupInner],
})

// ── search board (canvas-cmd-k-search-panel tactical plan) ─────────────────
//
// Six labelled/unlabelled elements exercising every rule search-index.ts
// states: one entry per NON-GROUP element with non-empty (trimmed) text, in
// scene order, connectors included. Text is chosen so "alpha" and "beta"
// filter unambiguously across the three result groups (Shapes/Text/
// Connectors) — see e2e/canvas-search.spec.ts.
//
// `canvasSearchRect`/`canvasSearchEllipse`/`canvasSearchText` cluster near
// the origin; `canvasSearchConnTarget`/`canvasSearchConnector` sit well past
// x=3000 so selecting the connector from the board's default camera position
// produces an unmissable pan (the case that only passes because focus
// resolves through `resolvedBounds` — the connector's DRAWN path — rather
// than its 1x1 placeholder).
element({
  id: IDS.canvasSearchRect,
  boardId: IDS.canvasSearchBoard,
  kind: 'rectangle',
  x: 300,
  y: 300,
  w: 200,
  h: 140,
  text: 'alpha crate',
  zIndex: 0,
})
element({
  id: IDS.canvasSearchEllipse,
  boardId: IDS.canvasSearchBoard,
  kind: 'ellipse',
  x: 300,
  y: 520,
  w: 200,
  h: 140,
  text: 'beta sphere',
  zIndex: 1,
})
element({
  id: IDS.canvasSearchText,
  boardId: IDS.canvasSearchBoard,
  kind: 'text',
  x: 300,
  y: 720,
  w: 240,
  h: 48,
  text: 'alpha note',
  zIndex: 2,
})
// Text is NULL — proves an unlabelled shape is not indexed at all, not just
// filtered out of a query.
element({
  id: IDS.canvasSearchUntitled,
  boardId: IDS.canvasSearchBoard,
  kind: 'rectangle',
  x: 600,
  y: 300,
  w: 150,
  h: 100,
  text: null,
  zIndex: 3,
})
element({
  id: IDS.canvasSearchConnTarget,
  boardId: IDS.canvasSearchBoard,
  kind: 'rectangle',
  x: 3200,
  y: 400,
  w: 200,
  h: 140,
  text: 'gamma target',
  zIndex: 4,
})
// The connector's SOURCE is a free point (not an 8th element) — the tactical
// plan enumerates exactly one new element for it (`canvasSearchConnTarget`).
// Both ends still sit past x=3000, well clear of the rect/ellipse/text
// cluster at the origin.
element({
  id: IDS.canvasSearchConnector,
  boardId: IDS.canvasSearchBoard,
  kind: 'connector',
  // The degenerate placeholder — see createCanvasElementSchema's own note;
  // nothing reads it once the connector's real path is derived.
  x: 3050,
  y: 440,
  w: 1,
  h: 1,
  text: 'alpha link',
  zIndex: 5,
  connector: {
    sourcePoint: { x: 2900, y: 470 },
    targetElementId: IDS.canvasSearchConnTarget,
    routing: 'straight',
  },
})

console.log(`[e2e seed-canvas] ok — board ${IDS.canvasBoard}`)

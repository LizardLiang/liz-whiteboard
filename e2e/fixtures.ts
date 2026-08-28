// e2e/fixtures.ts
// Shared constants for the Playwright end-to-end suite. IDs are FIXED (not
// random) so the seed script and the specs agree without passing state
// between the Node (Playwright) and Bun (seed) runtimes.

// Default matches `bun run dev`, which serves Vite on 3000 (server.prod.ts also
// defaults to 3000; server.dev.ts is the separate Socket.IO process on 3010).
// Nothing in this repo serves 3001 — the previous default meant the plain
// `bun run test:e2e` invocation could never satisfy playwright.config.ts's
// webServer health check and died after a 120s timeout that looked like a
// broken suite. The coedit and cimd suites are unaffected: they carry their own
// base URLs (COEDIT_PORT in fixtures-collab.ts, 3099 in playwright.cimd.config.ts).
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export const E2E_USER = {
  username: 'e2e_dogfood',
  email: 'e2e_dogfood@example.com',
  password: 'E2eDogfood123!',
}

/**
 * Account created by the /register half of auth-autofill.spec.ts. It must NOT
 * be seeded — the spec proves registration works when the browser autofills
 * the form, so the account has to be absent at start. e2e/seed-autofill.ts
 * deletes it before each run.
 */
export const E2E_AUTOFILL_USER = {
  username: 'e2e_autofill',
  email: 'e2e_autofill@example.com',
  password: 'E2eAutofill123!',
}

/**
 * Second, VIEWER-role project member (tactical plan: canvas-table-
 * affordances) — distinct from the public/anonymous share-link path
 * (`viewerRole={null}` in share.$token.tsx, which gates BOTH canEdit and
 * canComment to false). A real authenticated `ProjectMember` with role
 * `VIEWER` is the only way to exercise the "viewer+ may comment, editor+
 * may edit/note" permission split (`canComment = hasMinimumRole(role,
 * 'VIEWER')`, `canEdit` requires EDITOR+) — seeded by e2e/seed-stress.ts,
 * logged in via the real /login form (see canvas-affordances.spec.ts's
 * `loginAsViewer` helper, mirroring global-setup.ts's login flow).
 */
export const E2E_VIEWER_USER = {
  username: 'e2e_viewer',
  email: 'e2e_viewer@example.com',
  password: 'E2eViewer123!',
}

// Deterministic, valid-v4-shaped UUIDs (server-fn Zod validates .uuid()).
export const IDS = {
  user: '11111111-1111-4111-8111-111111111111',
  project: '22222222-2222-4222-8222-222222222222',
  whiteboard: '33333333-3333-4333-8333-333333333333',
  usersTable: '44444444-4444-4444-8444-444444444444',
  ordersTable: '55555555-5555-4555-8555-555555555555',
  usersId: '66666666-6666-4666-8666-666666666666',
  usersEmail: '77777777-7777-4777-8777-777777777777',
  ordersId: '88888888-8888-4888-8888-888888888888',
  ordersUserId: '99999999-9999-4999-8999-999999999999',
  relationship: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  area: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',

  // Dedicated board for the multi-select-drag suite (GH #111). That suite
  // MUTATES table positions + area membership and never restores them, so it
  // gets its OWN whiteboard to stay isolation-safe: no earlier spec can
  // perturb its geometry (test 1 depends on pristine positions) and it can
  // pollute no later spec's shared board. Geometry mirrors the primary board.
  mdWhiteboard: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  mdUsersTable: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  mdOrdersTable: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  mdUsersId: '10000000-0000-4000-8000-000000000001',
  mdUsersEmail: '10000000-0000-4000-8000-000000000002',
  mdOrdersId: '10000000-0000-4000-8000-000000000003',
  mdArea: 'ffffffff-ffff-4fff-8fff-ffffffffffff',

  // Dedicated board for the React Flow perf stress fixture (GH #121). Owns a
  // fixed id (distinct from the boards above) so `e2e/seed-stress.ts` can be
  // re-run independently (manual profiling or the perf e2e's own setup)
  // without touching the version-history / multi-select-drag boards.
  stressWhiteboard: '20000000-0000-4000-8000-000000000001',

  // VIEWER-role project member (tactical plan: canvas-table-affordances) —
  // see E2E_VIEWER_USER's comment above for why this is distinct from the
  // public share-link path.
  viewerUser: '30000000-0000-4000-8000-000000000001',

  // Dedicated project/whiteboard/table for the viewer-permission-gate test
  // (tactical plan: canvas-table-affordances) — deliberately NOT the shared
  // `project`/`stressWhiteboard` above. Adding a second ProjectMember row to
  // the shared "E2E Project" pushed the pre-existing Share panel's
  // "Outstanding read-only links" section out of the dialog's viewport in
  // canvas-edit-overlay.spec.ts's own viewer-permission test (that dialog
  // renders every current member as a row) — a real regression, not a
  // flake. A fully separate project keeps this test's fixture data from
  // ever touching another spec's DOM layout.
  viewerProject: '30000000-0000-4000-8000-000000000002',
  viewerWhiteboard: '30000000-0000-4000-8000-000000000003',
  viewerTable: '30000000-0000-4000-8000-000000000004',

  // Dedicated board for the Auto-Layout LOD sizing + minimap z-index e2e
  // (GH #151). Deliberately NOT `stressWhiteboard`: seed-stress.ts hardcodes
  // `DiagramTable.height = 160` for every table, which React Flow applies as
  // an explicit inline CSS height on the node wrapper — pinning
  // `node.measured.height` to a constant regardless of LOD collapse/expand,
  // which masks Bug 1 entirely (verified empirically — the wrapper's
  // rendered height never changed across the LOD threshold on that board).
  // Real user-created tables never persist a height (`diagram-table.ts`
  // defaults to `null`; `convert-to-nodes.ts` then leaves `node.height`
  // `undefined`), so the wrapper auto-sizes to content and DOES shrink/grow
  // with LOD — e2e/seed-autolayout.ts reproduces that by seeding NULL
  // heights.
  autoLayoutWhiteboard: '40000000-0000-4000-8000-000000000001',

  // Dedicated project/board for the shapes-and-connectors suite (Phase 1).
  // Isolated on purpose (Artemis's recommendation): this suite draws,
  // moves, resizes, deletes, and — in the legacy-snapshot-restore case
  // (E2E-20) — WIPES EVERY SHAPE on the board via a version restore.
  // Running any of that against the shared `IDS.whiteboard` risks leftover
  // nodes leaking into another spec's DOM assertions, or a wholesale wipe
  // interacting badly with a spec that assumes a stable shape count.
  // A dedicated project (not just a dedicated whiteboard) avoids reproducing
  // the Share-panel member-list layout regression documented on
  // `viewerProject` above — this suite adds its own ADMIN+VIEWER membership
  // pair without touching any other project's member list.
  shapesProject: '50000000-0000-4000-8000-000000000001',
  shapesWhiteboard: '50000000-0000-4000-8000-000000000002',
  rectShape: '50000000-0000-4000-8000-000000000003',
  ellipseShape: '50000000-0000-4000-8000-000000000004',
  diamondShape: '50000000-0000-4000-8000-000000000005',
  textShape: '50000000-0000-4000-8000-000000000006',
  lineShape: '50000000-0000-4000-8000-000000000007',
  shapeConnector: '50000000-0000-4000-8000-000000000008',
  legacySnapshot: '50000000-0000-4000-8000-000000000009',
  // A regular ER table pair + relationship on shapesWhiteboard, positioned
  // well clear of the shape cluster (x:900-1300) — FR-016's in-drag
  // refusal (E2E-12) and FR-017's "existing table-to-table flow unaffected"
  // regression check (E2E-14) both need a real table-to-table connection
  // living alongside shapes on the SAME board, under the shared
  // `isValidConnection` predicate.
  shapesTableA: '50000000-0000-4000-8000-00000000000a',
  shapesTableB: '50000000-0000-4000-8000-00000000000b',
  shapesTableAId: '50000000-0000-4000-8000-00000000000c',
  shapesTableBFk: '50000000-0000-4000-8000-00000000000d',
  shapesTableRelationship: '50000000-0000-4000-8000-00000000000e',
  // A second, currently-UNCONNECTED column pair on the same two tables
  // (E2E-14) — the seeded relationship above already binds the first
  // column pair, so dragging a NEW connection needs a pair with no
  // pre-existing edge between them (mirrors seed-stress.ts's own
  // index-1-is-always-unconnected convention).
  // Dedicated project/boards for the FigJam canvas-engine suite (Wave 5).
  // Isolated for the same reason the shapes suite is: canvas-board.spec.ts
  // draws, moves, resizes and DELETES elements, and re-seeds before every
  // test. A dedicated project (not just a dedicated board) also keeps its
  // ADMIN+VIEWER membership pair out of every other project's member list —
  // see `viewerProject` above for the Share-panel layout regression that
  // adding a member to a shared project caused.
  canvasProject: '60000000-0000-4000-8000-000000000001',
  canvasBoard: '60000000-0000-4000-8000-000000000002',
  canvasRect: '60000000-0000-4000-8000-000000000003',
  canvasText: '60000000-0000-4000-8000-000000000004',
  // Second board, VIEWER-visible only, for the read-only gate. Separate from
  // `canvasBoard` so the read-only assertions never race the mutating tests
  // that share a board.
  canvasViewerBoard: '60000000-0000-4000-8000-000000000005',
  canvasViewerRect: '60000000-0000-4000-8000-000000000006',
  // Third board, for the quick-create-handles suite's cases that need a
  // connector to ALREADY exist (the routing picker, and "the line follows a
  // dragged endpoint"). Separate from `canvasBoard` so those tests cannot
  // perturb the element counts the create/delete tests on that board assert
  // against, and so a connector never appears in a scene an older canvas spec
  // was written before connectors existed.
  canvasConnectorBoard: '60000000-0000-4000-8000-000000000007',
  canvasConnSource: '60000000-0000-4000-8000-000000000008',
  canvasConnTarget: '60000000-0000-4000-8000-000000000009',
  canvasConnector: '60000000-0000-4000-8000-00000000000a',
  // A connector on the VIEWER board too, so the read-only gate can assert the
  // absence of BOTH affordances (handles and routing bar) on one board.
  canvasViewerConnTarget: '60000000-0000-4000-8000-00000000000b',
  canvasViewerConnector: '60000000-0000-4000-8000-00000000000c',
  shapesTableAName: '50000000-0000-4000-8000-00000000000f',
  shapesTableBNote: '50000000-0000-4000-8000-000000000010',

  // Dedicated board for the relationship-deletion regression suite. Own
  // board for the same reason `mdWhiteboard` has one: that spec DRAGS a
  // table (the resurrection trigger it exists to guard against) and never
  // restores the position, so running it against the shared `IDS.whiteboard`
  // would perturb every later spec that assumes pristine geometry there. It
  // reuses `IDS.project` rather than creating one — it adds no new member, so
  // the Share-panel member-list layout regression documented on
  // `viewerProject` above cannot apply.
  relDelWhiteboard: '70000000-0000-4000-8000-000000000001',
  relDelUsersTable: '70000000-0000-4000-8000-000000000002',
  relDelOrdersTable: '70000000-0000-4000-8000-000000000003',
  relDelUsersId: '70000000-0000-4000-8000-000000000004',
  relDelOrdersId: '70000000-0000-4000-8000-000000000005',
  relDelOrdersUserId: '70000000-0000-4000-8000-000000000006',
  relDelRelationship: '70000000-0000-4000-8000-000000000007',
}

export const STORAGE_STATE = 'e2e/.auth/state.json'

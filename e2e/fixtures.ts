// e2e/fixtures.ts
// Shared constants for the Playwright end-to-end suite. IDs are FIXED (not
// random) so the seed script and the specs agree without passing state
// between the Node (Playwright) and Bun (seed) runtimes.

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001'

export const E2E_USER = {
  username: 'e2e_dogfood',
  email: 'e2e_dogfood@example.com',
  password: 'E2eDogfood123!',
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
}

export const STORAGE_STATE = 'e2e/.auth/state.json'

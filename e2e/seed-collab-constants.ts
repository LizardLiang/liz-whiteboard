// e2e/seed-collab-constants.ts
// Node-safe constants shared between e2e/seed-collab.ts (run under Bun — it
// imports 'bun:sqlite') and Playwright's Node-based config/spec/globalSetup
// loader (GH #125: e2e/global-setup-collab.ts, e2e/coedit-table-create.spec.ts).
//
// IMPORTANT: keep this file free of any 'bun:sqlite' (or other Bun-only)
// import. Playwright's own TS loader runs these files under real Node, not
// Bun — statically importing a module that top-level-imports 'bun:sqlite'
// crashes Node's ESM loader with "Only URLs with a scheme in: file, data, and
// node are supported" (Node has no 'bun:' scheme handler). e2e/seed-collab.ts
// is only ever *executed* via `bun run e2e/seed-collab.ts` (shelled out to
// from global-setup-collab.ts, mirroring e2e/global-setup.ts's seed.ts
// pattern) — it must never be statically imported from a Playwright
// config/spec/globalSetup file.

// Fixed IDs so re-runs clean up deterministically (kept alongside the
// constants below so seed-collab.ts and this file stay in sync).
export const COLLAB_ID = {
  alice: 'c0114b00-0000-4000-8000-000000000a11',
  bob: 'c0114b00-0000-4000-8000-000000000b0b',
  carol: 'c0114b00-0000-4000-8000-00000000ca01',
  project: 'c0114b00-0000-4000-8000-0000000452c7',
  whiteboard: 'c0114b00-0000-4000-8000-000000000ed1',
  usersTable: 'c0114b00-0000-4000-8000-000000075b11',
  ordersTable: 'c0114b00-0000-4000-8000-0000000000d5',
  usersId: 'c0114b00-0000-4000-8000-0000000c0101',
  usersEmail: 'c0114b00-0000-4000-8000-0000000c0102',
  ordersId: 'c0114b00-0000-4000-8000-0000000c0201',
  ordersUserId: 'c0114b00-0000-4000-8000-0000000c0202',
} as const

export const COLLAB_USERS = [
  {
    id: COLLAB_ID.alice,
    username: 'alice_collab',
    email: 'alice@collab.test',
    role: 'OWNER',
  },
  {
    id: COLLAB_ID.bob,
    username: 'bob_collab',
    email: 'bob@collab.test',
    role: 'EDITOR',
  },
  {
    id: COLLAB_ID.carol,
    username: 'carol_collab',
    email: 'carol@collab.test',
    role: 'EDITOR',
  },
] as const

export const COLLAB_PASSWORD = 'CoEdit123!'
export const COLLAB_WHITEBOARD_ID = COLLAB_ID.whiteboard

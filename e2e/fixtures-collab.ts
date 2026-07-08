// e2e/fixtures-collab.ts
// Shared constants for the prod-build co-editing suite (GH #125:
// e2e/coedit-table-create.spec.ts). Kept separate from e2e/fixtures.ts (which
// backs the dev-server suite) since this suite targets a different server
// process on a different port — see playwright.coedit.config.ts.

export const COEDIT_PORT = process.env.E2E_PROD_PORT ?? '3210'
export const COEDIT_BASE_URL =
  process.env.E2E_PROD_BASE_URL ?? `http://localhost:${COEDIT_PORT}`

export const COEDIT_ALICE_STORAGE_STATE = 'e2e/.auth/collab-alice.json'
export const COEDIT_BOB_STORAGE_STATE = 'e2e/.auth/collab-bob.json'

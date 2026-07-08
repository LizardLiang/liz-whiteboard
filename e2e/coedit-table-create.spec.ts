// e2e/coedit-table-create.spec.ts
// GH #125: new-table creation now syncs LIVE to co-editing peers. Run against
// playwright.coedit.config.ts (the PROD build) — dev's Vite/server.dev.ts
// split leaves Socket.IO's `io` null in the Vite process, so the live
// broadcast this spec exists to prove would silently no-op there (see
// playwright.coedit.config.ts's header comment).
//
// Two editors (alice, bob — e2e/seed-collab.ts) share one whiteboard, each in
// their own already-open browser context. Alice creates a table via the
// toolbar; bob's canvas must show it WITHOUT reloading — proving the
// table:created broadcast reaches the working collaboration-hook path
// (use-whiteboard-collaboration.ts's table:created effect +
// ReactFlowWhiteboard.tsx's handleTableCreated), not merely that the write
// persisted to the database (whiteboard-crud.spec.ts already covers
// persistence-via-reload against the dev server).
import { expect, test } from '@playwright/test'
import {
  COEDIT_ALICE_STORAGE_STATE,
  COEDIT_BASE_URL,
  COEDIT_BOB_STORAGE_STATE,
} from './fixtures-collab'
// Imported from seed-collab-constants (not seed-collab.ts directly) — see
// e2e/global-setup-collab.ts's header comment: seed-collab.ts top-level
// imports 'bun:sqlite', which crashes Playwright's Node-based spec loader.
import { COLLAB_WHITEBOARD_ID } from './seed-collab-constants'

const WB_URL = `/whiteboard/${COLLAB_WHITEBOARD_ID}`

test('a peer sees a newly-created table live, without reloading', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_ALICE_STORAGE_STATE,
  })
  const bobContext = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_BOB_STORAGE_STATE,
  })

  try {
    const alicePage = await aliceContext.newPage()
    const bobPage = await bobContext.newPage()

    await alicePage.goto(WB_URL)
    await expect(
      alicePage.getByRole('heading', { name: 'Team ERD' }),
    ).toBeVisible()
    await expect(
      alicePage
        .locator('.react-flow')
        .getByText('users', { exact: true })
        .first(),
    ).toBeVisible()

    await bobPage.goto(WB_URL)
    await expect(
      bobPage.getByRole('heading', { name: 'Team ERD' }),
    ).toBeVisible()
    await expect(
      bobPage
        .locator('.react-flow')
        .getByText('users', { exact: true })
        .first(),
    ).toBeVisible()

    const tableName = `coedit_live_${Date.now()}`

    // Alice creates a new table via the toolbar (mirrors whiteboard-crud.spec.ts).
    await alicePage.getByRole('button', { name: 'Add Table' }).click()
    await expect(
      alicePage.getByRole('heading', { name: 'Create Table' }),
    ).toBeVisible()
    await alicePage.getByPlaceholder('e.g., Users').fill(tableName)
    await alicePage.getByRole('button', { name: 'Create Table' }).click()
    await expect(
      alicePage.locator('.react-flow__node').filter({ hasText: tableName }),
    ).toBeVisible()

    // Bob — WITHOUT reloading — must see the table appear on his own canvas.
    // This is the crux of #125: it proves the table:created broadcast is
    // applied live through the working collaboration-hook path.
    await expect(
      bobPage.locator('.react-flow__node').filter({ hasText: tableName }),
    ).toBeVisible({ timeout: 10_000 })
  } finally {
    await aliceContext.close()
    await bobContext.close()
  }
})

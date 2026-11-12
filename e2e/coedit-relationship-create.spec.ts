// e2e/coedit-relationship-create.spec.ts
// A new relationship syncs LIVE to co-editing peers — the relationship
// sibling of GH #125 (e2e/coedit-table-create.spec.ts). Run against
// playwright.coedit.config.ts (the PROD build): dev's Vite/server.dev.ts split
// leaves Socket.IO's `io` null in the Vite process, so a server-side broadcast
// would silently no-op there.
//
// Two editors (alice, bob — e2e/seed-collab.ts) share the "Team ERD" board,
// which seeds `users` and `orders` with no relationship between them. Alice
// links orders.user_id -> users.id through the toolbar dialog. Bob's canvas
// must draw the new line WITHOUT reloading. After both reload, each must see
// exactly ONE line with that label: a second copy would mean the create was
// persisted twice.
import { expect, test } from '@playwright/test'
import {
  COEDIT_ALICE_STORAGE_STATE,
  COEDIT_BASE_URL,
  COEDIT_BOB_STORAGE_STATE,
} from './fixtures-collab'
// Imported from seed-collab-constants (not seed-collab.ts directly):
// seed-collab.ts top-level imports 'bun:sqlite', which crashes Playwright's
// Node-based spec loader.
import { COLLAB_WHITEBOARD_ID } from './seed-collab-constants'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${COLLAB_WHITEBOARD_ID}`

async function openBoard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'Team ERD' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // The live broadcast travels over the whiteboard Socket.IO connection,
  // which comes up after the board mounts. Until it does, a peer cannot
  // receive anything — waiting here keeps the assertion about the broadcast,
  // not about connection timing.
  await expect(page.getByText(/^(Reconnecting|Disconnected) —/)).toHaveCount(0)
}

async function pick(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

function edgeLabel(page: Page, label: string) {
  return page.locator('.react-flow').getByText(label, { exact: true })
}

test('a peer sees a newly-created relationship live, without reloading', async ({
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

    await openBoard(alicePage)
    await openBoard(bobPage)

    const label = `coedit_rel_${Date.now()}`
    await expect(edgeLabel(bobPage, label)).toHaveCount(0)

    // Alice creates the relationship through the real toolbar dialog.
    await alicePage.getByRole('button', { name: 'Add Relationship' }).click()
    await expect(
      alicePage.getByRole('heading', { name: 'Create Relationship' }),
    ).toBeVisible()
    await pick(alicePage, 'source-table', 'orders')
    await pick(alicePage, 'source-column', 'user_id (UUID)')
    await pick(alicePage, 'target-table', 'users')
    await pick(alicePage, 'target-column', 'id (UUID)')
    await alicePage.locator('#rel-label').fill(label)
    await alicePage
      .getByRole('dialog')
      .getByRole('button', { name: 'Create Relationship' })
      .click()
    await expect(edgeLabel(alicePage, label)).toBeVisible()

    // Bob — WITHOUT reloading — must see the new line on his own canvas.
    await expect(edgeLabel(bobPage, label)).toBeVisible({ timeout: 10_000 })

    // Exactly one relationship was persisted: a reload reads the database,
    // so a second row from a re-submitted create would show as a second line.
    await bobPage.reload()
    await openBoard(bobPage)
    await expect(edgeLabel(bobPage, label)).toHaveCount(1)
    await alicePage.reload()
    await openBoard(alicePage)
    await expect(edgeLabel(alicePage, label)).toHaveCount(1)
  } finally {
    await aliceContext.close()
    await bobContext.close()
  }
})

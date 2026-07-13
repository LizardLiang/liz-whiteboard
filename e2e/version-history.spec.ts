// e2e/version-history.spec.ts
// End-to-end coverage for whiteboard version history / snapshots (GH #107):
// save a version, see it listed with author, preview it read-only, and restore
// it non-destructively. Auth + seed data come from global-setup (storageState).
//
// Restore's LIVE cross-client refresh (AC5) is intentionally NOT asserted here:
// it depends on the single-process prod server (see playwright.config.ts note).
// We assert restore CORRECTNESS by reloading and checking the diagram content.
import {  expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type {Page} from '@playwright/test';

// Canvas is unconditional (canvas-unconditional-default) — no `?canvas` opt
// out. That applies window-wide, so the read-only preview dialog's own
// nested ReactFlowWhiteboard instance (WhiteboardHistoryPanel.tsx) is also
// canvas-mode now — this spec asserts restored/previewed content via
// `tableNode()` (data-table-name), not DOM text.
const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  // Canvas ready: the seeded "users" table's chrome-light DOM node exists.
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

async function openHistoryPanel(page: Page) {
  await page.getByRole('button', { name: 'Version history' }).click()
  await expect(
    page.getByRole('heading', { name: 'Version History' }),
  ).toBeVisible()
}

test.describe('Whiteboard version history (GH #107)', () => {
  test('save → list → preview a version', async ({ page }) => {
    await openWhiteboard(page)
    await openHistoryPanel(page)

    // Empty state before saving.
    await expect(page.getByText('No versions saved yet.')).toBeVisible()

    // AC1 — save a labelled version.
    const label = 'E2E baseline'
    await page.getByRole('textbox', { name: 'Version label' }).fill(label)
    await page.getByRole('button', { name: 'Save version' }).click()
    await expect(page.getByText('Version saved')).toBeVisible()

    // AC2 — appears in the list with the author name (seeded user).
    const item = page
      .getByRole('list', { name: 'Version list' })
      .getByRole('button', { name: new RegExp(label) })
    await expect(item).toBeVisible()
    await expect(item).toContainText('e2e_dogfood')

    // AC3 — preview renders the snapshot read-only, showing both tables.
    await item.click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Read-only preview' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.locator('[data-table-name="users"]').first(),
    ).toBeVisible()
    await expect(
      dialog.locator('[data-table-name="orders"]').first(),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Restore this version' }),
    ).toBeVisible()

    // Dismiss the preview (the Dialog has both a footer "Close" and the shadcn
    // built-in X — press Escape rather than disambiguate).
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('restore brings back deleted content (non-destructive)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await openHistoryPanel(page)

    // Save a version to restore to.
    await page.getByRole('textbox', { name: 'Version label' }).fill('Before delete')
    await page.getByRole('button', { name: 'Save version' }).click()
    await expect(page.getByText('Version saved')).toBeVisible()

    // Close the panel and delete the "orders" table (a live change). Chrome-
    // light strips the hover-revealed header delete button — the canvas path
    // is right-click → "Delete table" (TableNodeContextMenu).
    await page.keyboard.press('Escape')
    const ordersNode = tableNode(page, 'orders').first()
    await ordersNode.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    // NOT exact: the menuitem's accessible name includes its "Del" shortcut
    // ("Delete tableDel"), so an exact 'Delete table' matches nothing.
    await page.getByRole('menuitem', { name: 'Delete table' }).click()
    await page.getByRole('button', { name: 'Delete table', exact: true }).click()
    // orders is gone from the live canvas.
    await expect(tableNode(page, 'orders')).toHaveCount(0)

    // Restore the saved version via the preview dialog.
    await openHistoryPanel(page)
    await page
      .getByRole('list', { name: 'Version list' })
      .getByRole('button', { name: /Before delete/ })
      .click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Read-only preview' })
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    await expect(page.getByText('Version restored')).toBeVisible()

    // AC4 — after a reload the restored diagram is intact (orders is back).
    // (Reload rather than relying on the dev-only live broadcast — see config.)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(tableNode(page, 'orders').first()).toBeVisible()
    await expect(tableNode(page, 'users').first()).toBeVisible()

    // AC4a — a non-destructive "Auto-saved before restore" snapshot now exists.
    await openHistoryPanel(page)
    await expect(
      page
        .getByRole('list', { name: 'Version list' })
        .getByRole('button', { name: /Auto-saved before restore/ }),
    ).toBeVisible()
  })
})

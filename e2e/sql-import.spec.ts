// e2e/sql-import.spec.ts
// End-to-end coverage for "Import SQL" (Issue #105): open the dialog, paste
// CREATE TABLE DDL, see the live parse preview (table/column/relationship
// counts), import, and confirm the generated tables land on the canvas and
// persist across a reload. Auth + seed data come from global-setup
// (storageState). Persistence — not the dev-only live broadcast — is the
// contract asserted (see playwright.config.ts's two-process note).
//
// The imported tables use e2e_-prefixed names so they never collide with the
// seeded users/orders board, and they are cleaned up at the end so the shared
// board is left as it was found (global-setup also re-seeds every run).
import {  expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type {Page} from '@playwright/test';

// Canvas is unconditional (canvas-unconditional-default) — no `?canvas` opt
// out. Table text is painted on <canvas>, not DOM, so this spec asserts
// imported tables via `tableNode()` (data-table-name).
const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

function nodeByName(page: Page, name: string) {
  return tableNode(page, name).first()
}

// Chrome-light strips the hover-revealed header delete button — the canvas
// path is right-click → "Delete table" (TableNodeContextMenu), which mirrors
// the same `onRequestTableDelete` handler + confirmation dialog the full-DOM
// header button used.
async function deleteTable(page: Page, name: string) {
  const node = nodeByName(page, name)
  if ((await node.count()) === 0) return
  await node.dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
  // NOT exact: the menuitem's accessible name includes its "Del" shortcut
  // ("Delete tableDel"), so an exact 'Delete table' matches nothing.
  await page.getByRole('menuitem', { name: 'Delete table' }).click()
  await page.getByRole('button', { name: 'Delete table', exact: true }).click()
  await expect(tableNode(page, name)).toHaveCount(0)
}

// Two related tables so the parser also produces a relationship (FK) — this
// exercises the columns + relationship code paths in one import.
const DDL = `CREATE TABLE e2e_products (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price INT
);
CREATE TABLE e2e_orders_line (
  id UUID PRIMARY KEY,
  product_id UUID REFERENCES e2e_products(id)
);`

test.describe('Import SQL (Issue #105)', () => {
  test('paste DDL → preview counts → import → tables render and persist', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await page.getByRole('button', { name: 'Import SQL' }).click()
    await expect(page.getByRole('heading', { name: 'Import SQL' })).toBeVisible()

    // Dialect defaults to PostgreSQL; paste the DDL and wait for the debounced
    // (300ms) live preview to report what it parsed.
    await page.locator('#import-sql-text').fill(DDL)
    await expect(page.getByText(/2 tables,\s*5 columns/)).toBeVisible()
    // The FK REFERENCES clause becomes one relationship.
    await expect(page.getByText(/1 relationship\b/)).toBeVisible()

    await page.getByRole('button', { name: 'Import', exact: true }).click()

    // Both generated tables appear on the canvas.
    await expect(nodeByName(page, 'e2e_products')).toBeVisible()
    await expect(nodeByName(page, 'e2e_orders_line')).toBeVisible()

    // Persistence across reload (server-side write).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(nodeByName(page, 'e2e_products')).toBeVisible()
    await expect(nodeByName(page, 'e2e_orders_line')).toBeVisible()

    // Clean up — remove the imported tables so the shared board is pristine.
    // Delete the FK child first to avoid any dangling-relationship UI state.
    await deleteTable(page, 'e2e_orders_line')
    await deleteTable(page, 'e2e_products')
  })
})

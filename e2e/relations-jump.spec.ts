// e2e/relations-jump.spec.ts
// End-to-end coverage for "jump to a related table" from the relations-preview
// panel (GH #138): clicking or keyboard-activating a related-tables panel row
// pans/zooms the live canvas to that table (reusing the search-palette focus
// pipeline — fitView + active-highlight) and re-anchors the panel itself to
// the target table. Auth + seed data come from global-setup (storageState);
// the seeded board (IDS.whiteboard) already joins usersTable <-> ordersTable
// via IDS.relationship — no new seed required. Mirrors the helpers/pattern in
// e2e/relations-preview.spec.ts (GH #134/#135).
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Locator, Page } from '@playwright/test'

// Canvas is unconditional (canvas-unconditional-default) — no `?canvas` opt
// out. A chrome-light table has no DOM relations trigger button, so the
// panel is opened via right-click → "Show relations" (TableNodeContextMenu).
// Opening it forces that ONE table to its full-DOM render (TableNode.tsx's
// `isNotOverlayTarget` now also exempts a table with its relations panel
// open — see implementation-notes.md deviation), which is what mounts
// `table-relations-trigger`/`table-relations-panel`. The jump target
// (`relationsPreviewTableId` reassigns atomically — ReactFlowWhiteboard's
// `handleJumpToRelatedTable`) gets the SAME exemption once the jump lands,
// so its own panel/trigger mount too.
const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  // Canvas ready: the seeded "users" table's chrome-light DOM node exists.
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

function usersNode(page: Page) {
  return tableNode(page, 'users').first()
}

function ordersNode(page: Page) {
  return tableNode(page, 'orders').first()
}

/** Open a table's relations panel via right-click → "Show relations" — the
 * canvas-native entry point (mirrors relations-preview.spec.ts's identical
 * helper). */
async function openRelationsViaContextMenu(node: Locator) {
  await node.dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
  // NOT exact: the menuitem's accessible name includes its "R" keyboard
  // shortcut ("Show relationsR"), so an exact 'Show relations' matches nothing.
  await node.page().getByRole('menuitem', { name: 'Show relations' }).click()
}

function relationsPanel(page: Page) {
  return page.getByTestId('table-relations-panel')
}

function viewportTransform(page: Page) {
  return page.locator('.react-flow__viewport').getAttribute('style')
}

// Polls the viewport's inline `style` (which carries the `transform`) until
// it differs from `before` — React Flow commits the fitView-driven pan/zoom
// transform asynchronously (animated over `duration: 300`), so a single
// synchronous read right after the click/keypress can race the bug this test
// guards against.
async function expectViewportTransformChanged(page: Page, before: string | null) {
  await expect
    .poll(() => viewportTransform(page), { timeout: 10_000 })
    .not.toBe(before)
}

test.describe('Jump to related table from the relations panel (GH #138)', () => {
  test('click a related-table row pans the canvas, re-anchors the panel, and highlights the target (RJ-1)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Open the relations panel on `users` and confirm it lists `orders`.
    await openRelationsViaContextMenu(usersNode(page))
    await expect(relationsPanel(page)).toBeVisible()
    await expect(relationsPanel(page)).toContainText('orders')

    const before = await viewportTransform(page)

    // Click the `orders` row inside the (still users-anchored) panel.
    await relationsPanel(page)
      .getByTestId('relations-panel-row')
      .filter({ hasText: 'orders' })
      .click()

    // Viewport recentered — fitView's animated transform must change.
    await expectViewportTransformChanged(page, before)

    // Panel re-anchored to `orders`: the table-relations-panel is now
    // rendered inside the orders node (not the users node) and lists
    // `users` as its related row.
    await expect(
      relationsPanel(page),
    ).toBeVisible()
    await expect(
      relationsPanel(page),
    ).toContainText('users')

    // Target indicated: orders node carries the persistent active-highlight
    // class directly (driven by isActiveHighlighted via the reused
    // search-palette focus pipeline) — `tableNode()` resolves straight to
    // that element (both chrome-light and full-DOM roots carry
    // `data-table-name`), so assert the class on it, not a descendant.
    await expect(ordersNode(page)).toHaveClass(/active-highlighted/)
  })

  test('keyboard activation (Enter) on a related-table row performs the same jump (RJ-2)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await openRelationsViaContextMenu(usersNode(page))
    await expect(relationsPanel(page)).toBeVisible()
    await expect(relationsPanel(page)).toContainText('orders')

    const before = await viewportTransform(page)

    const ordersRow = relationsPanel(page)
      .getByTestId('relations-panel-row')
      .filter({ hasText: 'orders' })
    await ordersRow.focus()
    await page.keyboard.press('Enter')

    await expectViewportTransformChanged(page, before)

    await expect(
      relationsPanel(page),
    ).toBeVisible()
    await expect(
      relationsPanel(page),
    ).toContainText('users')
    await expect(ordersNode(page)).toHaveClass(/active-highlighted/)
  })
})

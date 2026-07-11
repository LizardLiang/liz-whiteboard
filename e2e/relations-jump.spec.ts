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
import type { Locator, Page } from '@playwright/test'

// ?canvas=0 forces full-DOM table rendering: canvas is now the default
// (migration Phase 5), and this spec asserts DOM table content.
const WB_URL = `/whiteboard/${IDS.whiteboard}?canvas=0`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  // Canvas ready: the react-flow pane has rendered the seeded tables.
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
}

function usersNode(page: Page) {
  return page
    .locator('.react-flow__node')
    .filter({ hasText: 'users' })
    .first()
}

function ordersNode(page: Page) {
  return page
    .locator('.react-flow__node')
    .filter({ hasText: 'orders' })
    .first()
}

function relationsTrigger(node: Locator) {
  return node.getByTestId('table-relations-trigger')
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
    await relationsTrigger(usersNode(page)).click()
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
      ordersNode(page).getByTestId('table-relations-panel'),
    ).toBeVisible()
    await expect(
      ordersNode(page).getByTestId('table-relations-panel'),
    ).toContainText('users')

    // Target indicated: orders node carries the persistent active-highlight
    // (applied to the inner .react-flow__node-erTable element, driven by
    // isActiveHighlighted via the reused search-palette focus pipeline).
    await expect(
      ordersNode(page).locator('.active-highlighted'),
    ).toHaveCount(1)
  })

  test('keyboard activation (Enter) on a related-table row performs the same jump (RJ-2)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await relationsTrigger(usersNode(page)).click()
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
      ordersNode(page).getByTestId('table-relations-panel'),
    ).toBeVisible()
    await expect(
      ordersNode(page).getByTestId('table-relations-panel'),
    ).toContainText('users')
    await expect(
      ordersNode(page).locator('.active-highlighted'),
    ).toHaveCount(1)
  })
})

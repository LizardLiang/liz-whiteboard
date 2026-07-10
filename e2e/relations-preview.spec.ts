// e2e/relations-preview.spec.ts
// End-to-end regression coverage for the relations-preview panel (GH #134):
// clicking the Link2 trigger on a table opens the "Related tables" panel and
// keeps it open across an unrelated parent node re-sync (drag, refetch,
// callback re-injection, etc). Auth + seed data come from global-setup
// (storageState); the seeded board (IDS.whiteboard) already joins
// usersTable <-> ordersTable via IDS.relationship — no new seed required.
//
// Root cause (see .claude/.Arena/tactical-plans/134-relations-preview-fix.md):
// ReactFlowCanvas's initialNodes-sync effect used to blindly `setNodes(
// initialNodes)` on every parent re-push, clobbering the client-only
// `isRelationsPreviewOpen` flag back to false because the parent's source
// nodes never carry it. Test case 2 below is the guard that actually catches
// this: it forces a re-sync (dragging the table, which round-trips through
// the parent's position-persist -> re-push) while the panel is open and
// asserts it survives.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

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

function relationsTrigger(page: Page) {
  return usersNode(page).getByTestId('table-relations-trigger')
}

function relationsPanel(page: Page) {
  return page.getByTestId('table-relations-panel')
}

function ordersNode(page: Page) {
  return page
    .locator('.react-flow__node')
    .filter({ hasText: 'orders' })
    .first()
}

test.describe('Relations preview panel (GH #134)', () => {
  test('opens on click and lists the related table (RP-1)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await relationsTrigger(page).click()

    await expect(relationsTrigger(page)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(relationsPanel(page)).toBeVisible()
    await expect(relationsPanel(page)).toContainText('orders')
  })

  test('stays open across a parent node re-sync (RP-3 regression guard)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await relationsTrigger(page).click()
    await expect(relationsTrigger(page)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(relationsPanel(page)).toBeVisible()

    // Force a parent node re-sync: dragging the table fires onNodeDragStop,
    // which persists the new position and round-trips through the parent's
    // own `nodes` state, re-pushing `initialNodes` into ReactFlowCanvas and
    // firing the sync effect under test. Against unfixed code this clobbers
    // isRelationsPreviewOpen back to false and the panel disappears; with
    // the fix (calculateHighlighting re-applied on every sync) it survives.
    const node = usersNode(page)
    const box = await node.boundingBox()
    if (!box) throw new Error('users table node not found for drag')
    const startX = box.x + box.width / 2
    const startY = box.y + 10 // header area, avoids grabbing a column row
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 40, startY + 40, { steps: 5 })
    await page.mouse.up()

    // The panel and the trigger's pressed state must survive the re-sync.
    // NOTE: GH #135 fixed content preservation across this same re-sync — the
    // preserve branch of ReactFlowWhiteboard's initialNodes-sync effect
    // (L573+) now re-injects `edges`/`relationsEdges` from the canonical
    // refs, so the panel's related-table list no longer empties.
    await expect(relationsTrigger(page)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(relationsPanel(page)).toBeVisible()
    // #135: panel content (1-hop neighbor list) must survive the re-sync too,
    // not just the open flag — the preserve branch now carries relationsEdges.
    await expect(relationsPanel(page)).toContainText('orders')
  })

  test('drag survives an immediate table-select click (BLOCKER regression, review of #134)', async ({
    page,
  }) => {
    // Guards the review BLOCKER on the #134 fix: the initialNodes-sync effect
    // in ReactFlowCanvas.tsx used to depend on [activeTableId,
    // relationsPreviewTableId] in addition to initialNodes, so clicking a
    // different table re-fired it. Single-table drag
    // (ReactFlowWhiteboard.tsx) is non-optimistic — it only patches
    // `initialNodes` once the position mutation's onSuccess round-trips — so
    // a re-fire in that window rebuilt every node from the still-stale
    // `initialNodes` prop, snapping the just-dragged table back to its
    // pre-drag position. The fix reads activeTableId/relationsPreviewTableId
    // via ref instead, so this effect fires ONLY on a genuine initialNodes
    // re-push and a table-select click can never trigger it — this test
    // asserts the dragged position holds regardless of the mutation's
    // round-trip timing, so it is not a race against the network.
    await openWhiteboard(page)

    const dragTarget = usersNode(page)
    const startBox = await dragTarget.boundingBox()
    if (!startBox) throw new Error('users table node not found for drag')
    const startX = startBox.x + startBox.width / 2
    const startY = startBox.y + 10 // header area, avoids grabbing a column row
    const dx = 40
    const dy = 40

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx, startY + dy, { steps: 5 })
    await page.mouse.up()

    // Immediately select a different table — before the drag's position
    // mutation can plausibly have round-tripped. `force: true` bypasses the
    // edge-label overlay that sits above part of the node (unrelated to what
    // this test guards).
    await ordersNode(page).click({ position: { x: 10, y: 10 }, force: true })

    // Poll rather than a single boundingBox read: React Flow commits the
    // drag's own position update to the DOM asynchronously, so reading
    // immediately after the click can race that unrelated render — not the
    // bug under test. Must reflect the drag offset, not have snapped back to
    // the start position; assert against the midpoint (not the exact delta)
    // to tolerate any React Flow snapping/measurement rounding.
    await expect
      .poll(async () => (await dragTarget.boundingBox())?.x)
      .toBeGreaterThan(startBox.x + dx / 2)
    await expect
      .poll(async () => (await dragTarget.boundingBox())?.y)
      .toBeGreaterThan(startBox.y + dy / 2)
  })

  test('toggles off on second click', async ({ page }) => {
    await openWhiteboard(page)

    await relationsTrigger(page).click()
    await expect(relationsTrigger(page)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(relationsPanel(page)).toBeVisible()

    await relationsTrigger(page).click()

    await expect(relationsTrigger(page)).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(relationsPanel(page)).toBeHidden()
  })
})

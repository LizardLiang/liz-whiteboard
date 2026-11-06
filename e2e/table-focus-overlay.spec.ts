// e2e/table-focus-overlay.spec.ts
// Regression coverage for the table Focus overlay (`f` on a selected table):
// the focal table and its 1-hop neighbors must be visible inside the overlay's
// viewport once the overlay's compact layout has run.
//
// Root cause: the overlay's sub-canvas only ran React Flow's built-in mount
// fitView, which fits the tables at their MAIN-canvas positions. The compact
// D3 layout resolves asynchronously afterwards and moves every table to new
// coordinates, but nothing re-fit the camera — so the tables could land
// outside the visible pane. Re-focusing onto a neighbor (click inside the
// overlay) re-ran the layout with the same missing re-fit.
//
// Seed: global-setup's IDS.whiteboard joins users <-> orders via
// IDS.relationship — no new seed required.
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS } from './fixtures'
import type { Locator, Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

function overlay(page: Page) {
  return page.getByRole('dialog')
}

/** Assert `node` sits fully inside the overlay's React Flow pane. Polled,
 * because the compact layout resolves asynchronously after the dialog opens. */
async function expectInsidePane(dialog: Locator, node: Locator) {
  const pane = dialog.locator('.react-flow').first()
  await expect
    .poll(
      async () => {
        const p = await pane.boundingBox()
        const n = await node.boundingBox()
        if (!p || !n) return 'missing box'
        const inside =
          n.x >= p.x - 1 &&
          n.y >= p.y - 1 &&
          n.x + n.width <= p.x + p.width + 1 &&
          n.y + n.height <= p.y + p.height + 1
        return inside
          ? 'inside'
          : `outside: node ${JSON.stringify(n)} pane ${JSON.stringify(p)}`
      },
      { timeout: 5000 },
    )
    .toBe('inside')
}

test.describe('Table focus overlay', () => {
  test('f on a selected table shows it and its neighbor inside the overlay viewport (TF-1)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await tableNode(page, 'users').first().click()
    await page.keyboard.press('f')

    const dialog = overlay(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('users')

    // Let the async compact layout land, then check the camera framed it.
    await page.waitForTimeout(1500)
    await expectInsidePane(dialog, dialog.locator('[data-table-name="users"]'))
    await expectInsidePane(dialog, dialog.locator('[data-table-name="orders"]'))
  })

  test('re-focusing onto a neighbor inside the overlay keeps both tables in view (TF-2)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await tableNode(page, 'users').first().click()
    await page.keyboard.press('f')
    const dialog = overlay(page)
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(1500)

    // Click the header strip, not the node centre — the centre lands on a
    // column's inline type editor, which swallows the node click.
    await dialog
      .locator('[data-table-name="orders"]')
      .click({ position: { x: 40, y: 20 } })
    await expect(
      dialog.getByRole('button', { name: /back/i }).first(),
    ).toBeVisible()

    await page.waitForTimeout(1500)
    await expectInsidePane(dialog, dialog.locator('[data-table-name="orders"]'))
    await expectInsidePane(dialog, dialog.locator('[data-table-name="users"]'))
  })
})

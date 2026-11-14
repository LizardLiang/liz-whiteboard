// e2e/table-fields-drawer.spec.ts
// End-to-end coverage for the table fields drawer: a plain click on a table
// opens a non-modal drawer listing its columns (with comments) as a table;
// clicking another table swaps the content; Shift-click does not open it;
// Esc / the close button dismiss it. Auth + seed come from global-setup.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
  await expect(tableNode(page, 'orders').first()).toBeVisible()
}

// Click the table's header strip (top-centre) so the click never lands on a
// column row / affordance hitbox.
async function clickTable(
  page: Page,
  name: string,
  modifiers?: Array<'Shift'>,
) {
  await tableNode(page, name)
    .first()
    .click({
      position: { x: 20, y: 8 },
      modifiers,
    })
}

const drawer = (page: Page) => page.getByTestId('table-fields-drawer')

test.describe('Table fields drawer', () => {
  test('click opens, switches, and closes', async ({ page }) => {
    await openWhiteboard(page)
    await expect(drawer(page)).toBeHidden()

    await clickTable(page, 'users')
    await expect(drawer(page)).toBeVisible()
    await expect(
      drawer(page).getByRole('heading', { name: 'Fields of users' }),
    ).toBeVisible()
    const rows = drawer(page).getByTestId('fields-drawer-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('id')
    await expect(rows.nth(0)).toContainText('PK')
    await expect(rows.nth(1)).toContainText('email')
    await expect(rows.nth(1)).toContainText('Login email address')

    // Non-modal: another table stays clickable and the content switches.
    await clickTable(page, 'orders')
    await expect(
      drawer(page).getByRole('heading', { name: 'Fields of orders' }),
    ).toBeVisible()
    await expect(drawer(page).getByText('user_id')).toBeVisible()
    await expect(drawer(page).getByText('FK')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()

    await clickTable(page, 'users')
    await expect(drawer(page)).toBeVisible()
    await drawer(page)
      .getByRole('button', { name: 'Close fields drawer' })
      .click()
    await expect(drawer(page)).toBeHidden()
  })

  test('Shift-click does not open the drawer', async ({ page }) => {
    await openWhiteboard(page)
    await clickTable(page, 'users', ['Shift'])
    await expect(drawer(page)).toBeHidden()
  })
})

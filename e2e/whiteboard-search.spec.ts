// e2e/whiteboard-search.spec.ts
// End-to-end coverage for the Cmd/Ctrl+K search palette (WhiteboardSearch):
// it indexes the current tables + columns, filters as you type, groups results
// into Tables/Columns, shows an empty state for no match, and closes on select.
// Read-only — it never mutates the board, so it is safe to run after the
// mutating suites. Auth + seed data come from global-setup (storageState).
import { expect, test, type Page } from '@playwright/test'
import { IDS } from './fixtures'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
}

async function openSearch(page: Page) {
  // The toolbar's search button carries its shortcut in the accessible name
  // (title attr). Using it avoids OS-specific Cmd-vs-Ctrl keyboard differences.
  await page.getByRole('button', { name: /Search tables and columns/ }).click()
  await expect(page.getByPlaceholder('Search tables and columns…')).toBeVisible()
}

test.describe('Whiteboard search palette (Cmd/Ctrl+K)', () => {
  test('filters tables and columns, shows empty state, and closes on select', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await openSearch(page)

    const dialog = page.getByRole('dialog', {
      name: 'Search tables and columns',
    })

    // Typing a table name surfaces the table row (exact — cmdk also fuzzy-
    // matches that table's columns, whose values embed the table name) and
    // filters the other seeded table out entirely.
    await page.getByPlaceholder('Search tables and columns…').fill('orders')
    await expect(
      dialog.getByRole('option', { name: 'orders', exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('option', { name: 'users', exact: true }),
    ).toHaveCount(0)

    // Typing a column name surfaces the column result (rendered as
    // "<table>.<column>"). Only users.email matches "email".
    await page.getByPlaceholder('Search tables and columns…').fill('email')
    await expect(dialog.getByRole('option', { name: /email/ })).toBeVisible()

    // No match → empty state.
    await page
      .getByPlaceholder('Search tables and columns…')
      .fill('zzz_no_such_thing')
    await expect(
      page.getByText('No matching tables or columns.'),
    ).toBeVisible()

    // Selecting a result closes the palette (it pans the canvas to the table;
    // the pan itself is a canvas viewport change we don't assert here).
    await page.getByPlaceholder('Search tables and columns…').fill('users')
    await dialog.getByRole('option', { name: /^users$/ }).click()
    await expect(
      page.getByPlaceholder('Search tables and columns…'),
    ).toBeHidden()
  })
})

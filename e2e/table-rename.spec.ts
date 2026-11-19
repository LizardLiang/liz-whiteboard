// e2e/table-rename.spec.ts
// Inline table rename from the table header: double-click the header (canvas
// mode opens the edit overlay with the name editor already focused), type,
// Enter. Same interaction as the column-name editor (InlineNameEditor).
//
// Socket.IO broadcasts only reach peers in the single-process prod build (`io`
// is null in the dev Vite process), so peer sync is NOT asserted here. We
// assert persistence by reloading and re-reading the name; the duplicate-name
// rejection is asserted through the toast + the rolled-back name.
//
// Double-clicks use real `locator.dblclick()` (see table-edit-mode-switch.spec.ts
// for why synthetic dispatch is not enough). The shared "E2E ERD" board is
// read by other specs, so afterEach renames any leftover name back to "users".
import { expect, test } from '@playwright/test'
import { settle, tableNode, trackAcks } from './canvas-helpers'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1720, height: 1000 } })

const WB_URL = `/whiteboard/${IDS.whiteboard}`
const NAME_INPUT = '.table-header input[type="text"]'

async function openBoard(page: Page) {
  trackAcks(page)
  await page.goto(WB_URL)
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
  // A rename needs the socket: offline it toasts "not connected" and sends nothing.
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible()
  await expect(tableNode(page, 'orders')).toBeVisible()
}

/** Header strip is never crossed by a relationship edge. */
async function dblclickHeader(page: Page, name: string) {
  await tableNode(page, name).dblclick({ position: { x: 40, y: 12 } })
}

async function renameTo(page: Page, from: string, to: string) {
  await dblclickHeader(page, from)
  const input = page.locator(NAME_INPUT)
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await input.fill(to)
  await input.press('Enter')
}

test.afterEach(async ({ page }) => {
  await openBoard(page)
  for (const stale of ['users_renamed', '用戶資料表', 'orders']) {
    // 'orders' is only stale if a test renamed it; the board always has the
    // seeded one, so only touch names that should not exist.
    if (stale === 'orders') continue
    if ((await tableNode(page, stale).count()) === 0) continue
    await renameTo(page, stale, 'users')
    await settle(page)
  }
  await page.keyboard.press('Escape')
})

test('double-click the header, type, Enter: the new name persists across reload', async ({
  page,
}) => {
  await openBoard(page)
  await renameTo(page, 'users', 'users_renamed')
  await settle(page)
  await expect(tableNode(page, 'users_renamed')).toBeVisible()
  await expect(tableNode(page, 'users')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
  await expect(tableNode(page, 'users_renamed')).toBeVisible()
  await expect(tableNode(page, 'users')).toHaveCount(0)
})

test('a CJK name persists across reload', async ({ page }) => {
  await openBoard(page)
  await renameTo(page, 'users', '用戶資料表')
  await settle(page)
  await page.reload()
  await expect(tableNode(page, '用戶資料表')).toBeVisible()
})

test('Escape cancels the rename and sends nothing', async ({ page }) => {
  await openBoard(page)
  await dblclickHeader(page, 'users')
  const input = page.locator(NAME_INPUT)
  await input.fill('should_not_stick')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(tableNode(page, 'users')).toBeVisible()
  await settle(page)
  await page.reload()
  await expect(tableNode(page, 'users')).toBeVisible()
  await expect(tableNode(page, 'should_not_stick')).toHaveCount(0)
})

test('an empty or whitespace-only name reverts', async ({ page }) => {
  await openBoard(page)
  await dblclickHeader(page, 'users')
  const input = page.locator(NAME_INPUT)
  await input.fill('   ')
  await input.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(tableNode(page, 'users')).toBeVisible()
})

test('renaming onto an existing table name is rejected, rolled back and toasted', async ({
  page,
}) => {
  await openBoard(page)
  await renameTo(page, 'users', 'orders')
  await expect(
    page.getByText('A table named "orders" already exists on this whiteboard'),
  ).toBeVisible()
  await settle(page)
  // Rolled back: both tables keep their names, here and after a reload.
  await expect(tableNode(page, 'users')).toBeVisible()
  await page.reload()
  await expect(tableNode(page, 'users')).toBeVisible()
  await expect(tableNode(page, 'orders')).toHaveCount(1)
})

test('Backspace and Delete inside the editor do not delete the table', async ({
  page,
}) => {
  await openBoard(page)
  await dblclickHeader(page, 'users')
  const input = page.locator(NAME_INPUT)
  await expect(input).toBeFocused()
  await input.press('Backspace')
  await input.press('Delete')
  // No delete-confirmation dialog, and the table is still on the board.
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(tableNode(page, 'users')).toBeVisible()
  await input.press('Escape')
  await expect(tableNode(page, 'users')).toBeVisible()
})

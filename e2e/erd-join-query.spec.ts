// End-to-end coverage for #22's selected-table SQL action. The shared seed
// already owns a users → orders relationship, so this spec can exercise the
// real marquee gesture without adding mutable fixture state.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'

test.use({ viewport: { width: 1600, height: 1000 } })

test('marquee-selected related tables generate copyable JOIN SQL', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/whiteboard/${IDS.whiteboard}`)

  const users = tableNode(page, 'users').first()
  const orders = tableNode(page, 'orders').first()
  await expect(users).toBeVisible()
  await expect(orders).toBeVisible()

  const [usersBox, ordersBox] = await Promise.all([
    users.boundingBox(),
    orders.boundingBox(),
  ])
  if (!usersBox || !ordersBox) throw new Error('seeded table is not visible')

  const start = {
    // users is nested in the seeded Identity area. Start from pane space
    // below and to the left of that area; starting inside its bounds would
    // begin an area-node gesture instead of React Flow's marquee gesture.
    x: Math.max(Math.min(usersBox.x, ordersBox.x) - 80, 270),
    y:
      Math.max(usersBox.y + usersBox.height, ordersBox.y + ordersBox.height) +
      12,
  }
  const end = {
    x:
      Math.max(usersBox.x + usersBox.width, ordersBox.x + ordersBox.width) + 12,
    y: Math.min(usersBox.y, ordersBox.y) - 12,
  }

  await page.keyboard.down('Shift')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.up('Shift')

  const actions = page.getByTestId('selected-tables-actions')
  await expect(actions).toBeVisible()
  await actions.getByRole('button', { name: /generate sql/i }).click()

  const dialog = page.getByTestId('selected-tables-sql-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('generated-sql')).toContainText(
    'INNER JOIN "orders" AS "o"',
  )
  await dialog.getByRole('button', { name: /copy sql/i }).click()
  await expect(page.getByText('SQL copied to clipboard')).toBeVisible()
})

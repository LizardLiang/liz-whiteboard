// e2e/table-fields-drawer.spec.ts
// End-to-end coverage for the table fields drawer: a plain click on a table
// opens a non-modal drawer listing its columns (with comments) as a table;
// clicking another table swaps the content; Shift-click does not open it;
// Esc / the close button dismiss it. Auth + seed come from global-setup.
import { execFileSync } from 'node:child_process'
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

    // At 1600px the 48rem drawer covers the orders table, so dismiss it
    // first; opening another table then shows that table's fields.
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
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

test.describe('Table fields drawer - complex data', () => {
  test.beforeAll(() => {
    execFileSync('bun', ['run', 'e2e/seed-fields-drawer.ts'], {
      stdio: 'inherit',
    })
  })

  async function openComplexBoard(page: Page) {
    await page.goto(`/whiteboard/${IDS.fdWhiteboard}`)
    await expect(
      page.getByRole('heading', { name: 'E2E Fields Drawer' }),
    ).toBeVisible()
    await expect(tableNode(page, 'customer_orders').first()).toBeVisible()
  }

  // Close the drawer (it floats over the canvas and can cover other tables).
  async function openTable(page: Page, name: string) {
    if (await drawer(page).isVisible()) {
      await page.keyboard.press('Escape')
      await expect(drawer(page)).toBeHidden()
    }
    await clickTable(page, name)
    await expect(drawer(page)).toBeVisible()
  }

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1600, height: 1000 } })

    test('customer_orders: 19 rows, no horizontal overflow, comments intact', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await openTable(page, 'customer_orders')
      const d = drawer(page)
      await expect(
        d.getByRole('heading', { name: 'Fields of customer_orders' }),
      ).toBeVisible()

      const rows = d.getByTestId('fields-drawer-row')
      await expect(rows).toHaveCount(19)
      await expect(rows.nth(0)).toContainText('id')
      await expect(rows.nth(1)).toContainText('order_number')
      await expect(rows.nth(3)).toContainText('status')
      await expect(rows.nth(18)).toContainText('updated_at')

      // Long unbroken ENUM must wrap, not widen the table.
      const scroller = d.locator('div.overflow-auto')
      const overflow = await scroller.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

      // The Comment cell of the status row sits fully inside the drawer.
      const statusComment = rows.nth(3).getByTestId('fields-drawer-comment')
      const cellBox = await statusComment.boundingBox()
      const drawerBox = await d.boundingBox()
      expect(cellBox).not.toBeNull()
      expect(drawerBox).not.toBeNull()
      expect(cellBox!.width).toBeGreaterThan(100)
      expect(cellBox!.x).toBeGreaterThanOrEqual(drawerBox!.x)
      expect(cellBox!.x + cellBox!.width).toBeLessThanOrEqual(
        drawerBox!.x + drawerBox!.width,
      )
      expect(cellBox!.y).toBeGreaterThanOrEqual(drawerBox!.y)
      expect(cellBox!.y + cellBox!.height).toBeLessThanOrEqual(
        drawerBox!.y + drawerBox!.height + 1,
      )

      // Multi-line comment keeps its line breaks.
      const lifecycle = await statusComment.innerText()
      expect(lifecycle).toContain('\n')
      expect(lifecycle).toContain('draft → pending → paid')

      // Pipes and markdown characters render literally.
      const notes = rows.nth(12).getByTestId('fields-drawer-comment')
      await expect(notes).toContainText('| pipes |')
      await expect(notes).toContainText('*markdown*')
      await expect(d.locator('em, strong')).toHaveCount(0)

      // URL comment is plain text, not a link.
      await expect(rows.nth(16)).toContainText(
        'https://wiki.example.com/support/cancellation-reasons',
      )
    })

    test('payments: 28 rows, long name, placeholder, sticky header', async ({
      page,
    }) => {
      await openComplexBoard(page)
      const longName = 'payment_transactions_with_gateway_reconciliation_state'
      await openTable(page, longName)
      const d = drawer(page)
      await expect(
        d.getByRole('heading', { name: `Fields of ${longName}` }),
      ).toBeVisible()
      await expect(
        d.getByText('Column details for the selected table.'),
      ).toBeVisible()

      const rows = d.getByTestId('fields-drawer-row')
      await expect(rows).toHaveCount(28)

      const scroller = d.locator('div.overflow-auto')
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      const lastRow = rows.last()
      await expect(lastRow).toContainText('version')
      await expect(lastRow).toBeInViewport()
      await expect(
        d.getByRole('columnheader', { name: 'Comment' }),
      ).toBeInViewport()
      const headBox = await d
        .getByRole('columnheader', { name: 'Name' })
        .boundingBox()
      const scrollBox = await scroller.boundingBox()
      expect(headBox!.y).toBeGreaterThanOrEqual(scrollBox!.y - 1)
      expect(headBox!.y).toBeLessThan(scrollBox!.y + 60)
    })

    test('audit_log dashes and order_line_items PK+FK badges', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await openTable(page, 'audit_log')
      const comments = drawer(page).getByTestId('fields-drawer-comment')
      await expect(comments).toHaveCount(7)
      for (const c of await comments.all()) {
        await expect(c).toHaveText('—')
      }

      await openTable(page, 'order_line_items')
      const orderRow = drawer(page).getByTestId('fields-drawer-row').first()
      await expect(orderRow).toContainText('order_id')
      await expect(orderRow).toContainText('PK')
      await expect(orderRow).toContainText('FK')
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('customers: no page overflow, Comment column not collapsed', async ({
      page,
    }) => {
      await openComplexBoard(page)
      // On a phone the board fits at a low zoom, so tables render as
      // chrome-light nodes whose React Flow wrapper receives the pointer.
      await page
        .locator('.react-flow__node:has([data-table-name="customers"])')
        .first()
        .click()
      await expect(drawer(page)).toBeVisible()
      const d = drawer(page)
      await expect(
        d.getByRole('heading', { name: 'Fields of customers' }),
      ).toBeVisible()
      await expect(d.getByTestId('fields-drawer-row')).toHaveCount(12)

      const pageWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      )
      expect(pageWidth).toBeLessThanOrEqual(390)

      const commentHead = d.getByRole('columnheader', { name: 'Comment' })
      const box = await commentHead.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(150)
    })
  })
})

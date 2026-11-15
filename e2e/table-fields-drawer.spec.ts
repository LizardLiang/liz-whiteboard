// e2e/table-fields-drawer.spec.ts
// End-to-end coverage for the floating table fields window: a plain click on a
// table opens a non-modal window listing its columns (with comments); the
// window keeps its own table list (plain click replaces, pinned plain click
// and Ctrl-click add, Shift-click and box selection do nothing); it can be
// pinned, minimized to a named block, and dragged in viewport coordinates;
// pin and position are remembered per browser. Auth + seed come from
// global-setup. Windows mode (one window per table) is covered in phase 2.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { getViewportScale, tableNode } from './canvas-helpers'
import type { Locator, Page } from '@playwright/test'

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
  modifiers?: Array<'Shift' | 'Control'>,
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

    // The drawer is non-modal: a click on another table while it is open
    // swaps its content without closing it. customers and companies both sit
    // left of the drawer at 1600px, so neither click lands on the panel.
    test('switches tables while open, without closing', async ({ page }) => {
      await openComplexBoard(page)
      await openTable(page, 'customers')
      const d = drawer(page)
      await expect(
        d.getByRole('heading', { name: 'Fields of customers' }),
      ).toBeVisible()
      await expect(d.getByTestId('fields-drawer-row')).toHaveCount(12)

      await clickTable(page, 'companies')
      await expect(
        d.getByRole('heading', { name: 'Fields of companies' }),
      ).toBeVisible()
      await expect(d.getByTestId('fields-drawer-row')).toHaveCount(6)
      await expect(d).toContainText('統一編號')
      await expect(drawer(page)).toHaveCount(1)
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

  test.describe('pin, tabs, minimize, drag', () => {
    test.use({ viewport: { width: 1600, height: 1000 } })

    const pin = (page: Page) => page.getByTestId('fields-window-pin')
    const header = (page: Page) => page.getByTestId('table-fields-header')
    const block = (page: Page) => page.getByTestId('table-fields-block')
    const tabs = (page: Page) => drawer(page).getByRole('tab')
    // A spot on the canvas pane that is clear of every table and of the window.
    const clickEmptyPane = (page: Page) =>
      page.locator('.react-flow__pane').click({ position: { x: 120, y: 880 } })

    async function box(locator: Locator) {
      const b = await locator.boundingBox()
      expect(b).not.toBeNull()
      return b!
    }

    // Drag the window by its title (not a button) with real pointer moves.
    async function dragHeader(page: Page, dx: number, dy: number) {
      const b = await box(header(page).getByRole('heading'))
      const x = b.x + 20
      const y = b.y + b.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 })
      await page.mouse.move(x + dx, y + dy, { steps: 6 })
      await page.mouse.up()
    }

    test('pin survives Esc and an empty-canvas click; unpin then Esc closes', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await expect(drawer(page)).toBeVisible()
      await expect(pin(page)).toHaveAttribute('aria-pressed', 'false')
      await pin(page).click()
      await expect(pin(page)).toHaveAttribute('aria-pressed', 'true')

      await page.keyboard.press('Escape')
      await expect(drawer(page)).toBeVisible()
      await clickEmptyPane(page)
      await expect(drawer(page)).toBeVisible()
      await expect(
        drawer(page).getByRole('heading', { name: 'Fields of customers' }),
      ).toBeVisible()

      await pin(page).click()
      await expect(pin(page)).toHaveAttribute('aria-pressed', 'false')
      await page.keyboard.press('Escape')
      await expect(drawer(page)).toBeHidden()
    })

    test('unpinned plain click replaces; pinned plain click adds a tab', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await clickTable(page, 'companies')
      await expect(
        drawer(page).getByRole('heading', { name: 'Fields of companies' }),
      ).toBeVisible()
      await expect(page.getByRole('tablist')).toHaveCount(0)

      await pin(page).click()
      await clickTable(page, 'customers')
      await expect(tabs(page)).toHaveCount(2)
      await expect(tabs(page).nth(0)).toHaveText('companies')
      await expect(tabs(page).nth(1)).toHaveText('customers')
      await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect(drawer(page).getByTestId('fields-drawer-row')).toHaveCount(
        12,
      )

      // A listed table is brought forward, not duplicated.
      await tabs(page).nth(0).click()
      await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
      await expect(drawer(page).getByTestId('fields-drawer-row')).toHaveCount(6)
      await clickTable(page, 'customers')
      await expect(tabs(page)).toHaveCount(2)
      await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')

      // Arrow keys move between tabs; the tab's x removes only that table.
      await tabs(page).nth(1).focus()
      await page.keyboard.press('ArrowLeft')
      await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
      await drawer(page)
        .getByRole('button', { name: 'Close companies' })
        .click()
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(
        drawer(page).getByRole('heading', { name: 'Fields of customers' }),
      ).toBeVisible()
    })

    test('Ctrl-click adds then removes a table; Shift-click and a Shift box add none', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers', ['Shift'])
      await expect(drawer(page)).toBeHidden()

      // Shift-drag a box over the left column of tables.
      await page.keyboard.down('Shift')
      await page.mouse.move(8, 80)
      await page.mouse.down()
      await page.mouse.move(400, 500, { steps: 8 })
      await page.mouse.move(600, 700, { steps: 8 })
      await page.mouse.up()
      await page.keyboard.up('Shift')
      await expect(drawer(page)).toBeHidden()
      // Drop the box selection; its overlay would otherwise sit on the tables.
      await clickEmptyPane(page)

      await clickTable(page, 'customers')
      await clickTable(page, 'companies', ['Control'])
      await expect(tabs(page)).toHaveCount(2)
      await clickTable(page, 'companies', ['Control'])
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(
        drawer(page).getByRole('heading', { name: 'Fields of customers' }),
      ).toBeVisible()
    })

    test('minimize shows a named block; clicking it restores in place', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      const before = await box(drawer(page))
      await page.getByTestId('fields-window-minimize').click()
      await expect(drawer(page)).toBeHidden()
      await expect(block(page)).toBeVisible()
      await expect(block(page)).toContainText('customers')
      const small = await box(block(page))
      expect(small.width).toBeLessThan(before.width / 2)
      expect(small.height).toBeLessThan(80)
      expect(Math.abs(small.x - before.x)).toBeLessThan(1.5)
      expect(Math.abs(small.y - before.y)).toBeLessThan(1.5)

      await block(page).getByRole('button', { name: 'Restore' }).click()
      await expect(drawer(page)).toBeVisible()
      await expect(block(page)).toBeHidden()
      const after = await box(drawer(page))
      expect(Math.abs(after.x - before.x)).toBeLessThan(1.5)
      expect(Math.abs(after.y - before.y)).toBeLessThan(1.5)
    })

    test('a minimized block shows the extra-table count and can be dragged', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await pin(page).click()
      await clickTable(page, 'companies')
      await page.getByTestId('fields-window-minimize').click()
      await expect(block(page)).toContainText('companies')
      await expect(block(page)).toContainText('+1')

      const start = await box(block(page))
      const sx = start.x + 20
      const sy = start.y + start.height / 2
      await page.mouse.move(sx, sy)
      await page.mouse.down()
      await page.mouse.move(sx - 100, sy + 150, { steps: 10 })
      await page.mouse.up()
      // A drag moves the block and does not restore the window.
      await expect(block(page)).toBeVisible()
      await expect(drawer(page)).toBeHidden()
      const moved = await box(block(page))
      expect(Math.abs(moved.x - (start.x - 100))).toBeLessThan(2)
      expect(Math.abs(moved.y - (start.y + 150))).toBeLessThan(2)
    })

    test('drag position is in viewport coordinates: pan and zoom do not move it', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      const start = await box(drawer(page))
      // The 742 px-tall window can move at most 182 px down in a 1000 px viewport.
      await dragHeader(page, -400, 150)
      const dragged = await box(drawer(page))
      expect(Math.abs(dragged.x - (start.x - 400))).toBeLessThan(2)
      expect(Math.abs(dragged.y - (start.y + 150))).toBeLessThan(2)

      // Pan the canvas (drag empty pane), then zoom out twice.
      await page.mouse.move(120, 880)
      await page.mouse.down()
      await page.mouse.move(200, 900, { steps: 6 })
      await page.mouse.up()
      // The dragged window now covers the dock's zoom button, so use the
      // wheel: Ctrl + wheel zooms the canvas around the cursor.
      const scaleBefore = await getViewportScale(page)
      await page.mouse.move(120, 700)
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, 400)
      await page.keyboard.up('Control')
      await expect.poll(() => getViewportScale(page)).toBeLessThan(scaleBefore)
      await expect(drawer(page)).toBeVisible()
      const after = await box(drawer(page))
      expect(after.x).toBeCloseTo(dragged.x, 0)
      expect(after.y).toBeCloseTo(dragged.y, 0)
    })

    test('arrow keys nudge the focused header by 16 px', async ({ page }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      const start = await box(drawer(page))
      await header(page).focus()
      await page.keyboard.press('ArrowLeft')
      await expect
        .poll(async () => (await box(drawer(page))).x)
        .toBeCloseTo(start.x - 16, 0)
      await page.keyboard.press('Shift+ArrowDown')
      await expect
        .poll(async () => (await box(drawer(page))).y)
        .toBeCloseTo(start.y + 64, 0)
    })

    test('dragging past an edge clamps; a smaller viewport keeps it inside', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await dragHeader(page, 900, -300)
      let b = await box(drawer(page))
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(1600 + 0.5)
      expect(b.y + b.height).toBeLessThanOrEqual(1000 + 0.5)

      await page.setViewportSize({ width: 1000, height: 700 })
      await expect
        .poll(async () => {
          const r = await box(drawer(page))
          return r.x + r.width <= 1000.5 && r.y + r.height <= 700.5
        })
        .toBe(true)
      b = await box(drawer(page))
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
    })

    test('reload opens no window; pin and position are remembered', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await pin(page).click()
      await dragHeader(page, -300, 120)
      const dragged = await box(drawer(page))

      await page.reload()
      await expect(tableNode(page, 'customers').first()).toBeVisible()
      await expect(drawer(page)).toBeHidden()
      await clickTable(page, 'customers')
      await expect(drawer(page)).toBeVisible()
      await expect(pin(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('tablist')).toHaveCount(0)
      const reopened = await box(drawer(page))
      expect(reopened.x).toBeCloseTo(dragged.x, 0)
      expect(reopened.y).toBeCloseTo(dragged.y, 0)
    })

    test('Esc closes the search palette first and keeps the window', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await expect(drawer(page)).toBeVisible()
      await page.keyboard.press('Control+k')
      const palette = page.getByRole('dialog')
      await expect(palette).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(palette).toBeHidden()
      await expect(drawer(page)).toBeVisible()
    })
  })

  test.describe('deleting a listed table', () => {
    test.use({ viewport: { width: 1600, height: 1000 } })

    // The delete test removes a seeded table, so reseed before and after.
    test.beforeAll(() => {
      execFileSync('bun', ['run', 'e2e/seed-fields-drawer.ts'], {
        stdio: 'inherit',
      })
    })
    test.afterAll(() => {
      execFileSync('bun', ['run', 'e2e/seed-fields-drawer.ts'], {
        stdio: 'inherit',
      })
    })

    test('its tab disappears and the others stay', async ({ page }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await page.getByTestId('fields-window-pin').click()
      await clickTable(page, 'companies')
      await expect(drawer(page).getByRole('tab')).toHaveCount(2)

      await tableNode(page, 'companies')
        .first()
        .dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
      await page.getByRole('menuitem', { name: 'Delete table' }).click()
      await page
        .getByRole('button', { name: 'Delete table', exact: true })
        .click()

      await expect(tableNode(page, 'companies')).toHaveCount(0)
      await expect(page.getByRole('tablist')).toHaveCount(0)
      await expect(
        drawer(page).getByRole('heading', { name: 'Fields of customers' }),
      ).toBeVisible()
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

      // Minimize to a block and restore, still without page overflow.
      await page.getByTestId('fields-window-minimize').click()
      await expect(drawer(page)).toBeHidden()
      const block = page.getByTestId('table-fields-block')
      await expect(block).toContainText('customers')
      await block.getByRole('button', { name: 'Restore' }).click()
      await expect(drawer(page)).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390)
      const win = await drawer(page).boundingBox()
      expect(win!.x).toBeGreaterThanOrEqual(0)
      expect(win!.x + win!.width).toBeLessThanOrEqual(390.5)
      expect(win!.y + win!.height).toBeLessThanOrEqual(844.5)
    })
  })
})

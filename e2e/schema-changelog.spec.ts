// e2e/schema-changelog.spec.ts
// End-to-end coverage for the schema change log: the "Changes" tab of the
// history panel and the table menu's "View history". Auth comes from
// global-setup (storageState); boards come from e2e/seed-changelog.ts:
//   - history board: 16 tables (long and CJK names) with a seeded change
//     history, so every filter and the paging are deterministic;
//   - live board: 16 tables, no history; the live test edits it through the
//     real UI (rename a column, change a type, drag a table, delete a table
//     with columns and a relationship, import SQL), then reads the log;
//   - empty board: no tables, no history.
//
// Persisted results, not live pushes, are asserted: the log refreshes on tab
// open (and on the refresh button), and Socket.IO broadcasts only work in the
// single-process prod build (`io` is null in the Vite dev process; see
// playwright.config.ts), so every check here reloads or reopens the tab.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { clickMoreTool } from './fixtures'
import { tableNode } from './canvas-helpers'
import { CL_IDS, dayInput } from './changelog-constants'
import type { Locator, Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-changelog.ts'], { stdio: 'inherit' })
})

async function openBoard(page: Page, whiteboardId: string, heading: string) {
  await page.goto(`/whiteboard/${whiteboardId}`)
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
}

async function openChanges(page: Page) {
  await clickMoreTool(page, 'Version history')
  await expect(
    page.getByRole('heading', { name: 'Version History' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Changes' }).click()
}

const list = (page: Page) => page.getByRole('list', { name: 'Change list' })
const rows = (page: Page) =>
  list(page).locator(
    '[data-testid="change-event"], [data-testid="change-batch"]',
  )
// Top-level rows only: batch items live in their own nested list.
const topRows = (page: Page) =>
  list(page).locator(
    ':scope > li > [data-testid="change-event"], :scope > li > [data-testid="change-batch"]',
  )

function row(page: Page, text: string | RegExp): Locator {
  return topRows(page).filter({ hasText: text })
}

async function pickTable(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Filter by table' }).click()
  await page.getByPlaceholder('Find a table...').fill(name)
  await page.getByRole('option', { name, exact: true }).click()
}

async function pickPerson(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Filter by person' }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

test.describe('Changes tab, seeded history', () => {
  test('a board with no history says so', async ({ page }) => {
    await openBoard(page, CL_IDS.empty, 'E2E Changelog Empty')
    await openChanges(page)
    await expect(page.getByText('No changes recorded yet.')).toBeVisible()
    await expect(rows(page)).toHaveCount(0)
  })

  test('lists newest first with actors, the AI agent badge and batch summaries; layout stays hidden until the switch', async ({
    page,
  }) => {
    await openBoard(page, CL_IDS.history, 'E2E Changelog History')
    await openChanges(page)

    // First page = 50 rows (the 60 older edits make the list page).
    await expect(topRows(page)).toHaveCount(50)
    const top = topRows(page)

    // Newest first: the peer's edit two hours ago, then the table delete
    // batch, the restore batch, the SQL import batch, ...
    await expect(top.nth(0)).toContainText(
      'e2e_viewer added column tracking_code to orders',
    )
    await expect(top.nth(1)).toContainText(
      'e2e_dogfood deleted table legacy_audit_log with its columns and relationships',
    )
    await expect(top.nth(1)).toContainText(/1 relationship deleted/)
    await expect(top.nth(2)).toContainText(
      'e2e_viewer restored version Before the billing rewrite',
    )
    await expect(top.nth(3)).toContainText('e2e_dogfood imported SQL')
    await expect(top.nth(3)).toContainText(
      /4 tables created, 8 columns created/,
    )

    // The AI agent edit carries the badge; nobody else does.
    const typeChange = row(page, 'changed the type of status on orders')
    await expect(typeChange).toContainText('VARCHAR → TEXT')
    await expect(typeChange.getByText('AI agent')).toBeVisible()
    await expect(list(page).getByText('AI agent')).toHaveCount(1)

    // CJK names stay whole.
    await expect(
      row(page, 'added column 電子郵件 to 使用者帳號資料表'),
    ).toBeVisible()

    // Layout is hidden by default and appears with the switch.
    await expect(row(page, 'moved table orders')).toHaveCount(0)
    await page.getByRole('switch', { name: 'Show layout changes' }).click()
    await expect(row(page, 'moved table orders')).toHaveCount(1)
    await page.getByRole('switch', { name: 'Show layout changes' }).click()
    await expect(row(page, 'moved table orders')).toHaveCount(0)
  })

  test('an event row expands to before and after; a batch expands to its items', async ({
    page,
  }) => {
    await openBoard(page, CL_IDS.history, 'E2E Changelog History')
    await openChanges(page)

    const rename = row(page, 'renamed column mail → email on accounts')
    await expect(rename).toContainText('e2e_viewer')
    await rename.getByRole('button', { name: 'Show details' }).click()
    await expect(rename.getByText('name', { exact: true })).toBeVisible()
    await expect(rename.getByText('mail', { exact: true }).last()).toBeVisible()
    await rename.getByRole('button', { name: 'Hide details' }).click()
    await expect(rename.getByText('name', { exact: true })).toHaveCount(0)

    const importBatch = row(page, 'imported SQL')
    await importBatch.getByRole('button', { name: 'Show items' }).click()
    const items = importBatch.getByRole('list', {
      name: 'Items in this change',
    })
    await expect(items.getByTestId('change-event')).toHaveCount(12)
    await expect(items).toContainText('created table import_users')
    await expect(items).toContainText('added column id to import_votes')
    await importBatch.getByRole('button', { name: 'Hide items' }).click()
    await expect(items).toHaveCount(0)

    const restore = row(page, 'restored version Before the billing rewrite')
    await restore.getByRole('button', { name: 'Show items' }).click()
    // 3 deletes, 3 creates and the marker line.
    await expect(
      restore
        .getByRole('list', { name: 'Items in this change' })
        .getByTestId('change-event'),
    ).toHaveCount(7)
  })

  test('Load more pages to the end of the list', async ({ page }) => {
    await openBoard(page, CL_IDS.history, 'E2E Changelog History')
    await openChanges(page)
    await expect(topRows(page)).toHaveCount(50)
    await page.getByRole('button', { name: 'Load more' }).click()
    // 8 recent rows (layout hidden) + 60 older edits = 68.
    await expect(topRows(page)).toHaveCount(68)
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)
  })

  test('each filter narrows the list, and Clear filters resets them', async ({
    page,
  }) => {
    await openBoard(page, CL_IDS.history, 'E2E Changelog History')
    await openChanges(page)
    await expect(topRows(page)).toHaveCount(50)

    // Table: deleted tables stay selectable.
    await pickTable(page, 'legacy_audit_log')
    await expect(topRows(page)).toHaveCount(1)
    await expect(topRows(page).first()).toContainText(
      'deleted table legacy_audit_log',
    )
    await pickTable(page, 'orders')
    await expect(topRows(page)).toHaveCount(2)
    await expect(topRows(page).nth(0)).toContainText(
      'added column tracking_code',
    )
    await expect(topRows(page).nth(1)).toContainText(
      'changed the type of status',
    )
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(topRows(page)).toHaveCount(50)

    // Person: a user, then the AI agent.
    await pickPerson(page, 'e2e_viewer')
    await expect(topRows(page)).toHaveCount(3)
    await expect(list(page).getByText('e2e_dogfood')).toHaveCount(0)
    await pickPerson(page, 'AI agent')
    await expect(topRows(page)).toHaveCount(1)
    await expect(topRows(page).first()).toContainText(
      'changed the type of status on orders',
    )
    await pickPerson(page, 'Everyone')
    await expect(topRows(page)).toHaveCount(50)

    // Date range: the rename (6 days ago) and the type change (5 days ago).
    await page.getByLabel('From date').fill(dayInput(6))
    await page.getByLabel('To date').fill(dayInput(5))
    await expect(topRows(page)).toHaveCount(2)
    await expect(topRows(page).nth(0)).toContainText(
      'changed the type of status',
    )
    await expect(topRows(page).nth(1)).toContainText('renamed column mail')
    // A range with nothing in it.
    await page.getByLabel('From date').fill(dayInput(4))
    await page.getByLabel('To date').fill(dayInput(4))
    await expect(topRows(page)).toHaveCount(0)
    await expect(
      page.getByText('No changes match these filters.'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(topRows(page)).toHaveCount(50)

    // Text search reaches names, tables, people and field values.
    await page
      .getByRole('searchbox', { name: 'Search changes' })
      .fill('電子郵件')
    await expect(topRows(page)).toHaveCount(1)
    await expect(topRows(page).first()).toContainText('added column 電子郵件')
    await page
      .getByRole('searchbox', { name: 'Search changes' })
      .fill('tracking_code')
    await expect(topRows(page)).toHaveCount(1)
    await page
      .getByRole('searchbox', { name: 'Search changes' })
      .fill('no-such-text')
    await expect(topRows(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(topRows(page)).toHaveCount(50)
  })

  test('"View history" in the table menu opens the Changes tab on that table', async ({
    page,
  }) => {
    await openBoard(page, CL_IDS.history, 'E2E Changelog History')
    await expect(tableNode(page, 'orders').first()).toBeVisible()

    await tableNode(page, 'orders')
      .first()
      .dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
    await page.getByRole('menuitem', { name: 'View history' }).click()

    await expect(
      page.getByRole('heading', { name: 'Version History' }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      page.getByRole('combobox', { name: 'Filter by table' }),
    ).toContainText('orders')
    await expect(topRows(page)).toHaveCount(2)
    await expect(list(page)).not.toContainText('legacy_audit_log')

    // Closing the panel drops the request: the next open starts unfiltered.
    await page.keyboard.press('Escape')
    await openChanges(page)
    await expect(
      page.getByRole('combobox', { name: 'Filter by table' }),
    ).toContainText('All tables')
  })
})

test.describe('Changes tab, live edits', () => {
  const nodeFor = (page: Page, name: string) => tableNode(page, name).first()

  // Chrome-light canvas tables take the edit overlay on double-click; events
  // are dispatched directly, as canvas-edit-overlay.spec.ts does.
  async function openOverlay(page: Page, name: string) {
    await nodeFor(page, name).dispatchEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    })
    await expect(page.locator('.table-header')).toHaveCount(1)
  }

  async function closeOverlay(page: Page) {
    await page
      .locator('.react-flow__pane')
      .dispatchEvent('click', { bubbles: true, cancelable: true })
    await expect(page.locator('.table-header')).toHaveCount(0)
  }

  async function deleteTable(page: Page, name: string) {
    await nodeFor(page, name).dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    await page.getByRole('menuitem', { name: 'Delete table' }).click()
    await page
      .getByRole('button', { name: 'Delete table', exact: true })
      .click()
    await expect(tableNode(page, name)).toHaveCount(0)
  }

  async function dragTable(page: Page, name: string, dx: number, dy: number) {
    const box = await nodeFor(page, name).boundingBox()
    if (!box) throw new Error(`no bounding box for ${name}`)
    const from = { x: box.x + 20, y: box.y + 10 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 })
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
    await page.mouse.up()
  }

  test('rename, retype, drag, delete and import all reach the log with the right actor', async ({
    page,
  }) => {
    await openBoard(page, CL_IDS.live, 'E2E Changelog Live')
    await expect(nodeFor(page, 'accounts')).toBeVisible()
    await expect(nodeFor(page, '使用者帳號資料表')).toBeVisible()

    // 1. Rename a column through the inline editor (Enter commits).
    await openOverlay(page, 'accounts')
    const columns = page.locator('.table-columns')
    await columns.getByText('mail', { exact: true }).dispatchEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    })
    const nameInput = columns.locator('input[type="text"]')
    await nameInput.fill('email')
    await nameInput.press('Enter')
    await expect(columns.getByText('email', { exact: true })).toBeVisible()

    // 2. Change that column's data type through the type selector.
    await columns
      .locator('.column-row')
      .filter({ hasText: 'email' })
      .getByText('VARCHAR', { exact: true })
      .dispatchEvent('dblclick', { bubbles: true, cancelable: true })
    await page.getByPlaceholder('Search types...').fill('TEXT')
    await page.getByRole('option', { name: 'Text', exact: true }).click()
    await expect(
      columns
        .locator('.column-row')
        .filter({ hasText: 'email' })
        .getByText(/^text$/i),
    ).toBeVisible()
    await closeOverlay(page)

    // 3. Drag a table (a layout change).
    await dragTable(page, 'categories', 120, 60)

    // 4. Delete a table that has columns and a relationship.
    await deleteTable(page, 'shipments')

    // 5. Import 5 tables as one SQL import.
    await clickMoreTool(page, 'Import SQL')
    await page.locator('#import-sql-text').fill(
      `CREATE TABLE cl_authors (id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE cl_books (id UUID PRIMARY KEY, author_id UUID REFERENCES cl_authors(id), title VARCHAR(255));
CREATE TABLE cl_shelves (id UUID PRIMARY KEY, label VARCHAR(64));
CREATE TABLE cl_members (id UUID PRIMARY KEY, full_name VARCHAR(255));
CREATE TABLE cl_loans (id UUID PRIMARY KEY, book_id UUID REFERENCES cl_books(id), member_id UUID REFERENCES cl_members(id));`,
    )
    await expect(page.getByText(/5 tables,\s*12 columns/)).toBeVisible()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(nodeFor(page, 'cl_loans')).toBeVisible()

    // Reload: everything below is read back from the database.
    await page.reload()
    await expect(nodeFor(page, 'cl_loans')).toBeVisible()
    await openChanges(page)

    const me = 'e2e_dogfood'
    await expect(
      row(page, 'renamed column mail → email on accounts'),
    ).toContainText(me)
    await expect(
      row(page, /changed the type of email on accounts: VARCHAR → text/i),
    ).toContainText(me)

    const deletion = row(
      page,
      'deleted table shipments with its columns and relationships',
    )
    await expect(deletion).toContainText(me)
    await expect(deletion).toContainText(/1 relationship deleted/)
    await expect(deletion).toContainText(/1 table deleted/)

    const imported = row(page, 'imported SQL')
    await expect(imported).toContainText(me)
    await expect(imported).toContainText(/5 tables created/)
    await expect(imported).toContainText(/3 relationships created/)
    await imported.getByRole('button', { name: 'Show items' }).click()
    await expect(
      imported
        .getByRole('list', { name: 'Items in this change' })
        .getByText('cl_loans', { exact: true })
        .first(),
    ).toBeVisible()

    // The drag is a layout change: hidden by default, shown by the switch.
    await expect(row(page, 'moved table categories')).toHaveCount(0)
    await page.getByRole('switch', { name: 'Show layout changes' }).click()
    await expect(row(page, 'moved table categories')).toHaveCount(1)
    await expect(row(page, 'moved table categories')).toContainText(me)

    // Nobody here used an AI agent.
    await expect(list(page).getByText('AI agent')).toHaveCount(0)
  })
})

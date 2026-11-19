// e2e/table-header-buttons.spec.ts
// A header button (note, relations, comment, delete) works on the FIRST click
// even while a column name editor is open in the edit layout: the click commits
// the column edit and runs the button, it is not swallowed by the editor's
// blur.
//
// The double-click is a real `locator.dblclick()` (see
// table-edit-mode-switch.spec.ts for why synthetic dispatch is not enough).
// The edit layout opens on the "users" table of the shared "E2E ERD" board; the
// column editor is closed with Escape, so nothing is written.
import { expect, test } from '@playwright/test'
import { HEADER_H, ROW_H, getViewportScale, tableNode } from './canvas-helpers'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1720, height: 1000 } })

const WB_URL = `/whiteboard/${IDS.whiteboard}`
const COLUMN_EDITOR = 'input.nodrag.nowheel'

async function openBoard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
  await expect(tableNode(page, 'users')).toBeVisible()
}

/** Double-click the first column row of "users": the edit layout opens with that column's name editor focused. */
async function openColumnEditor(page: Page) {
  // At the fit-view zoom the table is large and the fields drawer covers its header buttons.
  const zoomOut = page.getByTitle('Zoom Out (Ctrl/Cmd + -)')
  for (let i = 0; i < 8 && (await getViewportScale(page)) > 1; i++) {
    await zoomOut.click()
  }
  const scale = await getViewportScale(page)
  await tableNode(page, 'users').dblclick({
    position: { x: 60 * scale, y: (HEADER_H + ROW_H / 2) * scale },
  })
  const editor = page.locator(COLUMN_EDITOR)
  await expect(editor).toBeFocused()
  return editor
}

test('one click on "Edit table note" commits the open column editor and opens the note popover', async ({
  page,
}) => {
  await openBoard(page)
  await openColumnEditor(page)

  await page.getByRole('button', { name: 'Edit table note' }).click()

  await expect(
    page.getByPlaceholder('Add a note for this table...'),
  ).toBeVisible()
  await expect(page.locator(COLUMN_EDITOR)).toHaveCount(0)
})

test('one click on "Delete table" opens the delete dialog while a column editor is open', async ({
  page,
}) => {
  await openBoard(page)
  await openColumnEditor(page)

  await page.getByRole('button', { name: 'Delete table users' }).click()

  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('one click on "Show relations" opens the relations panel while a column editor is open', async ({
  page,
}) => {
  await openBoard(page)
  await openColumnEditor(page)

  await page.getByTestId('table-relations-trigger').click()

  await expect(page.getByTestId('table-relations-panel')).toBeAttached()
  await page.getByTestId('table-relations-trigger').click()
})

// e2e/navigator-row-actions.spec.ts
// Navigator row actions float as a vertical column just outside the panel's
// right edge instead of covering the row name. Seeded by
// e2e/seed-navigator.ts (project "Nav Project": Design > Specs folders, an
// ERD board and a canvas board nested under Specs).
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Locator, Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-navigator.ts'], { stdio: 'inherit' })
})

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no bounding box')
  return b
}

/** Park the pointer away from the navigator and wait for every column to hide. */
async function settle(page: Page) {
  await page.mouse.move(800, 500)
  await expect(page.getByTestId('row-actions-column')).toHaveCount(0)
}

async function expandTree(page: Page, panel: Locator) {
  const toggle = panel.getByRole('button', { name: 'Toggle Nav Project tree' })
  const design = panel.getByText('Design', { exact: true })
  if (!(await design.isVisible())) await toggle.click()
  await expect(design).toBeVisible()
  const specs = panel.getByText('Specs', { exact: true })
  if (!(await specs.isVisible())) {
    await panel
      .locator('div.group')
      .filter({ has: page.getByText('Design', { exact: true }) })
      .locator('button:not([title])')
      .click()
  }
  await expect(specs).toBeVisible()
  const specsToggle = panel
    .locator('div.group')
    .filter({ has: page.getByText('Specs', { exact: true }) })
    .locator('button:not([title])')
  const sketch = panel.getByRole('link', {
    name: 'Quarterly Flow Sketch',
    exact: true,
  })
  if (!(await sketch.isVisible())) await specsToggle.click()
  await expect(sketch).toBeVisible()
  await settle(page)
}

/**
 * Hover the row, then check the column's geometry and that the pointer can
 * travel from the row into the column and use a button.
 */
async function checkRow(
  page: Page,
  panel: Locator,
  row: Locator,
  renameHeading: string,
  expectedButtons: number,
) {
  const name = row.locator('span.truncate').first()
  const column = page.getByTestId('row-actions-column')
  await settle(page)
  await row.hover()
  await expect(column).toBeVisible()

  const panelBox = await box(panel)
  const columnBox = await box(column)
  const nameBox = await box(name)
  const rowBox = await box(row)

  // Outside the panel's right edge, 6px gap, top aligned with the row.
  expect(columnBox.x).toBeGreaterThanOrEqual(panelBox.x + panelBox.width)
  expect(Math.abs(columnBox.y - rowBox.y)).toBeLessThanOrEqual(2)

  // Vertical stack: same x, increasing y.
  const buttons = column.getByRole('button')
  await expect(buttons).toHaveCount(expectedButtons)
  const boxes = []
  for (let i = 0; i < expectedButtons; i++)
    boxes.push(await box(buttons.nth(i)))
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].x).toBeCloseTo(boxes[0].x, 0)
    expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y)
  }

  // The column never covers the row name.
  const overlaps =
    columnBox.x < nameBox.x + nameBox.width &&
    columnBox.x + columnBox.width > nameBox.x &&
    columnBox.y < nameBox.y + nameBox.height &&
    columnBox.y + columnBox.height > nameBox.y
  expect(overlaps).toBe(false)

  // Pointer travels row -> gap -> column (level with the row, onto the first
  // button), then down the column; the column stays open throughout.
  const rename = column.getByRole('button', { name: 'Rename' })
  const first = boxes[0]
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, {
    steps: 25,
  })
  await expect(column).toBeVisible()
  const renameBox = await box(rename)
  await page.mouse.move(
    renameBox.x + renameBox.width / 2,
    renameBox.y + renameBox.height / 2,
    { steps: 10 },
  )
  await expect(column).toBeVisible()
  await rename.click()
  await expect(page.getByRole('heading', { name: renameHeading })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: renameHeading })).toBeHidden()
}

test.describe('Navigator row actions float outside the panel', () => {
  test('desktop sidebar: all four row types', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('aside')
    await expect(
      panel.getByRole('button', { name: 'Toggle Nav Project tree' }),
    ).toBeVisible()
    await expandTree(page, panel)

    // Project: New board, New Folder, Rename, Delete.
    await checkRow(
      page,
      panel,
      panel
        .locator('div.group')
        .filter({ has: page.getByText('Nav Project', { exact: true }) }),
      'Edit Project',
      4,
    )
    // Folder: New board, New Subfolder, Rename, Delete.
    await checkRow(
      page,
      panel,
      panel
        .locator('div.group')
        .filter({ has: page.getByText('Design', { exact: true }) }),
      'Rename Folder',
      4,
    )
    // Whiteboard and canvas board: Rename, Delete.
    await checkRow(
      page,
      panel,
      panel
        .getByRole('link', { name: 'Quarterly Orders ERD', exact: true })
        .locator('xpath=..'),
      'Rename Whiteboard',
      2,
    )
    await checkRow(
      page,
      panel,
      panel
        .getByRole('link', { name: 'Quarterly Flow Sketch', exact: true })
        .locator('xpath=..'),
      'Rename Canvas Board',
      2,
    )
  })

  test('buttons show a pointer cursor and a hover background', async ({
    page,
  }) => {
    await page.goto('/')
    const panel = page.locator('aside')
    await expandTree(page, panel)
    await panel
      .getByRole('link', { name: 'Quarterly Orders ERD', exact: true })
      .locator('xpath=..')
      .hover()
    const column = page.getByTestId('row-actions-column')
    await expect(column).toBeVisible()
    for (const name of ['Rename', 'Delete']) {
      const button = column.getByRole('button', { name })
      await page.mouse.move(800, 500)
      await panel
        .getByRole('link', { name: 'Quarterly Orders ERD', exact: true })
        .hover()
      const bg = () =>
        button.evaluate((el) => getComputedStyle(el).backgroundColor)
      const rest = await bg()
      expect(await button.evaluate((el) => getComputedStyle(el).cursor)).toBe(
        'pointer',
      )
      await button.hover()
      await expect.poll(bg).not.toBe(rest)
    }
  })

  test('column hides when the pointer leaves, and shows on keyboard focus', async ({
    page,
  }) => {
    await page.goto('/')
    const panel = page.locator('aside')
    await expandTree(page, panel)
    const row = panel
      .getByRole('link', { name: 'Quarterly Orders ERD', exact: true })
      .locator('xpath=..')
    const column = page.getByTestId('row-actions-column')

    await row.hover()
    await expect(column).toBeVisible()
    await page.mouse.move(800, 500)
    await expect(column).toBeHidden()

    // A key press first, so the focus counts as keyboard focus.
    await page.keyboard.press('Shift')
    await row.getByRole('link').focus()
    await expect(column).toBeVisible()
  })

  test('navigator drawer: column is not clipped by the sheet', async ({
    page,
  }) => {
    await page.goto(`/whiteboard/${IDS.navRootBoard}?canvas=0`)
    await expect(async () => {
      await page.getByRole('button', { name: 'Show project navigator' }).click()
      await expect(page.getByTestId('navigator-drawer')).toBeVisible({
        timeout: 2_000,
      })
    }).toPass()
    const drawer = page.getByTestId('navigator-drawer')
    await expandTree(page, drawer)
    await checkRow(
      page,
      drawer,
      drawer
        .getByRole('link', { name: 'Quarterly Flow Sketch', exact: true })
        .locator('xpath=..'),
      'Rename Canvas Board',
      2,
    )
  })
})

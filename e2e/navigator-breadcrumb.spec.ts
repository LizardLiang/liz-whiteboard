// e2e/navigator-breadcrumb.spec.ts
// Breadcrumb folder picker + navigator search. Seeded by e2e/seed-navigator.ts
// (project "Nav Project": Design > Specs nested folders, whiteboards and a
// canvas board). Whiteboards open with ?canvas=0 so the whiteboard route
// renders its DOM surface; the chip is the same on /canvas/$id.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

/**
 * Open the slide-over navigator. The first click can land before React has
 * hydrated the button, so retry until the drawer is actually up.
 */
async function openNavigator(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Show project navigator' }).click()
    await expect(page.getByTestId('navigator-drawer')).toBeVisible({
      timeout: 2_000,
    })
  }).toPass()
}

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-navigator.ts'], { stdio: 'inherit' })
})

test.describe('Breadcrumb picker', () => {
  test('lists a path, drills into a sub-folder and jumps to a board', async ({
    page,
  }) => {
    await page.goto(`/whiteboard/${IDS.navSpecsBoard}?canvas=0`)
    const chip = page.getByTestId('board-chip')
    await expect(
      chip.getByRole('heading', { name: 'Quarterly Orders ERD' }),
    ).toBeVisible()

    // Open the "Design" ancestor: its direct children, folders first.
    await chip.getByRole('button', { name: 'Browse Design' }).click()
    const picker = page.getByTestId('breadcrumb-picker')
    await expect(picker).toBeVisible()
    await expect(picker.locator('[data-entry-name]')).toHaveText([
      /Specs/,
      /Design Overview/,
    ])
    await expect(picker.locator('[data-entry-type="folder"]')).toHaveCount(1)
    await expect(picker.locator('[data-entry-type="whiteboard"]')).toHaveCount(
      1,
    )

    // Drill into Specs: both boards, the current one marked, canvas icon.
    await picker.getByRole('option', { name: /Specs/ }).click()
    await expect(
      picker.getByRole('option', { name: /Back to Design/ }),
    ).toBeVisible()
    await expect(picker.locator('[data-entry-type="canvas"]')).toHaveCount(1)
    await expect(
      picker.getByRole('option', { name: /Quarterly Orders ERD/ }),
    ).toHaveAttribute('aria-current', 'page')

    // Filter narrows the list.
    await picker.getByRole('combobox').fill('sketch')
    await expect(picker.locator('[data-entry-name]')).toHaveCount(1)
    await picker.getByRole('combobox').fill('zzz')
    await expect(picker.getByRole('status')).toHaveText('No matches')
    await picker.getByRole('combobox').fill('')

    // Back row climbs to the parent.
    await picker.getByRole('option', { name: /Back to Design/ }).click()
    await expect(
      picker.getByRole('option', { name: /Design Overview/ }),
    ).toBeVisible()
    await picker.getByRole('option', { name: /Specs/ }).click()

    // Pick the canvas board: lands on its route, popover closes.
    await picker.getByRole('option', { name: /Quarterly Flow Sketch/ }).click()
    await expect(page).toHaveURL(new RegExp(`/canvas/${IDS.navSpecsCanvas}`))
    await expect(page.getByTestId('breadcrumb-picker')).toHaveCount(0)
  })

  test('shows an empty state and opens the folder page', async ({ page }) => {
    await page.goto(`/whiteboard/${IDS.navRootBoard}?canvas=0`)
    const chip = page.getByTestId('board-chip')
    await chip.getByRole('button', { name: 'Browse Nav Project' }).click()
    const picker = page.getByTestId('breadcrumb-picker')
    await picker.getByRole('option', { name: /Empty Folder/ }).click()
    await expect(picker.getByRole('status')).toHaveText('This folder is empty')

    await picker.getByRole('option', { name: /Open folder page/ }).click()
    await expect(page).toHaveURL(
      new RegExp(`/project/${IDS.navProject}/folder/${IDS.navEmptyFolder}`),
    )
  })

  test('keyboard: Esc closes, arrows and Enter pick a board', async ({
    page,
  }) => {
    await page.goto(`/whiteboard/${IDS.navSpecsBoard}?canvas=0`)
    const chip = page.getByTestId('board-chip')
    await chip.getByRole('button', { name: 'Browse Specs' }).click()
    await expect(page.getByTestId('breadcrumb-picker')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('breadcrumb-picker')).toHaveCount(0)

    await chip.getByRole('button', { name: 'Browse Specs' }).click()
    await page
      .getByTestId('breadcrumb-picker')
      .getByRole('combobox')
      .fill('flow')
    // With a filter active the first match is selected; Enter opens it.
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/canvas/${IDS.navSpecsCanvas}`))
  })

  test('keyboard: arrow keys move the selection', async ({ page }) => {
    await page.goto(`/whiteboard/${IDS.navSpecsBoard}?canvas=0`)
    await page
      .getByTestId('board-chip')
      .getByRole('button', { name: 'Browse Specs' })
      .click()
    const picker = page.getByTestId('breadcrumb-picker')
    await picker.getByRole('combobox').fill('quarterly')
    const flow = picker.getByRole('option', { name: /Quarterly Flow Sketch/ })
    const orders = picker.getByRole('option', { name: /Quarterly Orders ERD/ })
    await expect(flow).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(orders).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await expect(flow).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('Navigator search', () => {
  test('finds a board by part of its name and jumps to it with Enter', async ({
    page,
  }) => {
    await page.goto(`/whiteboard/${IDS.navRootBoard}?canvas=0`)
    await openNavigator(page)
    const drawer = page.getByTestId('navigator-drawer')
    const search = drawer.getByRole('combobox', {
      name: 'Search boards and folders',
    })

    // Typing "[" in the box must not toggle the drawer.
    await search.press('[')
    await expect(drawer).toBeVisible()
    await expect(search).toHaveValue('[')

    await search.fill('quarterly orders')
    const result = drawer.getByRole('option', { name: /Quarterly Orders ERD/ })
    await expect(result).toBeVisible()
    await expect(result.getByTestId('search-result-path')).toHaveText(
      'Nav Project / Design / Specs',
    )
    // The seeded canvas board does not match.
    await expect(
      drawer.getByRole('option', { name: /Flow Sketch/ }),
    ).toHaveCount(0)

    await search.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/whiteboard/${IDS.navSpecsBoard}`))
    await expect(drawer).toHaveCount(0)
  })

  test('folder results open the folder page, Esc clears before it closes', async ({
    page,
  }) => {
    await page.goto(`/whiteboard/${IDS.navRootBoard}?canvas=0`)
    await openNavigator(page)
    const drawer = page.getByTestId('navigator-drawer')
    const search = drawer.getByRole('combobox', {
      name: 'Search boards and folders',
    })

    await search.fill('SPECS')
    await expect(drawer.getByRole('option')).toHaveCount(1)
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('option')).toHaveCount(0)

    await search.fill('specs')
    await drawer.getByRole('option', { name: /Specs/ }).click()
    await expect(page).toHaveURL(
      new RegExp(`/project/${IDS.navProject}/folder/${IDS.navSpecsFolder}`),
    )
  })
})

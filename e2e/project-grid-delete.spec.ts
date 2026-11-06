// e2e/project-grid-delete.spec.ts
// Delete buttons on the ERD and canvas cards of the project page grid.
// Seeded by e2e/seed-grid-delete.ts (project "Grid Delete Project", viewer is
// ADMIN). Auth comes from global-setup (storageState).
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const PROJECT_URL = `/project/${IDS.gridDelProject}`

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-grid-delete.ts'], { stdio: 'inherit' })
})

async function openProject(page: Page) {
  await page.goto(PROJECT_URL)
  await expect(page.getByText('Grid Drop ERD')).toBeVisible()
}

test.describe('Project grid delete buttons', () => {
  test('delete an ERD card through the confirm dialog', async ({ page }) => {
    await openProject(page)
    await page.getByRole('button', { name: 'Delete Grid Drop ERD' }).click()
    // The click must not navigate to the board.
    await expect(page).toHaveURL(new RegExp(`${PROJECT_URL}$`))

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete Whiteboard')
    await expect(dialog).toContainText('Grid Drop ERD')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Grid Drop ERD')).toHaveCount(0)
    await expect(page.getByText('Grid Keep ERD')).toBeVisible()
    await expect(page.getByText('Grid Drop Canvas')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Grid Keep ERD')).toBeVisible()
    await expect(page.getByText('Grid Drop ERD')).toHaveCount(0)
  })

  test('delete a canvas card through the confirm dialog', async ({ page }) => {
    await openProject(page)
    await page.getByRole('button', { name: 'Delete Grid Drop Canvas' }).click()
    await expect(page).toHaveURL(new RegExp(`${PROJECT_URL}$`))

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete Canvas Board')
    await expect(dialog).toContainText('Grid Drop Canvas')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Grid Drop Canvas')).toHaveCount(0)
    await expect(page.getByText('Grid Keep Canvas')).toBeVisible()
    await expect(page.getByText('Grid Drop ERD')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Grid Keep Canvas')).toBeVisible()
    await expect(page.getByText('Grid Drop Canvas')).toHaveCount(0)
  })

  test('Cancel keeps the card', async ({ page }) => {
    await openProject(page)
    for (const name of ['Grid Drop ERD', 'Grid Drop Canvas']) {
      await page.getByRole('button', { name: `Delete ${name}` }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByText(name)).toBeVisible()
    }
    await page.reload()
    await expect(page.getByText('Grid Drop ERD')).toBeVisible()
    await expect(page.getByText('Grid Drop Canvas')).toBeVisible()
  })
})

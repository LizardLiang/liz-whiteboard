// e2e/erd-shapes-hidden.spec.ts
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.shapesWhiteboard}`

const SHAPE_IDS = [
  IDS.rectShape,
  IDS.ellipseShape,
  IDS.diamondShape,
  IDS.textShape,
  IDS.lineShape,
]

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-shapes.ts'], { stdio: 'inherit' })
})

function shapeNode(page: Page, shapeId: string) {
  return page.locator(`.react-flow__node[data-id="${shapeId}"]`)
}

function connectorEdge(page: Page, connectorId: string) {
  return page.locator(`.react-flow__edge[data-id="${connectorId}"]`)
}

test.describe('ERD hides shapes and connectors', () => {
  test('edit view renders none of the seeded shapes/connectors, no shape-drawing tools, but the board\'s own tables still render', async ({
    page,
  }) => {
    await page.goto(WB_URL)
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(page.getByText('Connected')).toBeVisible()

    await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()

    for (const id of SHAPE_IDS) {
      await expect(shapeNode(page, id)).toHaveCount(0)
    }
    await expect(connectorEdge(page, IDS.shapeConnector)).toHaveCount(0)

    for (const tool of ['rectangle', 'ellipse', 'diamond', 'arrow', 'text']) {
      await expect(
        page.locator(`[data-testid="shape-tool-${tool}"]`),
      ).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: 'Add area' })).toBeVisible()
  })

  test('public share-link view renders none of the seeded shapes/connectors either', async ({
    page,
    browser,
  }) => {
    await page.goto(`/project/${IDS.shapesProject}`)
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes Project' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Share' }).click()
    await expect(
      page.getByRole('heading', { name: 'Share Project' }),
    ).toBeVisible()
    await page.getByRole('combobox', { name: 'Select whiteboard' }).click()
    await page.getByRole('option', { name: 'E2E Shapes' }).click()
    const create = page.getByRole('button', {
      name: 'Create read-only share link',
    })
    await expect(create).toBeEnabled()
    await create.click()
    const linkInput = page.getByRole('textbox', { name: 'Share link' })
    await expect(linkInput).toBeVisible()
    const shareUrl = await linkInput.inputValue()

    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const visitor = await context.newPage()
    await visitor.goto(shareUrl)

    await expect(
      visitor.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(
      visitor.locator('[data-table-name="shapes_a"]'),
    ).toBeVisible()

    for (const id of SHAPE_IDS) {
      await expect(shapeNode(visitor, id)).toHaveCount(0)
    }
    await expect(connectorEdge(visitor, IDS.shapeConnector)).toHaveCount(0)
    await expect(
      visitor.locator('[data-testid="shape-tool-palette"]'),
    ).toHaveCount(0)

    await context.close()
  })
})

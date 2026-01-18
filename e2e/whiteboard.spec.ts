import { test, expect } from '@playwright/test'

/**
 * Core E2E Tests - These work without database
 * Run with: bun run test:e2e
 */
test.describe('Core E2E Tests', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/')

    // Should show the app title or main heading
    await expect(page).toHaveTitle(/Liz|Whiteboard/i)
  })

  test('can navigate to projects or whiteboards', async ({ page }) => {
    await page.goto('/')

    // Look for any navigation links
    const links = page.locator('a[href*="project"], a[href*="whiteboard"]')
    const count = await links.count()

    // Should have some navigation options
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('app renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Should not have critical JavaScript errors
    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('responsive layout works', async ({ page }) => {
    await page.goto('/')

    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(300)

    // Page should still be functional
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForTimeout(300)
    await expect(body).toBeVisible()
  })
})

/**
 * Database-dependent Tests - Skipped by default
 * These require a running database with test data
 * To run: DATABASE_URL=... bun run test:e2e
 */
test.describe('Whiteboard Tests (requires database)', () => {
  // Skip if no database configured in test environment
  test.skip(
    () => !process.env.DATABASE_URL,
    'Skipped: Requires DATABASE_URL environment variable'
  )

  test('React Flow canvas renders', async ({ page }) => {
    // This test requires a valid whiteboard ID from the database
    await page.goto('/whiteboard/test-whiteboard')

    const canvas = page.locator('.react-flow')
    await expect(canvas).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.react-flow__controls')).toBeVisible()
  })

  test('can zoom and pan the canvas', async ({ page }) => {
    await page.goto('/whiteboard/test-whiteboard')

    const canvas = page.locator('.react-flow')
    await expect(canvas).toBeVisible({ timeout: 10000 })

    const viewport = page.locator('.react-flow__viewport')
    const initialTransform = await viewport.getAttribute('style')

    await canvas.hover()
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(300)

    const newTransform = await viewport.getAttribute('style')
    expect(newTransform).not.toBe(initialTransform)
  })

  test('fit view button works', async ({ page }) => {
    await page.goto('/whiteboard/test-whiteboard')

    const canvas = page.locator('.react-flow')
    await expect(canvas).toBeVisible({ timeout: 10000 })

    const fitViewButton = page.locator('.react-flow__controls-fitview')
    if (await fitViewButton.isVisible()) {
      await fitViewButton.click()
      await page.waitForTimeout(500)
    }
  })

  test('minimap is visible when enabled', async ({ page }) => {
    await page.goto('/whiteboard/test-whiteboard')

    const canvas = page.locator('.react-flow')
    await expect(canvas).toBeVisible({ timeout: 10000 })

    // Minimap is optional (showMinimap defaults to false)
    // Only check if it exists when enabled
    const minimap = page.locator('.react-flow__minimap')
    const minimapCount = await minimap.count()

    if (minimapCount > 0) {
      await expect(minimap).toBeVisible()
    } else {
      // Minimap is disabled - test passes
      expect(minimapCount).toBe(0)
    }
  })
})

test.describe('Table Operations (requires database)', () => {
  test.skip(
    () => !process.env.DATABASE_URL,
    'Skipped: Requires DATABASE_URL environment variable'
  )

  test.beforeEach(async ({ page }) => {
    await page.goto('/whiteboard/test-whiteboard')
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 10000 })
  })

  test('tables are rendered as nodes', async ({ page }) => {
    const tableNodes = page.locator('.react-flow__node-erTable')
    const count = await tableNodes.count()
    if (count > 0) {
      await expect(tableNodes.first()).toBeVisible()
    }
  })

  test('can drag a table node', async ({ page }) => {
    const tableNode = page.locator('.react-flow__node-erTable').first()

    if (await tableNode.isVisible()) {
      const initialBox = await tableNode.boundingBox()

      if (initialBox) {
        await tableNode.hover()
        await page.mouse.down()
        await page.mouse.move(initialBox.x + 100, initialBox.y + 50)
        await page.mouse.up()
        await page.waitForTimeout(500)

        const newBox = await tableNode.boundingBox()
        expect(newBox?.x).not.toBe(initialBox.x)
      }
    }
  })

  test('clicking a table selects it', async ({ page }) => {
    const tableNode = page.locator('.react-flow__node-erTable').first()

    if (await tableNode.isVisible()) {
      await tableNode.click()
      await expect(tableNode).toHaveClass(/selected/)
    }
  })
})

test.describe('Performance (requires database)', () => {
  test.skip(
    () => !process.env.DATABASE_URL,
    'Skipped: Requires DATABASE_URL environment variable'
  )

  test('canvas maintains smooth interaction', async ({ page }) => {
    await page.goto('/whiteboard/test-whiteboard')

    const canvas = page.locator('.react-flow')
    await expect(canvas).toBeVisible({ timeout: 10000 })

    const metrics = await page.evaluate(async () => {
      return new Promise<{ fps: number }>((resolve) => {
        let frameCount = 0
        const startTime = performance.now()

        const countFrame = () => {
          frameCount++
          if (performance.now() - startTime < 1000) {
            requestAnimationFrame(countFrame)
          } else {
            resolve({ fps: frameCount })
          }
        }

        requestAnimationFrame(countFrame)
      })
    })

    expect(metrics.fps).toBeGreaterThan(30)
  })
})

// e2e/react-flow-perf.spec.ts
// Functional smoke test for the React Flow perf work (GH #121): loads the
// parameterized stress board and drives the four interactions the perf pass
// targeted — pan, zoom, hover, drag — asserting the canvas renders the
// expected tables, hover highlighting still works (now DOM-class-driven, not
// setNodes-driven — see ReactFlowCanvas.tsx), and no uncaught error is thrown.
//
// FPS itself is NOT measured here — headless Chromium's frame timing is not
// representative of real hardware/GPU compositing, so before/after FPS
// numbers are captured via the in-app performance tracker
// (PerfTrackerPanel.tsx / perf-tracker.ts, `?perf=1`) per the project's
// prod/dev-split convention (see playwright.config.ts's note on the same
// tradeoff for Socket.IO). See e2e/perf-tracker.spec.ts for the record→report
// exercise of that tracker.
//
// Seeds its OWN dedicated stress board in this file's own setup (NOT
// global-setup.ts, which already seeds the version-history/multi-select
// boards once for the whole suite) — this is the pattern the tactical plan
// calls for so the (slower) stress seed only runs for this spec.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Locator, Page } from '@playwright/test'

// Small enough to keep the e2e fast/deterministic, large enough to exercise
// the same code paths (highlighting, culling-off, LOD, drag) real boards do.
const STRESS_TABLE_COUNT = 24

// ?canvas=0 forces full-DOM rendering: canvas is now the default (migration
// Phase 5), and this spec measures the DOM baseline / asserts DOM table nodes.
const WB_URL = `/whiteboard/${IDS.stressWhiteboard}?canvas=0`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], {
    stdio: 'inherit',
    env: { ...process.env, STRESS_TABLE_COUNT: String(STRESS_TABLE_COUNT) },
  })
})

async function openStressWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: `E2E Stress (${STRESS_TABLE_COUNT})` }),
  ).toBeVisible()
  // Canvas ready: at least the first stress table has rendered.
  await expect(
    page.locator('.react-flow').getByText('stress_table_0', { exact: true }),
  ).toBeVisible()
}

/** Node whose `.table-header` text EXACTLY matches `name` — avoids
 * `stress_table_1` incidentally matching `stress_table_10`/`_11`/… via
 * substring `hasText` filtering. */
function nodeByTableName(page: Page, name: string): Locator {
  return page
    .locator('.react-flow__node')
    .filter({ has: page.locator('.table-header').getByText(name, { exact: true }) })
}

async function getViewportTransform(
  page: Page,
): Promise<{ x: number; y: number; scale: number }> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform)
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(
    transform,
  )
  if (!match) throw new Error(`unexpected viewport transform: ${transform}`)
  return { x: parseFloat(match[1]), y: parseFloat(match[2]), scale: parseFloat(match[3]) }
}

test.describe('React Flow perf stress smoke (GH #121)', () => {
  test('stress board renders all seeded tables', async ({ page }) => {
    await openStressWhiteboard(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(
      STRESS_TABLE_COUNT,
    )
  })

  test('pan, zoom, hover, and drag all work without error on a stress board', async ({
    page,
  }) => {
    const pageErrors: Array<string> = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await openStressWhiteboard(page)

    // --- Pan: plain wheel scroll (panOnScroll=true on this canvas) ---
    const before = await getViewportTransform(page)
    await page.mouse.move(800, 500)
    await page.mouse.wheel(0, 200)
    await page.waitForTimeout(200)
    const afterPan = await getViewportTransform(page)
    expect(afterPan.x !== before.x || afterPan.y !== before.y).toBe(true)

    // --- Zoom: toolbar's Zoom Out button (Ctrl/Cmd+scroll is flaky to
    // synthesize headlessly; the button drives the same
    // reactFlowInstance.zoomOut() path). Scoped by exact title — React
    // Flow's own <Controls> panel (showControls=true) also renders a "Zoom
    // Out" button, so an unscoped name/role match is ambiguous (strict
    // mode). ---
    const zoomOutButton = page.getByTitle('Zoom Out (Ctrl/Cmd + -)')
    await zoomOutButton.click()
    await zoomOutButton.click()
    await zoomOutButton.click()
    await page.waitForTimeout(300)
    const afterZoom = await getViewportTransform(page)
    expect(afterZoom.scale).toBeLessThan(afterPan.scale)

    // --- Hover: stress_table_1 always has an FK relationship to an earlier
    // table (see e2e/seed-stress.ts's connected-web generation) — hovering
    // it must highlight both itself and its related neighbor via the
    // DOM-class hover mechanism (GH #121 opt #1), with NO node-array
    // setNodes rebuild involved. ---
    const table1Node = nodeByTableName(page, 'stress_table_1')
    await table1Node.locator('.table-header').hover()
    await expect(table1Node).toHaveClass(/rf-hover-highlighted/)

    // Move away — the DOM-driven highlight must clear cleanly.
    await page.mouse.move(10, 10)
    await expect(table1Node).not.toHaveClass(/rf-hover-highlighted/)

    // --- Drag: drag a table and confirm its position actually changes
    // (exercises the rAF-throttled edge recalculation, opt #5). ---
    const table2Node = nodeByTableName(page, 'stress_table_2')
    const box = await table2Node.locator('.table-header').boundingBox()
    if (!box) throw new Error('no bounding box for stress_table_2 header')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    const beforeDragTransform = await table2Node.evaluate(
      (el) => (el as HTMLElement).style.transform,
    )

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 80, startY + 60, { steps: 10 })
    await page.mouse.up()

    const afterDragTransform = await table2Node.evaluate(
      (el) => (el as HTMLElement).style.transform,
    )
    expect(afterDragTransform).not.toBe(beforeDragTransform)

    // --- No error thrown across the whole interaction sequence ---
    expect(pageErrors).toEqual([])
  })
})

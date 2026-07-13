// e2e/perf-tracker.spec.ts
// Completion-gate e2e for the in-app performance tracker (GH #121 follow-up).
// Drives the real record -> gesture -> Stop -> JSON-report flow on a stress
// board and asserts the downloaded report captured per-gesture data.
//
// Mirrors e2e/react-flow-perf.spec.ts: seeds its OWN dedicated stress board in
// this file's setup (NOT global-setup.ts) so the slower stress seed only runs
// for the perf specs, and reuses the same gesture-driving helper patterns.
//
// Download vs dev fallback: the report is delivered as a Blob download
// (perf-tracker.ts `downloadReport`). Headless Chromium download events can be
// flaky, so — like the Socket.IO prod/dev split documented in
// playwright.config.ts — the tracker also stashes the last report on
// `window.__lastPerfReport` in non-prod (dev server, which is what
// `bun run test:e2e` runs against). We try the real download first and fall
// back to reading that global.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Locator, Page } from '@playwright/test'

const STRESS_TABLE_COUNT = 24

// Canvas is unconditional (canvas-unconditional-default) — no `?canvas` opt
// out. Table text is painted on <canvas>, not DOM — this spec (still
// measuring the `?perf=1` recorder, now against canvas rendering) asserts
// table presence/position via `tableNode()` (data-table-name).
const WB_URL = `/whiteboard/${IDS.stressWhiteboard}?perf=1`

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
  await expect(tableNode(page, 'stress_table_0')).toBeVisible()
}

/** `data-table-name` (both chrome-light and full-DOM roots) already matches
 * `name` exactly via the attribute selector — no substring risk between
 * `stress_table_1`/`stress_table_10` the way a `hasText` filter would have. */
function nodeByTableName(page: Page, name: string): Locator {
  return tableNode(page, name)
}

/** The chrome-light/full-DOM node div `nodeByTableName` resolves to is
 * nested INSIDE React Flow's own per-node wrapper (the element `.rf-hover-
 * highlighted` is toggled on, and the one carrying `data-id` — see
 * ReactFlowCanvas.tsx's DOM-class hover effect). Both our own root div and
 * RF's wrapper coincidentally share the literal class
 * `react-flow__node-erTable` (RF auto-derives it from the node `type`), so a
 * class-based ancestor search would be ambiguous — `data-id` is unique to
 * RF's wrapper. */
function rfNodeWrapper(node: Locator): Locator {
  return node.locator('xpath=ancestor::*[@data-id][1]')
}

test.describe('Perf tracker record -> report (GH #121 follow-up)', () => {
  test('panel mounts under ?perf=1 and records a per-gesture report', async ({
    page,
  }) => {
    const pageErrors: Array<string> = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await openStressWhiteboard(page)

    // Panel visible under the ?perf=1 flag.
    const panel = page.getByTestId('perf-tracker-panel')
    await expect(panel).toBeVisible()

    // --- Start recording ---
    const recordButton = page.getByTestId('perf-tracker-record')
    await expect(recordButton).toHaveText(/Record/)
    await recordButton.click()
    await expect(recordButton).toHaveText(/Stop/)

    // --- Pan: plain wheel scroll (panOnScroll=true) ---
    await page.mouse.move(800, 500)
    await page.mouse.wheel(0, 200)
    await page.waitForTimeout(250)

    // --- Zoom: toolbar Zoom Out (scale change => tagged 'zoom' via onMove) ---
    const zoomOutButton = page.getByTitle('Zoom Out (Ctrl/Cmd + -)')
    await zoomOutButton.click()
    await zoomOutButton.click()
    await page.waitForTimeout(250)

    // --- Hover: highlight a table (chrome-light has no `.table-header` —
    // React Flow's onNodeMouseEnter fires on the whole node, so hovering
    // anywhere on it is equivalent). The highlighted class lands on RF's own
    // wrapper, not the chrome-light div itself — see `rfNodeWrapper`. ---
    const table1Node = nodeByTableName(page, 'stress_table_1')
    await table1Node.hover()
    await expect(rfNodeWrapper(table1Node)).toHaveClass(/rf-hover-highlighted/)
    await page.waitForTimeout(250)
    await page.mouse.move(10, 10)

    // --- Drag: hold the button across several animation frames so the rAF
    // loop pushes frames tagged 'drag' (the key assertion below). Anchor
    // near the chrome-light node's own top-left (HEADER_H=34px tall, per
    // canvas-node-geometry.ts) rather than a `.table-header` text node's
    // center, avoiding a column-row handle. ---
    const table2Node = nodeByTableName(page, 'stress_table_2')
    const box = await table2Node.boundingBox()
    if (!box) throw new Error('no bounding box for stress_table_2')
    const startX = box.x + 20
    const startY = box.y + 10
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.waitForTimeout(120)
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(startX + i * 10, startY + i * 8)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(120)

    // --- Stop + capture the report (download primary, dev global fallback) ---
    let report: {
      meta: { tableCount: number; domNodeCount: number }
      perGesture: { drag: { frames: number } }
    } | null = null

    const downloadPromise = page
      .waitForEvent('download', { timeout: 4000 })
      .catch(() => null)
    await recordButton.click()
    await expect(recordButton).toHaveText(/Record/)

    const download = await downloadPromise
    if (download) {
      const path = await download.path()
      report = JSON.parse(readFileSync(path, 'utf-8'))
    } else {
      report = await page.evaluate(
        () =>
          (window as unknown as { __lastPerfReport?: unknown })
            .__lastPerfReport as never,
      )
    }

    expect(report, 'a perf report was produced').not.toBeNull()
    expect(report!.meta.tableCount).toBe(STRESS_TABLE_COUNT)
    expect(report!.meta.domNodeCount).toBeGreaterThan(0)
    expect(report!.perGesture.drag.frames).toBeGreaterThan(0)

    expect(pageErrors).toEqual([])
  })
})

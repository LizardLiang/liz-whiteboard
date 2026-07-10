// e2e/142-edge-ablation.spec.ts
// Completion-gate e2e for the perf edge-ablation toggle (GH #142). The toggle
// is the one code lever behind the pan/zoom bottleneck measurement: it drops
// the SVG relationship-edge layer so a record-with-edges vs record-without-
// edges pair attributes cost to the edges.
//
// Mirrors e2e/perf-tracker.spec.ts: seeds its OWN dedicated stress board in
// this file's setup (the slow stress seed only runs for the perf specs) and
// drives the real ?perf HUD. This asserts real DOM behavior — that edges leave
// and return the DOM while table nodes stay put — not a mocked flag.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const STRESS_TABLE_COUNT = 24

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
  await expect(
    page.locator('.react-flow').getByText('stress_table_0', { exact: true }),
  ).toBeVisible()
}

test.describe('Perf edge-ablation toggle (GH #142)', () => {
  test('Hide edges drops the edge layer, keeps nodes, restores on toggle', async ({
    page,
  }) => {
    const pageErrors: Array<string> = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await openStressWhiteboard(page)

    const edges = page.locator('.react-flow__edge')
    const nodes = page.locator('.react-flow__node')
    const toggle = page.getByTestId('perf-tracker-hide-edges')

    // Baseline: edges present, nodes present, toggle reads "on".
    await expect(toggle).toHaveText(/Edges: on/)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => edges.count()).toBeGreaterThan(0)
    const nodeCountBefore = await nodes.count()
    expect(nodeCountBefore).toBeGreaterThan(0)

    // --- Hide edges: the SVG edge layer leaves the DOM (render-level skip,
    // not CSS-hide), while every table node stays mounted. ---
    await toggle.click()
    await expect(toggle).toHaveText(/Edges: off/)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => edges.count()).toBe(0)
    expect(await nodes.count()).toBe(nodeCountBefore)

    // --- Toggle back: edges return. ---
    await toggle.click()
    await expect(toggle).toHaveText(/Edges: on/)
    await expect.poll(() => edges.count()).toBeGreaterThan(0)
    expect(await nodes.count()).toBe(nodeCountBefore)

    expect(pageErrors).toEqual([])
  })
})

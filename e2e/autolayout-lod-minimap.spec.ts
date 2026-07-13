// e2e/autolayout-lod-minimap.spec.ts
// End-to-end coverage for two canvas regressions fixed together (GH #151):
//
// Bug 1 — Auto-Layout used to read `node.measured.width/height`, which is
// the LOD-trimmed DOM box once zoomed below LOD_ZOOM_THRESHOLD (canvas
// mode's chrome-light node collapses to header-only — TableNode.tsx's
// `chromeLightHeight` shrinks via `computeTableHeight(0)` when
// `effectiveShowMode === 'TABLE_NAME'`). Positions got packed for that
// trimmed height; when zoomed back to full detail the real (full-column)
// height re-expands but the tables never re-position, so they end up
// overlapping. The fix (use-d3-force-layout.ts + elk-layout.ts) sizes every
// table node from its DATA (getCachedTableWidth/calculateTableHeight over
// the FULL column list) instead of `node.measured`, so layout output is
// zoom-independent.
//
// Seed note: this spec deliberately does NOT reuse e2e/seed-stress.ts's
// board. seed-stress.ts hardcodes `DiagramTable.height = 160` for every
// table; React Flow applies a persisted (non-null) `table.height` as an
// EXPLICIT inline CSS `height` on the `.react-flow__node` wrapper
// (convert-to-nodes.ts), which PINS `node.measured.height` to that constant
// — verified empirically, the wrapper's rendered height never changed
// across the LOD threshold on the stress board, only the (overflowing,
// non-clamping) inner chrome-light content did. Real user-created tables
// never persist a height (`diagram-table.ts` defaults `height` to `null`),
// so `node.height` stays `undefined` and the wrapper genuinely auto-sizes
// to content, reproducing the bug. e2e/seed-autolayout.ts seeds NULL
// heights to match that real-world shape — see its header comment.
//
// Bug 2 — CanvasNodeLayer's full-screen <canvas> painted at z-[1000], a
// sibling of React Flow's <MiniMap>/<Controls> panels (`.react-flow__panel`,
// z-index 5 per @xyflow/react's style.css) — visually burying them. Fixed
// by lowering the canvas to z-[4] (above `.react-flow__viewport`'s z-2,
// below panels' z-5).
//
// Bug 2 assertion note: `document.elementFromPoint` is NOT used here. The
// canvas carries `pointer-events-none` (by design — it's a paint-only
// layer), and per the CSS UI spec `pointer-events: none` also excludes an
// element from hit-testing (elementFromPoint), REGARDLESS of z-index —
// verified empirically (a z-index:1000 `pointer-events:none` div never
// wins elementFromPoint over a z-index:1 sibling; a z-index:1000 div
// WITHOUT pointer-events:none does). So elementFromPoint reports the same
// "winner" whether the canvas is z-4 or z-1000 — it can't discriminate the
// actual bug (a test built on it would pass even against the unfixed code,
// the "testing nothing" anti-pattern). Comparing the elements' own computed
// `z-index` directly is the correct way to assert the paint-order
// acceptance criterion — confirmed RED (canvas z-index 1000 > minimap/
// controls z-index 5) against the pre-fix code and GREEN (4 < 5) against
// the fix while developing this spec.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import {
  getViewportScale,
  zoomAboveLodThreshold,
  zoomBelowLodThreshold,
} from './canvas-helpers'
import { IDS } from './fixtures'

// >= 4 tables (spec-delta requirement), 10 columns each (seed-autolayout.ts)
// — large enough that the LOD-collapsed (34px header-only) vs. full-detail
// (34 + 10*28 = 314px) height delta swamps the 48px minimum layout gap.
const TABLE_COUNT = 5

const WB_URL = `/whiteboard/${IDS.autoLayoutWhiteboard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-autolayout.ts'], { stdio: 'inherit' })
})

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  )
}

test.describe('Auto-Layout LOD sizing + Minimap z-index (GH #151)', () => {
  test('Bug 1: zoom out below LOD -> Auto Layout -> zoom back in shows no table overlap', async ({
    page,
  }) => {
    await page.goto(WB_URL)
    await expect(
      page.getByRole('heading', {
        name: `E2E Auto-Layout LOD (${TABLE_COUNT})`,
      }),
    ).toBeVisible()
    // Canvas mode is the unconditional default — readiness signal is the
    // canvas layer itself painting (per canvas-rendering.spec.ts's pattern).
    await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
    await expect(
      page.locator('[data-testid="table-node-chrome-light"]'),
    ).toHaveCount(TABLE_COUNT)

    // Drive the board below LOD_ZOOM_THRESHOLD — every table collapses to
    // its header-only box here (the trimmed box the pre-fix layout used to
    // read via `node.measured`).
    await zoomBelowLodThreshold(page)
    expect(await getViewportScale(page)).toBeLessThan(0.35)

    // Run Auto Layout while zoomed out. tableCount (5) is well under the
    // >50 threshold that gates the confirm dialog, so it runs immediately.
    await page.getByRole('button', { name: 'Auto Layout' }).click()
    await expect(
      page.getByText(`Layout applied to ${TABLE_COUNT} tables`),
    ).toBeVisible()

    // Zoom back to full detail (LOD off) — tables re-expand to full height.
    await zoomAboveLodThreshold(page)
    expect(await getViewportScale(page)).toBeGreaterThanOrEqual(0.35)

    // Let the post-zoom re-render settle before reading geometry.
    await page.waitForTimeout(300)

    // Measure the chrome-light node's own box (`table-node-chrome-light`),
    // NOT `.react-flow__node` — the outer React-Flow-managed wrapper only
    // reflects an explicit `node.height` when one was persisted; with NULL
    // heights (this seed) it still auto-sizes to content in practice, but
    // the chrome-light div is the actual visually-painted table box (and
    // the one CanvasNodeLayer's canvas draw paints in lockstep with), so
    // it's the correct element to assert "no visual overlap" against.
    const boxes = await page
      .locator('[data-testid="table-node-chrome-light"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect()
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        }),
      )
    expect(boxes.length).toBe(TABLE_COUNT)

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          overlaps(boxes[i], boxes[j]),
          `table node ${i} and table node ${j} overlap after zoom-in: ${JSON.stringify(boxes[i])} vs ${JSON.stringify(boxes[j])}`,
        ).toBe(false)
      }
    }
  })

  test('Bug 2: canvas node layer paints below Minimap/Controls, above the node viewport', async ({
    page,
  }) => {
    await page.goto(WB_URL)
    await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    await expect(page.locator('.react-flow__controls')).toBeVisible()

    const canvasZ = await page
      .getByTestId('canvas-node-layer')
      .evaluate((el) => Number(getComputedStyle(el).zIndex))
    const minimapZ = await page
      .locator('.react-flow__minimap')
      .evaluate((el) => Number(getComputedStyle(el).zIndex))
    const controlsZ = await page
      .locator('.react-flow__controls')
      .evaluate((el) => Number(getComputedStyle(el).zIndex))
    const viewportZ = await page
      .locator('.react-flow__viewport')
      .evaluate((el) => Number(getComputedStyle(el).zIndex))

    // Below chrome panels (MiniMap + Controls, z-5) — they now paint on top.
    expect(canvasZ).toBeLessThan(minimapZ)
    expect(canvasZ).toBeLessThan(controlsZ)
    // Still above the node viewport/edges renderer (z-2) — nodes keep
    // painting over edges (out of scope of this fix; must not regress).
    expect(canvasZ).toBeGreaterThan(viewportZ)
  })
})

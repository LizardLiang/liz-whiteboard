// e2e/canvas-rendering.spec.ts
// Functional e2e for the canvas-node-rendering migration's Phase 1 (DOM
// strip + perf gate) — see
// .claude/.Arena/tactical-plans/canvas-node-rendering-migration.md. Seeds
// its OWN dedicated stress board (mirrors e2e/react-flow-perf.spec.ts's
// pattern: the slower stress seed only runs for the perf/canvas specs) and,
// under `?canvas=1`, asserts:
//  - the CanvasNodeLayer <canvas> actually paints (data-testid=
//    "canvas-node-layer")
//  - existing relationship edges stay attached (the top migration risk —
//    the tactical plan's "Handle preservation is the top risk" assumption)
//  - a NEW relationship can still be created by dragging from one column's
//    handle to another (drag-to-connect must keep working once TableNode
//    strips down to its chrome-light, handles-only form — "Column handle
//    preservation for edges" spec-delta requirement)
//  - multi-select + drag still works against the chrome-light node (Phase 1
//    keeps interaction fully RF-native via the still-present handles +
//    wrapper div; canvas hit-testing is Phase 2, out of scope here)
//
// FPS/perf itself is intentionally NOT asserted here — see
// e2e/react-flow-perf.spec.ts's header comment for why headless Chromium
// frame timing isn't representative of real hardware/GPU compositing. The
// real Phase 1 gate is a human, real-hardware `?perf=1&canvas=1` pan
// session (tactical plan, Phase 1 VERIFY step) — this spec only proves the
// DOM-strip + handle-preservation behavior is correct, not that it's fast.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Locator, Page } from '@playwright/test'

// Small enough to keep the e2e fast/deterministic, large enough to exercise
// the same code paths (showMode parity, multi-node handle layout) real
// dense boards do. Matches react-flow-perf.spec.ts's count.
const STRESS_TABLE_COUNT = 24

const WB_URL = `/whiteboard/${IDS.stressWhiteboard}?canvas=1`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], {
    stdio: 'inherit',
    env: { ...process.env, STRESS_TABLE_COUNT: String(STRESS_TABLE_COUNT) },
  })
})

async function openStressWhiteboardCanvasMode(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: `E2E Stress (${STRESS_TABLE_COUNT})` }),
  ).toBeVisible()
  // Canvas mode strips the per-table DOM header text (see "DOM strip to
  // handles-only anchors") — the readiness signal is the canvas layer
  // itself painting, not any per-table DOM text.
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
}

/** Chrome-light table nodes (canvas mode) — each carries
 * `data-testid="table-node-chrome-light"` (TableNode.tsx's `canvasMode`
 * branch), in the DOM order React Flow received them (table creation
 * order from the seed). */
function chromeLightNodes(page: Page): Locator {
  return page.locator('[data-testid="table-node-chrome-light"]')
}

/** The Nth column's handle within a chrome-light node. ColumnHandles.tsx
 * always renders a column's four handles in this fixed order: left-source
 * (0), left-target (1), right-source (2), right-target (3) — so column
 * index `columnIndex`'s `which` handle is at flat index
 * `columnIndex * 4 + offset`.
 *
 * Column index 1 (DB `order` = 1) is always a plain `field_1` column in the
 * stress seed's shape — seed-stress.ts only ever wires a relationship to
 * the PK `id` column (order 0, index 0) as target and a later-appended FK
 * column (order >= 100, last index) as source. Picking index 1 on any two
 * distinct tables is therefore guaranteed to have NO pre-existing edge
 * between them, so a drag between two index-1 handles proves a genuinely
 * NEW connection was created. */
function columnHandle(
  node: Locator,
  columnIndex: number,
  which: 'left-source' | 'left-target' | 'right-source' | 'right-target',
): Locator {
  const offset = {
    'left-source': 0,
    'left-target': 1,
    'right-source': 2,
    'right-target': 3,
  }[which]
  return node.locator('[data-handleid]').nth(columnIndex * 4 + offset)
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no bounding box for locator')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A chrome-light node's inline `translate(x,y)` transform lives on React
 * Flow's own generated `.react-flow__node` wrapper (an ancestor of what
 * TableNode renders), not on the `data-testid="table-node-chrome-light"`
 * div itself. */
async function nodeTransform(locator: Locator): Promise<string> {
  return locator.evaluate(
    (el) => (el.closest('.react-flow__node') as HTMLElement).style.transform,
  )
}

test.describe('Canvas node rendering — Phase 1 (DOM strip + perf gate)', () => {
  test('canvas layer renders, DOM strips to handles-only, edges stay attached', async ({
    page,
  }) => {
    const pageErrors: Array<string> = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await openStressWhiteboardCanvasMode(page)

    // Every seeded table renders as a chrome-light node (DOM strip active).
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT)

    // The stripped node carries no header text/buttons — the canvas layer
    // is the only place table names/columns are painted.
    await expect(page.locator('.table-header')).toHaveCount(0)

    // seed-stress.ts's "connected web" gives every table index >= 1 exactly
    // one outgoing relationship (STRESS_TABLE_COUNT - 1 edges total) — the
    // top migration risk (tactical plan: "Handle preservation is the top
    // risk") is edges silently detaching once the DOM strips to
    // handles-only, so this must stay non-zero and edge elements must
    // actually mount.
    await expect(page.locator('.react-flow__edge')).not.toHaveCount(0)

    expect(pageErrors).toEqual([])
  })

  test('drag-to-connect from a column handle still creates a new edge under canvas mode', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    const edges = page.locator('.react-flow__edge')
    const edgeCountBefore = await edges.count()

    const nodeA = chromeLightNodes(page).nth(0)
    const nodeB = chromeLightNodes(page).nth(1)

    const source = columnHandle(nodeA, 1, 'right-source')
    const target = columnHandle(nodeB, 1, 'left-target')

    // Source handles are `pointer-events: none` by default (project theme
    // override — see LodColumnRow's `column-row` class comment in
    // TableNode.tsx) and only become interactive on `.column-row` hover.
    // The hover-revealed hit box sits partly OUTSIDE its row's own painted
    // rect (handles are offset -14px/+14px past the row edge), so a plain
    // synthetic mousemove into that dead zone loses the row's `:hover`
    // before it ever reaches the handle. Real users get there via
    // continuous physical pointer motion; here we (1) move the mouse into
    // the row first — a real coordinate-based hover — then (2) dispatch the
    // connection-starting `mousedown` DIRECTLY on the handle element via
    // `dispatchEvent`, which targets the element explicitly and so isn't
    // subject to the hit-testing pointer-events restriction the CSS uses to
    // hide the dot from stray clicks. The rest of the gesture (move/up) are
    // real synthetic events dispatched at the document level, same as any
    // other drag.
    const row = nodeA.locator('.column-row').nth(1)
    const rowBox = await row.boundingBox()
    if (!rowBox) throw new Error('no bounding box for source row')
    await page.mouse.move(
      rowBox.x + rowBox.width / 2,
      rowBox.y + rowBox.height / 2,
    )

    const from = await centerOf(source)
    const to = await centerOf(target)

    await source.dispatchEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: from.x,
      clientY: from.y,
    })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()

    // Connecting two columns opens the cardinality-selection dialog
    // (ReactFlowWhiteboard.tsx's `pendingConnection` flow) rather than
    // creating the relationship immediately — confirm it to finalize.
    await page
      .getByRole('button', { name: 'Create', exact: true })
      .click()

    await expect(edges).toHaveCount(edgeCountBefore + 1)
  })

  test('multi-select-drag still works against a chrome-light node', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    const nodeA = chromeLightNodes(page).nth(2)
    const nodeB = chromeLightNodes(page).nth(3)

    // Click directly on the chrome-light wrapper (no `.table-header` exists
    // under canvas mode) — React Flow's node select/drag handlers bind to
    // the whole node body, not a specific inner element, so this exercises
    // the same native select/drag path the pre-canvas DOM relied on.
    await nodeA.click()
    await nodeB.click({ modifiers: ['Control'] })

    const beforeA = await nodeTransform(nodeA)
    const beforeB = await nodeTransform(nodeB)

    const start = await centerOf(nodeA)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 60, start.y + 40, { steps: 10 })
    await page.mouse.up()

    const afterA = await nodeTransform(nodeA)
    const afterB = await nodeTransform(nodeB)

    // Both co-selected nodes moved — proof the drag applied to the whole
    // selection, not just the node the drag was initiated from.
    expect(afterA).not.toBe(beforeA)
    expect(afterB).not.toBe(beforeB)
  })
})

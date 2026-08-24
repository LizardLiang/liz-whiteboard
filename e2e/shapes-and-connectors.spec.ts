// e2e/shapes-and-connectors.spec.ts
// End-to-end coverage for shapes and connectors (Phase 1: shapes-and-
// connectors) — the mandatory Playwright completion gate per CLAUDE.md.
//
// Dev/prod broadcast note (mirrors version-history.spec.ts): Socket.IO does
// not fire in the dev Vite process (`io` is null there — server.dev.ts runs
// as a separate process from the Vite dev server that hosts server
// functions). Every case below that depends on a broadcast (move, restyle,
// connect, delete) asserts the PERSISTED result via reload, not a live
// second-client push.
//
// Isolation (Artemis's recommendation): this suite runs against a DEDICATED
// project/whiteboard (IDS.shapesProject/shapesWhiteboard), never the shared
// IDS.whiteboard — case "legacy snapshot restore" (E2E-20) wipes every shape
// on its board via a version restore, and sharing the board would corrupt
// other suites intermittently. Own seed script: e2e/seed-shapes.ts.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { E2E_VIEWER_USER, IDS } from './fixtures'
import type { Browser, Locator, Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.shapesWhiteboard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed.ts (global-setup) and seed-stress.ts (E2E_VIEWER_USER) must both
  // already exist — seed-shapes.ts reuses IDS.user (ADMIN) and
  // IDS.viewerUser (VIEWER) as this dedicated project's members. Run once:
  // seed-stress.ts only needs to exist so E2E_VIEWER_USER's account exists;
  // its own (unrelated) 100-table board is never touched by this suite.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  // Re-seed shapesWhiteboard before EVERY test (not just once) — several
  // cases mutate or destroy shape/connector rows (E2E-15's cascade delete,
  // E2E-20's legacy-restore wipe), and this suite's tests must stay
  // independent of each other's side effects rather than relying on
  // execution order alone.
  execFileSync('bun', ['run', 'e2e/seed-shapes.ts'], { stdio: 'inherit' })
})

function shapeNode(page: Page, shapeId: string) {
  return page.locator(`.react-flow__node[data-id="${shapeId}"]`)
}

function connectorEdge(page: Page, connectorId: string) {
  return page.locator(`.react-flow__edge[data-id="${connectorId}"]`)
}

/**
 * Force a fresh, fully-informed `fitView` via the toolbar's "Fit to Screen"
 * control, clicked TWICE. React Flow's own `fitView` calculation uses each
 * node's internally MEASURED dimensions (set by its own ResizeObserver
 * pass), which is a separate readiness signal from DOM/CSS visibility —
 * observed empirically: even after every shape AND table locator resolves
 * `toBeVisible()`, a single immediate "Fit to Screen" click could still
 * compute against a stale/partial measured-bounds snapshot, landing the
 * whole diagram at the wrong zoom (once at 197%, with every shape scrolled
 * off past the top of the viewport). A second click, issued only after the
 * first click's own animation has settled, re-fits against the now-fully-
 * measured node set and reliably lands correctly.
 */
async function refitToScreen(page: Page) {
  const fitButton = page.getByRole('button', { name: 'Fit to Screen' })
  await fitButton.click()
  await page.waitForTimeout(350)
  await fitButton.click()
  await page.waitForTimeout(350)
}

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E Shapes' })).toBeVisible()
  await expect(shapeNode(page, IDS.rectShape)).toBeVisible()
  await expect(shapeNode(page, IDS.lineShape)).toBeVisible()
  // Tables load via a SEPARATE data source/query than shapes — waiting on
  // shapes alone let `Fit to Screen` below fire while shapes_a/shapes_b
  // hadn't mounted yet, computing a zoom/pan for the (much smaller) shapes-
  // only bounding box and leaving the tables — and often the shapes
  // cluster too, once the tables' bulk enters the real bounds — off past
  // the viewport's edges once they did mount moments later.
  await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
  await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
  // The collaboration socket connects asynchronously after the initial
  // render — a shape:create/update emitted before it's up can be silently
  // dropped. Wait for it up front so every test's first gesture is real.
  await expect(page.getByText('Connected')).toBeVisible()
  // React Flow's declarative `fitView` prop fits ONCE, against whichever
  // node set (tables/shapes/areas) has finished its own async query load at
  // that moment — tables and shapes load via separate queries, so a shape
  // that measures in AFTER the initial fit can be left positioned outside
  // the actual browser viewport for the rest of the test (still "visible"
  // by CSS, but off past the window's edges for click actionability). Once
  // every shape/table above is confirmed visible, everything this suite
  // seeds is loaded — force one fresh, fully-informed fit via the
  // toolbar's own "Fit to Screen" control rather than relying on the app's
  // single mount-time fit.
  await refitToScreen(page)
}

/**
 * Arm a shape tool from the always-visible palette (FR-001), and wait for
 * the draw overlay to actually mount before returning — ShapeDrawOverlay
 * attaches its capture-phase pointer listeners in a `useEffect`, which runs
 * asynchronously after the click that armed the tool; starting the drag
 * before that effect has run is a real race (see H1's mechanism).
 */
async function armTool(
  page: Page,
  tool: 'Rectangle' | 'Ellipse' | 'Diamond' | 'Arrow' | 'Text',
) {
  await page.getByRole('button', { name: tool, exact: true }).click()
  await expect(page.locator('[data-testid="shape-draw-overlay"]')).toBeVisible()
}

/** Drag-draw a shape from (x1,y1) to (x2,y2) in viewport (screen) coords. */
async function dragDraw(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  // Multiple intermediate moves so the overlay's rubber band updates and
  // the drag exceeds DRAW_DRAG_THRESHOLD_PX.
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2)
  await page.mouse.move(x2, y2)
  await page.mouse.up()
}

/**
 * A point on a shape's own boundary/stroke, not its bounding-box centre.
 * Load-bearing: every seeded shape defaults to `fill: 'none'` (unfilled),
 * and the pointer-events strategy (tech-spec §5) makes an unfilled shape's
 * INTERIOR fall through to the pane — only the ~12px hit-stroke around its
 * outline (and any rendered label text) is actually clickable. Clicking a
 * shape's bounding-box centre only works by accident when it happens to
 * carry label text there; this helper is what makes selecting/hovering/
 * dragging an EMPTY, unfilled shape (diamond/ellipse/line) work at all.
 */
/**
 * A point on a DIAMOND's own boundary that deliberately avoids the four
 * corner/edge-midpoint hotspots NodeResizer places its own resize handles
 * at once the shape is selected — a mousedown that lands ON a resize
 * handle resizes the shape instead of moving it (observed empirically:
 * grabbing the exact top-centre point silently produced a resize, not a
 * move). Point 60% of the way along the top-left edge from (0, h/2) to
 * (w/2, 0): comfortably clear of both the top-centre and left-centre
 * resize handles, and still exactly on the polygon's own stroke.
 */
async function diamondBorderPoint(
  locator: Locator,
): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  const f = 0.6
  return {
    x: box.x + (f * box.width) / 2,
    y: box.y + (box.height / 2) * (1 - f),
  }
}

test.describe('Shapes and Connectors — Phase 1 (Epic A + C)', () => {
  test('E2E-01: draw each of the five kinds — appears at bounds, is selected, tool reverts to select', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const cases: Array<{
      tool: 'Rectangle' | 'Ellipse' | 'Diamond' | 'Arrow' | 'Text'
      x1: number
      y1: number
    }> = [
      // A clearly empty region well below every seeded shape (which cluster
      // around y:440-780) — drawing on top of an existing shape is
      // functionally fine (the overlay claims the gesture regardless of
      // what's underneath), but keeping the target area empty makes this
      // test's own node-count assertions unambiguous.
      { tool: 'Rectangle', x1: 900, y1: 820 },
      { tool: 'Ellipse', x1: 1200, y1: 820 },
      { tool: 'Diamond', x1: 900, y1: 910 },
      { tool: 'Arrow', x1: 1200, y1: 910 },
    ]

    for (const c of cases) {
      const idsBefore = await page
        .locator('.react-flow__node')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
      await armTool(page, c.tool)
      await expect(
        page.getByRole('button', { name: c.tool, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')

      await dragDraw(page, c.x1, c.y1, c.x1 + 80, c.y1 + 60)

      // A new node appeared and the tool reverted to select (FR-005).
      await expect(page.locator('.react-flow__node')).toHaveCount(
        idsBefore.length + 1,
      )
      for (const t of ['Rectangle', 'Ellipse', 'Diamond', 'Arrow', 'Text']) {
        await expect(
          page.getByRole('button', { name: t, exact: true }),
        ).toHaveAttribute('aria-pressed', 'false')
      }

      // The just-drawn shape IS selected — not merely "exists" (E2E-01's
      // load-bearing assertion; React Flow's pane click would otherwise
      // silently deselect it — see tech-spec §8/spec-review-sa.md). Identify
      // it by diffing node ids (not a page-wide "exactly one .selected"
      // count, which any other stray selection elsewhere on the board would
      // also perturb — the FR-005 property under test is specifically
      // about the shape just drawn).
      const idsAfter = await page
        .locator('.react-flow__node')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
      const newIds = idsAfter.filter((id) => !idsBefore.includes(id))
      expect(newIds).toHaveLength(1)
      const newest = shapeNode(page, newIds[0]!).locator(
        '.react-flow__node-shape',
      )
      await expect(newest).toHaveClass(/selected/)
    }
  })

  test('E2E-13: a line/arrow shape renders no connect handles at any state', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const line = shapeNode(page, IDS.lineShape)
    await line.click()
    await expect(line.locator('.react-flow__handle')).toHaveCount(0)
  })

  test('E2E-05: move persists across reload', async ({ page }) => {
    await openWhiteboard(page)
    const rect = shapeNode(page, IDS.diamondShape)
    const grab = await diamondBorderPoint(rect)
    const box = (await rect.boundingBox())!

    // Move: drag the shape by (80, 60), grabbing its top-boundary point
    // (the diamond's top vertex — its interior is unfilled and falls
    // through to the pane, tech-spec §5). Real intermediate steps (not just
    // two waypoints) so React Flow's own drag-start distance threshold is
    // exceeded unambiguously.
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(grab.x + 20, grab.y + 15, { steps: 5 })
    await page.mouse.move(grab.x + 50, grab.y + 35, { steps: 5 })
    await page.mouse.move(grab.x + 80, grab.y + 60, { steps: 5 })
    await page.mouse.up()
    // The drag committed a shape:update — give the optimistic state a tick.
    await expect(async () => {
      const liveBox = (await rect.boundingBox())!
      expect(liveBox.x).not.toBeCloseTo(box.x, 0)
    }).toPass({ timeout: 5_000 })

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    const movedBox = (await shapeNode(page, IDS.diamondShape).boundingBox())!
    expect(movedBox.x).not.toBeCloseTo(box.x, 0)
  })

  test('E2E-05 resize: dragging the resize handle persists the new size across reload (FR-008)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const ellipse = shapeNode(page, IDS.ellipseShape)
    const box = (await ellipse.boundingBox())!

    // Select the shape by clicking its own boundary (unfilled interior falls
    // through to the pane) — the ellipse's leftmost point sits exactly on
    // its own stroke.
    await page.mouse.click(box.x + 1, box.y + box.height / 2)
    const handle = page.locator('.react-flow__resize-control.bottom.right')
    await expect(handle).toBeVisible()
    const handleBox = (await handle.boundingBox())!
    const hx = handleBox.x + handleBox.width / 2
    const hy = handleBox.y + handleBox.height / 2

    // Grow the shape by dragging the bottom-right handle outward.
    await page.mouse.move(hx, hy)
    await page.mouse.down()
    await page.mouse.move(hx + 20, hy + 15, { steps: 5 })
    await page.mouse.move(hx + 50, hy + 40, { steps: 5 })
    await page.mouse.up()

    await expect(async () => {
      const liveBox = (await ellipse.boundingBox())!
      expect(liveBox.width).toBeGreaterThan(box.width + 20)
      expect(liveBox.height).toBeGreaterThan(box.height + 20)
    }).toPass({ timeout: 5_000 })

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    const resizedBox = (await shapeNode(page, IDS.ellipseShape).boundingBox())!
    expect(resizedBox.width).toBeGreaterThan(box.width + 20)
    expect(resizedBox.height).toBeGreaterThan(box.height + 20)
  })

  test('E2E-06: resizing toward zero clamps at the 24×24 minimum floor and stays selectable (FR-008)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    // diamondShape (not rectShape): rectShape sits at the diagram's own
    // top-left CORNER (x:120,y:120, the minimum of the whole bounding box),
    // which `Fit to Screen`'s own padding anchor places directly behind/
    // under the app's fixed top-left tool palette regardless of zoom —
    // observed empirically to swallow the resize-handle mousedown into
    // whichever palette button physically sits at that pixel instead,
    // silently turning the "resize" gesture into a no-op. diamondShape sits
    // further right, clear of that fixed chrome.
    const diamond = shapeNode(page, IDS.diamondShape)
    const grab = await diamondBorderPoint(diamond)
    await page.mouse.click(grab.x, grab.y)
    const handle = page.locator('.react-flow__resize-control.bottom.right')
    await expect(handle).toBeVisible()
    const handleBox = (await handle.boundingBox())!
    const hx = handleBox.x + handleBox.width / 2
    const hy = handleBox.y + handleBox.height / 2
    const diamondBox = (await diamond.boundingBox())!

    // Drag the bottom-right handle to a point just a few pixels past the
    // shape's own top-left corner — enough to cross well below the 24×24
    // floor, via a nearby, gradual drag (not a single huge jump across the
    // viewport).  A naive implementation would shrink the shape to 0 or
    // negative; FR-008 requires a 24×24 floor regardless.
    const targetX = diamondBox.x + 5
    const targetY = diamondBox.y + 5
    await page.mouse.move(hx, hy)
    await page.mouse.down()
    await page.mouse.move(hx - (hx - targetX) / 2, hy - (hy - targetY) / 2, {
      steps: 8,
    })
    await page.mouse.move(targetX, targetY, { steps: 8 })
    await page.mouse.up()

    await expect(async () => {
      const liveBox = (await diamond.boundingBox())!
      expect(liveBox.width).toBeGreaterThanOrEqual(24)
      expect(liveBox.width).toBeLessThan(40)
      expect(liveBox.height).toBeGreaterThanOrEqual(24)
      expect(liveBox.height).toBeLessThan(40)
    }).toPass({ timeout: 5_000 })

    // Still selectable/grabbable after being clamped to its floor size —
    // reload and confirm the shape is visible and its resizer reopens
    // (pixel-perfect size is asserted above, LIVE; this half only checks
    // persistence of "still a real, selectable shape" — but the click
    // below still needs an accurate on-screen position, so re-fit exactly
    // like `openWhiteboard` does).
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(page, IDS.diamondShape)).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
    await refitToScreen(page)
    const reGrab = await diamondBorderPoint(shapeNode(page, IDS.diamondShape))
    await page.mouse.click(reGrab.x, reGrab.y)
    await expect(
      page.locator('.react-flow__resize-control.bottom.right'),
    ).toBeVisible()
  })

  test('E2E-05 restyle: changing fill/stroke/width persists across reload (FR-009)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    // diamondShape, for the same top-left-corner reason as E2E-06 above —
    // ellipseShape (x:420) still sat close enough to the fixed palette for
    // its style toolbar (rendered ABOVE the shape) to overlap it.
    const diamond = shapeNode(page, IDS.diamondShape)
    const grab = await diamondBorderPoint(diamond)
    await page.mouse.click(grab.x, grab.y)

    const toolbar = page.getByRole('toolbar', { name: 'Shape style' })
    await expect(toolbar).toBeVisible()
    await toolbar.getByRole('button', { name: 'Fill Red' }).click()
    await toolbar.getByRole('button', { name: 'Stroke width 4' }).click()
    await toolbar.getByRole('button', { name: 'Toggle dashed stroke' }).click()

    await expect(
      toolbar.getByRole('button', { name: 'Fill Red' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(page, IDS.diamondShape)).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
    await refitToScreen(page)
    const reGrab = await diamondBorderPoint(shapeNode(page, IDS.diamondShape))
    await page.mouse.click(reGrab.x, reGrab.y)
    const toolbarAfter = page.getByRole('toolbar', { name: 'Shape style' })
    await expect(toolbarAfter).toBeVisible()
    await expect(
      toolbarAfter.getByRole('button', { name: 'Fill Red' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      toolbarAfter.getByRole('button', { name: 'Stroke width 4' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      toolbarAfter.getByRole('button', { name: 'Toggle dashed stroke' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('E2E-07: labeling a shape and pressing Backspace edits text, does not delete it', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const before = await page.locator('.react-flow__node').count()

    const rect = shapeNode(page, IDS.rectShape)
    await rect.dblclick()
    const editor = page.locator('textarea.shape-label-editor')
    await expect(editor).toBeVisible()
    await editor.press('End')
    await editor.press('Backspace')
    await editor.press('Escape')

    // Shape still exists (not deleted) — Backspace edited the textarea only.
    await expect(page.locator('.react-flow__node')).toHaveCount(before)
    await expect(rect).toBeVisible()
  })

  test('E2E-08: drawing a text box and clicking away without typing creates zero rows', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const before = await page.locator('.react-flow__node').count()

    await armTool(page, 'Text')
    await dragDraw(page, 900, 800, 1040, 850)
    const editor = page.locator('textarea.shape-label-editor')
    await expect(editor).toBeVisible()

    // Click away without typing — commits empty, which creates nothing.
    await page.mouse.click(1400, 900)
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(page.locator('.react-flow__node')).toHaveCount(before)
  })

  test('E2E-15: deleting a shape with 2 connectors removes all three, no dangling edge', async ({
    page,
  }) => {
    await openWhiteboard(page)
    // rectShape already has one connector to ellipseShape (seed). Connect it
    // to diamondShape too, for a second connector, via drag-to-connect.
    const rect = shapeNode(page, IDS.rectShape)
    await rect.hover()
    const srcHandle = rect.locator('.react-flow__handle.shape-src').first()
    const diamond = shapeNode(page, IDS.diamondShape)
    const diamondBox = (await diamond.boundingBox())!
    const srcBox = (await srcHandle.boundingBox())!

    await page.mouse.move(
      srcBox.x + srcBox.width / 2,
      srcBox.y + srcBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      diamondBox.x + diamondBox.width / 2,
      diamondBox.y + diamondBox.height / 2,
      {
        steps: 5,
      },
    )
    await page.mouse.up()

    // Two connectors now touch rectShape: the seeded one + the new one.
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(2)

    // Delete rectShape.
    await rect.click()
    await page.keyboard.press('Delete')

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(page, IDS.rectShape)).toHaveCount(0)
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(0)
  })

  test('E2E-22: deleting a connector persists after reload (M1)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const edge = connectorEdge(page, IDS.shapeConnector)
    await edge.click({ position: { x: 5, y: 5 }, force: true })
    await page.keyboard.press('Delete')

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(connectorEdge(page, IDS.shapeConnector)).toHaveCount(0)
  })

  test('E2E-21 (H1, MANDATORY): the viewport never stops panning/zooming while a draw tool is armed', async ({
    page,
  }) => {
    await openWhiteboard(page)

    function readScale() {
      return page.locator('.react-flow__viewport').evaluate((el) => {
        const m = /scale\(([-\d.]+)\)/.exec((el as HTMLElement).style.transform)
        return m ? parseFloat(m[1]) : null
      })
    }
    function readTranslate() {
      return page
        .locator('.react-flow__viewport')
        .evaluate((el) => (el as HTMLElement).style.transform)
    }

    await armTool(page, 'Rectangle')

    // (a) wheel-scroll pans the viewport.
    const beforePan = await readTranslate()
    await page.mouse.move(800, 500)
    await page.mouse.wheel(0, 200)
    await expect.poll(async () => readTranslate()).not.toBe(beforePan)

    // (b) Ctrl+wheel zooms.
    const beforeZoom = await readScale()
    await page.mouse.move(800, 500)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -200)
    await page.keyboard.up('Control')
    await expect.poll(async () => readScale()).not.toBe(beforeZoom)

    // (c) clicking a Controls zoom button changes zoom AND creates no shape.
    const nodeCountBefore = await page.locator('.react-flow__node').count()
    const zoomBefore = await readScale()
    await page.locator('.react-flow__controls-zoomin').click()
    await expect.poll(async () => readScale()).not.toBe(zoomBefore)
    await expect(page.locator('.react-flow__node')).toHaveCount(nodeCountBefore)

    // The tool is still armed — a normal drag still draws a shape.
    await expect(
      page.getByRole('button', { name: 'Rectangle', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await dragDraw(page, 1300, 750, 1420, 830)
    await expect(page.locator('.react-flow__node')).toHaveCount(
      nodeCountBefore + 1,
    )
  })

  test('E2E-17 (MANDATORY): public share-link view renders shapes, exposes no drawing control', async ({
    page,
    browser,
  }) => {
    // Create a real share link via the project's Share panel (do not
    // hand-mint a token row — tech-spec §12).
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
    // Content is visible: at least one shape and the connector.
    await expect(shapeNode(visitor, IDS.rectShape)).toBeVisible()
    await expect(shapeNode(visitor, IDS.ellipseShape)).toBeVisible()
    await expect(connectorEdge(visitor, IDS.shapeConnector)).toHaveCount(1)

    // No drawing controls: no shape palette at all.
    await expect(
      visitor.locator('[data-testid="shape-tool-palette"]'),
    ).toHaveCount(0)

    // Hovering a shape reveals no INTERACTIVE connect handle (N1). Handles
    // stay mounted in the DOM on purpose (React Flow's edge-position
    // resolver needs at least one per side to render a connector at all —
    // see ShapeNode.tsx's module comment) but every one is
    // `pointer-events: none` for a read-only viewer, so no connection can
    // ever be started from it.
    const rect = shapeNode(visitor, IDS.rectShape)
    await rect.hover()
    const handlePointerEvents = await rect
      .locator('.react-flow__handle')
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents)
    expect(handlePointerEvents).toBe('none')
    await rect.click()
    await expect(visitor.locator('.react-flow__resize-control')).toHaveCount(0)
    await expect(
      visitor.getByRole('toolbar', { name: 'Shape style' }),
    ).toHaveCount(0)

    await context.close()
  })

  test('E2E-25 (MANDATORY): an authenticated VIEWER cannot select, drag, or connect from a shape', async ({
    browser,
  }) => {
    const context: BrowserContextType = await browser.newContext()
    const viewerPage = await context.newPage()
    await viewerPage.goto('/login')
    await viewerPage.waitForLoadState('networkidle')
    const email = viewerPage.getByRole('textbox', { name: 'Email' })
    const password = viewerPage.getByRole('textbox', { name: 'Password' })
    const signIn = viewerPage.getByRole('button', { name: 'Sign in' })
    await email.click()
    await email.pressSequentially(E2E_VIEWER_USER.email)
    await password.click()
    await password.pressSequentially(E2E_VIEWER_USER.password)
    await expect(signIn).toBeEnabled({ timeout: 10_000 })
    await signIn.click()

    const deadline = Date.now() + 15_000
    let authed = false
    while (Date.now() < deadline) {
      const cookies = await context.cookies()
      if (
        cookies.some((c) => c.name === 'session_token' && c.value.length > 0)
      ) {
        authed = true
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    if (!authed) throw new Error('viewer login: session_token never set')

    // Let the app's own post-login redirect settle before navigating
    // ourselves — login.tsx's success handler does a full
    // window.location.assign('/'), a real separate navigation that can
    // still be in flight once the session cookie appears. Racing a
    // page.goto against it aborts one of the two (net::ERR_ABORTED) —
    // mirrors canvas-affordances.spec.ts's loginAsViewer helper.
    await viewerPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    })

    await viewerPage.goto(WB_URL)
    await expect(
      viewerPage.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(viewerPage, IDS.lineShape)).toBeVisible()
    await expect(
      viewerPage.locator('[data-table-name="shapes_a"]'),
    ).toBeVisible()
    await expect(
      viewerPage.locator('[data-table-name="shapes_b"]'),
    ).toBeVisible()
    // See `refitToScreen`'s comment — available to every role, including
    // VIEWER.
    await refitToScreen(viewerPage)
    const rect = shapeNode(viewerPage, IDS.rectShape)
    await expect(rect).toBeVisible()

    // No shape-drawing tools for a VIEWER (the palette container itself may
    // still render for the unrelated Add-comment button, which VIEWER+ may
    // use — only the shape tools are canEdit-gated). Individual tool
    // testids (shape-tool-rectangle etc.), NOT a "shape-tool-" prefix —
    // that would also match the palette container's own
    // data-testid="shape-tool-palette".
    for (const tool of ['rectangle', 'ellipse', 'diamond', 'arrow', 'text']) {
      await expect(
        viewerPage.locator(`[data-testid="shape-tool-${tool}"]`),
      ).toHaveCount(0)
    }

    // No INTERACTIVE connect handle on hover (N1) — see the public-share
    // test above for why handles stay mounted but inert.
    await rect.hover()
    const handlePointerEvents = await rect
      .locator('.react-flow__handle')
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents)
    expect(handlePointerEvents).toBe('none')

    // Attempting to drag it does not move the SHAPE. `draggable: canEdit`
    // (false here) correctly stops React Flow from starting a node drag —
    // but the same pointer gesture legitimately falls through to a PANE
    // PAN instead (a VIEWER may still pan/zoom the canvas, just not move
    // content), so asserting raw on-screen position immediately after the
    // gesture would conflate "the viewport panned" with "the shape moved".
    // Reload instead (fitView re-runs, discarding the manual pan) and
    // compare against a shape that was NEVER touched (ellipseShape) to
    // confirm rectShape's position relative to it is unchanged — this is
    // real persistence proof, not a screen-pixel snapshot.
    const box = (await rect.boundingBox())!
    const otherBefore = (await shapeNode(
      viewerPage,
      IDS.ellipseShape,
    ).boundingBox())!
    const deltaBefore = box.x - otherBefore.x

    await viewerPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await viewerPage.mouse.down()
    await viewerPage.mouse.move(
      box.x + box.width / 2 + 100,
      box.y + box.height / 2 + 80,
      {
        steps: 5,
      },
    )
    await viewerPage.mouse.up()

    await viewerPage.reload()
    await expect(
      viewerPage.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(viewerPage, IDS.lineShape)).toBeVisible()
    await expect(
      viewerPage.locator('[data-table-name="shapes_a"]'),
    ).toBeVisible()
    await expect(
      viewerPage.locator('[data-table-name="shapes_b"]'),
    ).toBeVisible()
    await refitToScreen(viewerPage)
    const rectAfter = (await shapeNode(
      viewerPage,
      IDS.rectShape,
    ).boundingBox())!
    const otherAfter = (await shapeNode(
      viewerPage,
      IDS.ellipseShape,
    ).boundingBox())!
    expect(rectAfter.x - otherAfter.x).toBeCloseTo(deltaBefore, 0)

    await context.close()
  })


  test('E2E-03: Escape mid-draw cancels the shape and reverts the tool to select (FR-006)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const before = await page.locator('.react-flow__node').count()
    await armTool(page, 'Rectangle')
    await page.mouse.move(950, 850)
    await page.mouse.down()
    await page.mouse.move(1050, 900, { steps: 5 })
    await page.keyboard.press('Escape')
    await page.mouse.up()

    await expect(
      page.getByRole('button', { name: 'Rectangle', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.react-flow__node')).toHaveCount(before)
    await expect(
      page.locator('[data-testid="shape-draw-overlay"]'),
    ).toHaveCount(0)
  })

  test('E2E-04: with the select tool idle, dragging the empty pane still pans the canvas (FR-004)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    function readTranslate() {
      return page
        .locator('.react-flow__viewport')
        .evaluate((el) => (el as HTMLElement).style.transform)
    }
    const before = await readTranslate()
    // A clear region away from every shape/table so the drag is a pane pan,
    // not a node drag.
    await page.mouse.move(1500, 900)
    await page.mouse.down()
    await page.mouse.move(1400, 850, { steps: 5 })
    await page.mouse.move(1300, 800, { steps: 5 })
    await page.mouse.up()

    await expect.poll(async () => readTranslate()).not.toBe(before)
    // Nothing was drawn (no tool armed) — a pan, not a draw.
    await expect(
      page.locator('[data-testid="shape-draw-overlay"]'),
    ).toHaveCount(0)
  })

  test('E2E-09: clearing an existing text shape label deletes it and its connectors in one cascade (FR-012)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    // Connect textShape -> diamondShape first, so there is a connector to
    // cascade when the text shape is cleared.
    const textNode = shapeNode(page, IDS.textShape)
    await textNode.hover()
    const srcHandle = textNode.locator('.react-flow__handle.shape-src').first()
    const diamond = shapeNode(page, IDS.diamondShape)
    const diamondBox = (await diamond.boundingBox())!
    const srcBox = (await srcHandle.boundingBox())!
    await page.mouse.move(
      srcBox.x + srcBox.width / 2,
      srcBox.y + srcBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      diamondBox.x + diamondBox.width / 2,
      diamondBox.y + diamondBox.height / 2,
      { steps: 5 },
    )
    await page.mouse.up()
    // Seeded rect-ellipse connector + the new text-diamond one.
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(2)

    await textNode.dblclick()
    const editor = page.locator('textarea.shape-label-editor')
    await expect(editor).toBeVisible()
    await editor.press('Control+A')
    await editor.press('Backspace')
    await editor.press('Escape')

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(page, IDS.textShape)).toHaveCount(0)
    await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
    // Re-fit after reload (see `refitToScreen`'s comment) — the remaining
    // connector must actually be within the viewport for the visibility
    // check below to mean anything.
    await refitToScreen(page)
    // Only the original seeded rect-ellipse connector remains.
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(1)
    // `.toBeVisible()` on the outer `<g class="react-flow__edge">` was
    // observed to report "hidden" even when the connector visibly renders
    // on screen (screenshot-confirmed) — an SVG `<g>` bounding-box
    // computation quirk specific to this reload+re-fit sequence, not a
    // real rendering gap (E2E-10/E2E-11 assert the same edge TYPE's own
    // `path.react-flow__edge-path` successfully elsewhere in this file).
    // Assert existence + a real (non-empty) path geometry instead.
    await expect(connectorEdge(page, IDS.shapeConnector)).toHaveCount(1)
    const shapeConnectorPathD = await connectorEdge(page, IDS.shapeConnector)
      .locator('path.react-flow__edge-path')
      .getAttribute('d')
    expect(shapeConnectorPathD).toBeTruthy()
  })

  test('E2E-10: connecting two shapes persists across reload with the same geometry (FR-014/FR-030)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const idsBefore = await page
      .locator('.react-flow__edge-connector')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))

    const diamond = shapeNode(page, IDS.diamondShape)
    await diamond.hover()
    const srcHandle = diamond.locator('.react-flow__handle.shape-src').first()
    const text = shapeNode(page, IDS.textShape)
    const textBox = (await text.boundingBox())!
    const srcBox = (await srcHandle.boundingBox())!
    await page.mouse.move(
      srcBox.x + srcBox.width / 2,
      srcBox.y + srcBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      textBox.x + textBox.width / 2,
      textBox.y + textBox.height / 2,
      { steps: 5 },
    )
    await page.mouse.up()

    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(
      idsBefore.length + 1,
    )
    const idsAfter = await page
      .locator('.react-flow__edge-connector')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
    const newId = idsAfter.filter((id) => !idsBefore.includes(id))[0]!
    const pathBefore = (await connectorEdge(page, newId)
      .locator('path.react-flow__edge-path')
      .boundingBox())!

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(page, IDS.lineShape)).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
    // Re-fit after reload (see `refitToScreen`'s comment) — without this,
    // reload's own one-shot `fitView` can land at a different pan/zoom than
    // the pre-reload state above, making a pixel-position comparison
    // meaningless regardless of whether the connector actually persisted.
    await refitToScreen(page)
    await expect(connectorEdge(page, newId)).toBeVisible()
    const pathAfter = (await connectorEdge(page, newId)
      .locator('path.react-flow__edge-path')
      .boundingBox())!
    expect(pathAfter.x).toBeCloseTo(pathBefore.x, 0)
    expect(pathAfter.y).toBeCloseTo(pathBefore.y, 0)
    expect(pathAfter.width).toBeCloseTo(pathBefore.width, 0)
    expect(pathAfter.height).toBeCloseTo(pathBefore.height, 0)
  })

  test('E2E-11: dragging a connected shape reroutes its connector live, no reload needed (FR-015/FR-031a)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const edge = connectorEdge(page, IDS.shapeConnector)
    const pathBefore = (await edge
      .locator('path.react-flow__edge-path')
      .boundingBox())!

    const rect = shapeNode(page, IDS.rectShape)
    const box = (await rect.boundingBox())!
    // rectShape carries a text label — its centre is clickable/draggable.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box.x + box.width / 2 + 30,
      box.y + box.height / 2 + 20,
      { steps: 5 },
    )
    await page.mouse.move(
      box.x + box.width / 2 + 60,
      box.y + box.height / 2 + 40,
      { steps: 5 },
    )
    await page.mouse.up()

    await expect(async () => {
      const pathAfter = (await edge
        .locator('path.react-flow__edge-path')
        .boundingBox())!
      expect(pathAfter.x).not.toBeCloseTo(pathBefore.x, 0)
    }).toPass({ timeout: 5_000 })
  })

  test('E2E-12: dragging a shape connector over a table column shows no connectable highlight and creates nothing on release (FR-016)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const connectorsBefore = await page
      .locator('.react-flow__edge-connector')
      .count()
    const relationshipsBefore = await page
      .locator('.react-flow__edge:not(.react-flow__edge-connector)')
      .count()

    const rect = shapeNode(page, IDS.rectShape)
    await rect.hover()
    const srcHandle = rect.locator('.react-flow__handle.shape-src').first()
    const srcBox = (await srcHandle.boundingBox())!

    const tableA = page.locator('[data-table-name="shapes_a"]').first()
    // Column index 0 ('id'), 'left-target' offset (1) — see
    // ColumnHandles.tsx's fixed 4-per-column order (canvas-rendering.spec.ts
    // documents this convention).
    const targetHandle = tableA.locator('[data-handleid]').nth(1)
    const targetBox = (await targetHandle.boundingBox())!

    await page.mouse.move(
      srcBox.x + srcBox.width / 2,
      srcBox.y + srcBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    )

    // FR-016: "the target does not highlight as connectable" — the
    // pre-existing blanket highlight rule must be suppressed for a
    // shape-originated drag (the `.is-connecting-from-shape` CSS fix).
    const beforeColor = await targetHandle.evaluate(
      (el) => getComputedStyle(el, '::before').backgroundColor,
    )
    expect(beforeColor).toBe('rgba(0, 0, 0, 0)')

    await page.mouse.up()

    // FR-016: "no connector is created, no error is thrown".
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(
      connectorsBefore,
    )
    await expect(
      page.locator('.react-flow__edge:not(.react-flow__edge-connector)'),
    ).toHaveCount(relationshipsBefore)
  })

  test('E2E-14: the existing table-to-table drag-to-connect flow is unaffected by the shared predicate (FR-017)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const relationshipsBefore = await page
      .locator('.react-flow__edge:not(.react-flow__edge-connector)')
      .count()

    const tableB = page.locator('[data-table-name="shapes_b"]').first()
    const tableA = page.locator('[data-table-name="shapes_a"]').first()
    // Column index 1 ('note'/'name') on both tables — the ONLY column pair
    // with no pre-existing relationship (index 0 is the seeded one), so a
    // successful drag here proves a genuinely NEW connection.
    const sourceHandle = tableB.locator('[data-handleid]').nth(4 + 2) // right-source
    const targetHandle = tableA.locator('[data-handleid]').nth(4 + 1) // left-target

    const row = tableB.locator('.column-row').nth(1)
    const rowBox = (await row.boundingBox())!
    await page.mouse.move(
      rowBox.x + rowBox.width / 2,
      rowBox.y + rowBox.height / 2,
    )
    const from = (await sourceHandle.boundingBox())!
    const to = (await targetHandle.boundingBox())!
    await sourceHandle.dispatchEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: from.x + from.width / 2,
      clientY: from.y + from.height / 2,
    })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    })
    await page.mouse.up()

    // Connecting two columns opens the cardinality-selection dialog before
    // finalizing — unchanged by this feature.
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(
      page.locator('.react-flow__edge:not(.react-flow__edge-connector)'),
    ).toHaveCount(relationshipsBefore + 1)
  })

  test('E2E-16: keyboard-only traversal reaches, selects, and connects two pre-existing shapes (FR-019a)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    // Clear any incidental selection/focus and give the canvas region focus.
    await page.mouse.click(1500, 900)

    function shapeInner(id: string) {
      return shapeNode(page, id).locator('.react-flow__node-shape')
    }

    // Traversal visits shapes in creation order: rect, ellipse, diamond,
    // text, line (seed-shapes.ts insertion order).
    await page.keyboard.press('n')
    await expect(shapeInner(IDS.rectShape)).toHaveClass(/kbd-focused/)

    await page.keyboard.press('n')
    await expect(shapeInner(IDS.ellipseShape)).toHaveClass(/kbd-focused/)
    await expect(shapeInner(IDS.rectShape)).not.toHaveClass(/kbd-focused/)

    // Enter selects the focused shape, replacing any previous selection.
    await page.keyboard.press('Enter')
    await expect(shapeInner(IDS.ellipseShape)).toHaveClass(/selected/)

    // Traverse to a third shape without disturbing the selection just made.
    await page.keyboard.press('n')
    await expect(shapeInner(IDS.diamondShape)).toHaveClass(/kbd-focused/)
    await expect(shapeInner(IDS.ellipseShape)).toHaveClass(/selected/)

    // Ctrl+Enter ADDS the focused shape to the selection (order preserved:
    // ellipse first, diamond second).
    await page.keyboard.press('Control+Enter')
    await expect(shapeInner(IDS.diamondShape)).toHaveClass(/selected/)
    await expect(shapeInner(IDS.ellipseShape)).toHaveClass(/selected/)

    // 'c' with exactly two selected connects them, in keyboard-selection
    // order (ellipse -> diamond) — subject to the same FR-016 validation.
    const idsBefore = await page
      .locator('.react-flow__edge-connector')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
    await page.keyboard.press('c')
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(
      idsBefore.length + 1,
    )

    // Escape clears the selection; focus (traversal) is unaffected.
    await page.keyboard.press('Escape')
    await expect(shapeInner(IDS.diamondShape)).not.toHaveClass(/selected/)
    await expect(shapeInner(IDS.ellipseShape)).not.toHaveClass(/selected/)

    // Traversal wraps at the end: from diamond (index 2), 'n' three more
    // times reaches text(3), line(4), then wraps back to rect(0).
    await page.keyboard.press('n')
    await expect(shapeInner(IDS.textShape)).toHaveClass(/kbd-focused/)
    await page.keyboard.press('n')
    await expect(shapeInner(IDS.lineShape)).toHaveClass(/kbd-focused/)
    await page.keyboard.press('n')
    await expect(shapeInner(IDS.rectShape)).toHaveClass(/kbd-focused/)

    // Shift+N traverses backward, wrapping the other direction.
    await page.keyboard.press('Shift+N')
    await expect(shapeInner(IDS.lineShape)).toHaveClass(/kbd-focused/)

    // Tab is never intercepted — no error, and it doesn't trigger a select.
    await page.keyboard.press('Tab')
    await expect(shapeInner(IDS.lineShape)).not.toHaveClass(/selected/)
  })

  test('E2E-18: exported PNG and SVG images include shape geometry and text (FR-040)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    async function captureNextDownloadDataUrl() {
      await page.evaluate(() => {
        const w = window as unknown as { __capturedDataUrls: Array<string> }
        w.__capturedDataUrls = []
        const proto = HTMLAnchorElement.prototype
        const originalClick = proto.click
        proto.click = function (this: HTMLAnchorElement) {
          if (this.download) {
            w.__capturedDataUrls.push(this.href)
          }
          originalClick.call(this)
        }
      })
    }

    async function exportAs(format: 'PNG' | 'SVG') {
      await captureNextDownloadDataUrl()
      await page.getByRole('button', { name: 'Export as image' }).click()
      await expect(
        page.getByRole('heading', { name: 'Export as Image' }),
      ).toBeVisible()
      if (format === 'SVG') {
        await page.getByRole('combobox', { name: 'Format' }).click()
        await page.getByRole('option', { name: 'SVG' }).click()
      }
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Export as Image' }),
      ).not.toBeVisible()
      return page.evaluate(() => {
        const w = window as unknown as { __capturedDataUrls: Array<string> }
        const url = w.__capturedDataUrls[0]
        if (!url) throw new Error('no export data URL was captured')
        return url
      })
    }

    // PNG: decode in-page (no Node PNG dependency) and check it isn't a
    // flat blank image — real shape/table geometry paints more than one
    // color.
    const pngUrl = await exportAs('PNG')
    const pngInfo = await page.evaluate(async (dataUrl) => {
      const img = new Image()
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('exported PNG failed to decode'))
      })
      img.src = dataUrl
      await loaded
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const colors = new Set<string>()
      for (let i = 0; i < data.length; i += 4 * 97) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`)
      }
      return {
        width: canvas.width,
        height: canvas.height,
        byteLength: dataUrl.length,
        distinctColors: colors.size,
      }
    }, pngUrl)
    expect(pngInfo.width).toBeGreaterThan(0)
    expect(pngInfo.height).toBeGreaterThan(0)
    expect(pngInfo.distinctColors).toBeGreaterThan(1)
    expect(pngInfo.byteLength).toBeGreaterThan(5_000)

    // SVG: the PRD's own named risk is embedded-HTML-in-SVG text rasterizing
    // unreliably — recover the raw SVG source and confirm the shape's own
    // label TEXT and painted GEOMETRY both actually made it into the
    // export, not just the tables.
    const svgUrl = await exportAs('SVG')
    const svgText = await page.evaluate((dataUrl) => {
      const prefix = 'data:image/svg+xml;charset=utf-8,'
      return decodeURIComponent(dataUrl.slice(prefix.length))
    }, svgUrl)
    expect(svgText).toContain('Rect label')
    expect(svgText).toContain('shape-painted')
    expect(svgText).toContain('react-flow__edge-connector')
  })

  test('E2E-19: version restore brings back a deleted shape and its connector via the UI (FR-035)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const originalBox = (await shapeNode(page, IDS.rectShape).boundingBox())!

    await page.getByRole('button', { name: 'Version history' }).click()
    await expect(
      page.getByRole('heading', { name: 'Version History' }),
    ).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Version label' })
      .fill('Pre-mutate shapes')
    await page.getByRole('button', { name: 'Save version' }).click()
    await expect(page.getByText('Version saved')).toBeVisible()
    await page.keyboard.press('Escape')

    // Mutate: delete rectShape — cascades its connector too (FR-018).
    const rect = shapeNode(page, IDS.rectShape)
    await rect.click()
    await page.keyboard.press('Delete')
    await expect(shapeNode(page, IDS.rectShape)).toHaveCount(0)
    await expect(page.locator('.react-flow__edge-connector')).toHaveCount(0)

    // Restore the pre-mutate version.
    await page.getByRole('button', { name: 'Version history' }).click()
    await page
      .getByRole('list', { name: 'Version list' })
      .getByRole('button', { name: /Pre-mutate shapes/ })
      .click()
    const dialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Read-only preview' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByText('Version restored')).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(shapeNode(page, IDS.lineShape)).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
    await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
    // Re-fit after reload (see `refitToScreen`'s comment) so this frame
    // matches the one `originalBox` was captured under.
    await refitToScreen(page)
    const restoredBox = (await shapeNode(page, IDS.rectShape).boundingBox())!
    expect(restoredBox.x).toBeCloseTo(originalBox.x, 0)
    expect(restoredBox.y).toBeCloseTo(originalBox.y, 0)
    // `.toBeVisible()` on the outer `<g class="react-flow__edge">` was
    // observed to report "hidden" even when the connector visibly renders
    // on screen (screenshot-confirmed) — an SVG `<g>` bounding-box
    // computation quirk specific to this reload+re-fit sequence, not a
    // real rendering gap (E2E-10/E2E-11 assert the same edge TYPE's own
    // `path.react-flow__edge-path` successfully elsewhere in this file).
    // Assert existence + a real (non-empty) path geometry instead.
    await expect(connectorEdge(page, IDS.shapeConnector)).toHaveCount(1)
    const shapeConnectorPathD = await connectorEdge(page, IDS.shapeConnector)
      .locator('path.react-flow__edge-path')
      .getAttribute('d')
    expect(shapeConnectorPathD).toBeTruthy()
  })

  test('E2E-24: restore confirmation names BOTH counts on a normal (non-legacy) restore (FR-035a)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await page.getByRole('button', { name: 'Version history' }).click()
    await expect(
      page.getByRole('heading', { name: 'Version History' }),
    ).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Version label' })
      .fill('Five shapes')
    await page.getByRole('button', { name: 'Save version' }).click()
    await expect(page.getByText('Version saved')).toBeVisible()
    await page.keyboard.press('Escape')

    await shapeNode(page, IDS.rectShape).click()
    await page.keyboard.press('Delete')
    await expect(shapeNode(page, IDS.rectShape)).toHaveCount(0)

    await page.getByRole('button', { name: 'Version history' }).click()
    await page
      .getByRole('list', { name: 'Version list' })
      .getByRole('button', { name: /Five shapes/ })
      .click()
    const dialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Read-only preview' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Restore this version' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(
      'Restoring replaces the current board with this version, which contains 5 shape(s); the board currently has 4.',
    )
  })

  test('E2E-23a: window blur mid-draw cancels the shape and disarms the tool (M6)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const before = await page.locator('.react-flow__node').count()
    await armTool(page, 'Rectangle')
    await page.mouse.move(950, 850)
    await page.mouse.down()
    await page.mouse.move(1050, 900, { steps: 5 })
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()

    await expect(
      page.getByRole('button', { name: 'Rectangle', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.react-flow__node')).toHaveCount(before)
  })

  test('E2E-23b: a synthetic pointercancel mid-draw cancels the shape and disarms the tool (M6)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const before = await page.locator('.react-flow__node').count()
    await armTool(page, 'Rectangle')
    await page.mouse.move(950, 850)
    await page.mouse.down()
    await page.mouse.move(1050, 900, { steps: 5 })
    await page.evaluate(() => {
      document
        .querySelector('.react-flow-wrapper')!
        .dispatchEvent(
          new Event('pointercancel', { bubbles: true, cancelable: true }),
        )
    })
    await page.mouse.up()

    await expect(
      page.getByRole('button', { name: 'Rectangle', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.react-flow__node')).toHaveCount(before)
  })

  test('E2E-23c: a mid-drag lostpointercapture cancels the shape and disarms the tool, and a later NORMAL draw still works (M6)', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const before = await page.locator('.react-flow__node').count()
    await armTool(page, 'Rectangle')
    await page.mouse.move(950, 850)
    await page.mouse.down()
    await page.mouse.move(1050, 900, { steps: 5 })
    await page.evaluate(() => {
      document
        .querySelector('.react-flow-wrapper')!
        .dispatchEvent(
          new Event('lostpointercapture', { bubbles: true, cancelable: true }),
        )
    })
    await page.mouse.up()

    await expect(
      page.getByRole('button', { name: 'Rectangle', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.react-flow__node')).toHaveCount(before)

    // The guard's own trap (ShapeDrawOverlay.tsx): lostpointercapture fires
    // after EVERY normal pointerup too. Prove a NORMAL draw still commits a
    // shape afterward — the abnormal-path disarm above didn't wedge the
    // tool's own gesture tracking.
    await armTool(page, 'Rectangle')
    await dragDraw(page, 1300, 850, 1420, 920)
    await expect(page.locator('.react-flow__node')).toHaveCount(before + 1)
  })

  // Runs LAST, deliberately: this is the one destructive case in the file —
  // it wipes every shape on shapesWhiteboard via a legacy-payload restore,
  // then restores them back via the auto-saved snapshot. Ordered after
  // every other test so a partial failure here (or the file being run with
  // a subset filter) can never leave the board wiped for an earlier-listed
  // test — Playwright runs a file's tests in declaration order under
  // workers:1/fullyParallel:false (this config), which this ordering relies
  // on directly, matching the isolation rationale in this file's header.
  test('E2E-20 (MANDATORY): legacy snapshot restore removes shapes without error', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await expect(shapeNode(page, IDS.rectShape)).toBeVisible()

    await page.getByRole('button', { name: 'Version history' }).click()
    await expect(
      page.getByRole('heading', { name: 'Version History' }),
    ).toBeVisible()

    await page
      .getByRole('list', { name: 'Version list' })
      .getByRole('button', { name: /Pre-shapes legacy version/ })
      .click()
    const dialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Read-only preview' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Restore this version' }).click()

    // FR-035a: the confirmation names both the loss and the recovery path.
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('Auto-saved before restore')
    await confirm.getByRole('button', { name: 'Restore', exact: true }).click()

    await expect(page.getByText('Version restored')).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    // Every shape is gone — the legacy payload had no `shapes` key, which
    // reads as an empty collection.
    await expect(page.locator('.react-flow__node-shape')).toHaveCount(0)

    // The auto-saved pre-restore snapshot restores the shapes back.
    await page.getByRole('button', { name: 'Version history' }).click()
    const autoItem = page
      .getByRole('list', { name: 'Version list' })
      .getByRole('button', { name: /Auto-saved before restore/ })
    await expect(autoItem).toBeVisible()
    // exact: 'Auto-saved before restore' would otherwise substring-match
    // too, since Playwright's getByText defaults to a substring match.
    await expect(autoItem.getByText('Auto', { exact: true })).toBeVisible()
    await autoItem.click()
    const dialog2 = page
      .getByRole('dialog')
      .filter({ hasText: 'Read-only preview' })
    await dialog2.getByRole('button', { name: 'Restore this version' }).click()
    const confirm2 = page.getByRole('alertdialog')
    await confirm2.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByText('Version restored')).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    await expect(page.locator('.react-flow__node-shape')).not.toHaveCount(0)
  })
})

type BrowserContextType = Awaited<ReturnType<Browser['newContext']>>

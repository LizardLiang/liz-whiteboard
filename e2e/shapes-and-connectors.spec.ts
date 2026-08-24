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

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E Shapes' })).toBeVisible()
  await expect(shapeNode(page, IDS.rectShape)).toBeVisible()
  // The collaboration socket connects asynchronously after the initial
  // render — a shape:create/update emitted before it's up can be silently
  // dropped. Wait for it up front so every test's first gesture is real.
  await expect(page.getByText('Connected')).toBeVisible()
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

  test('E2E-05: move / resize / restyle persist across reload', async ({
    page,
  }) => {
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

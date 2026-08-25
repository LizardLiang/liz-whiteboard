// e2e/shape-quick-connect.spec.ts
// End-to-end coverage for the quick-connect creators (approved tactical plan
// .claude/.Arena/tactical-plans/2026-08-24-shape-quick-connect-creators.md) —
// the mandatory Playwright completion gate per CLAUDE.md.
//
// The feature: a shape's four connect markers are now PAINTED (they were
// live 28x28 hit targets that no CSS rule ever drew), and clicking one —
// pressing and releasing without dragging past DRAW_DRAG_THRESHOLD_PX —
// creates a same-kind, same-size, same-style shape on that side, connects
// the two, selects the new shape and opens its label editor. Dragging the
// same marker is still the shipped connect gesture.
//
// Dev/prod broadcast note (mirrors shapes-and-connectors.spec.ts): Socket.IO
// does not fire in the dev Vite process (`io` is null there), so every case
// that depends on persistence asserts the PERSISTED result via reload rather
// than a live second-client push.
//
// Shares the dedicated shapes board (IDS.shapesProject/shapesWhiteboard) and
// its seed script with shapes-and-connectors.spec.ts; re-seeded before every
// test since every case here creates rows.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { E2E_VIEWER_USER, IDS } from './fixtures'
import type { Locator, Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.shapesWhiteboard}`

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

/**
 * Every shape NODE — the compound selector is required, not tidiness:
 * `.react-flow__node-shape` alone matches twice per shape, because React
 * Flow puts it on the node element AND ShapeNode puts the same class on its
 * own inner wrapper div. Counting with the bare class silently doubles.
 */
function allShapeNodes(page: Page) {
  return page.locator('.react-flow__node.react-flow__node-shape')
}

function allConnectorEdges(page: Page) {
  return page.locator('.react-flow__edge-connector')
}

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
  await expect(page.locator('[data-table-name="shapes_a"]')).toBeVisible()
  await expect(page.locator('[data-table-name="shapes_b"]')).toBeVisible()
  await expect(page.getByText('Connected')).toBeVisible()
  await refitToScreen(page)
}

/**
 * A shape's box relative to the `.react-flow` wrapper, not the viewport.
 * Required, not tidiness: the first shape click of a test permanently
 * collapses ~61px of toolbar chrome ABOVE the canvas, moving the wrapper on
 * the page without moving anything within it. Comparing raw viewport boxes
 * across that click produces a false ~61px delta — exactly what QC-03 first
 * measured (65px). `shapes-and-connectors.spec.ts` documents the same trap.
 */
async function boxRelativeToCanvas(page: Page, locator: Locator) {
  const [box, wrapperBox] = await Promise.all([
    locator.boundingBox(),
    page.evaluate(() => {
      const el = document.querySelector('.react-flow')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y }
    }),
  ])
  if (!box || !wrapperBox) {
    throw new Error('boxRelativeToCanvas: element or wrapper not found')
  }
  return {
    x: box.x - wrapperBox.x,
    y: box.y - wrapperBox.y,
    width: box.width,
    height: box.height,
  }
}

/** A shape's marker on one side, by the stable handle id (W7's constants). */
function marker(page: Page, shapeId: string, side: string) {
  return shapeNode(page, shapeId).locator(
    `.react-flow__handle[data-handleid="shape-src-${side}"]`,
  )
}

/**
 * Click a marker the way a user does: press and release at the same point.
 * Deliberately NOT `locator.click()` — the point of the gesture is that the
 * pointer does not travel, and going through the mouse API is what proves
 * React Flow's connection (which starts on pointerdown) is left clean.
 */
async function clickMarker(page: Page, shapeId: string, side: string) {
  const node = shapeNode(page, shapeId)
  await node.click({ position: { x: 5, y: 5 } })
  const handle = marker(page, shapeId, side)
  await expect(handle).toBeVisible()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

/**
 * How visible a marker's arrow chip is, 0..1.
 *
 * The chips are revealed by OPACITY, not by colour: `.figjam-ghost`-era CSS
 * paints `::before` with `--rf-quick-arrow-bg` unconditionally and toggles
 * `opacity` between 0 and 1. Probing `backgroundColor` therefore reports the
 * same value hidden or shown and proves nothing.
 */
async function markerChipOpacity(page: Page, shapeId: string, side: string) {
  const raw = await marker(page, shapeId, side).evaluate(
    (el) => getComputedStyle(el, '::before').opacity,
  )
  return Number.parseFloat(raw)
}

test.describe('shape quick-connect creators', () => {
  test('QC-01: markers are painted on a selected shape', async ({ page }) => {
    await openWhiteboard(page)

    // An idle, unhovered, unselected shape shows no arrows.
    const idle = await markerChipOpacity(page, IDS.diamondShape, 'right')
    expect(idle).toBe(0)

    await shapeNode(page, IDS.rectShape).click({ position: { x: 5, y: 5 } })

    // All four arrows appear once selected. This is the regression guard
    // for the original bug: the handles existed and were clickable, but
    // nothing ever drew them, so the affordance was invisible.
    // Polled, not read once: the chips fade in over 0.12s, so a single
    // synchronous read straight after the click catches them mid-transition
    // (an earlier version of this case measured 0.164 and failed).
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await expect(marker(page, IDS.rectShape, side)).toBeVisible()
      await expect
        .poll(() => markerChipOpacity(page, IDS.rectShape, side))
        .toBe(1)
    }
  })

  test('QC-02: clicking a marker creates one connected shape', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const shapesBefore = await allShapeNodes(page).count()
    const connectorsBefore = await allConnectorEdges(page).count()

    await clickMarker(page, IDS.rectShape, 'right')

    await expect(allShapeNodes(page)).toHaveCount(shapesBefore + 1)
    await expect(allConnectorEdges(page)).toHaveCount(connectorsBefore + 1)

    // Persisted, not just optimistic — reload and re-count (dev has no
    // socket broadcast, so persistence is what a reload proves).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Shapes' })).toBeVisible()
    await expect(allShapeNodes(page)).toHaveCount(shapesBefore + 1)
    await expect(allConnectorEdges(page)).toHaveCount(connectorsBefore + 1)
  })

  test('QC-03: the new shape sits on the clicked side, same size and kind', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const knownIds = await allShapeNodes(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-id')),
    )

    await clickMarker(page, IDS.rectShape, 'right')
    await expect(allShapeNodes(page)).toHaveCount(knownIds.length + 1)

    // Measured AFTER the click, and relative to the canvas wrapper, so the
    // first-click toolbar collapse cannot skew the comparison either way.
    const sourceBox = await boxRelativeToCanvas(
      page,
      shapeNode(page, IDS.rectShape),
    )

    const newId = await allShapeNodes(page).evaluateAll(
      (els, known) =>
        els
          .map((el) => el.getAttribute('data-id'))
          .find((id) => id && !known.includes(id)) ?? null,
      knownIds,
    )
    expect(newId).toBeTruthy()

    const newBox = await boxRelativeToCanvas(page, shapeNode(page, newId!))
    // To the RIGHT of the source, and clear of it.
    expect(newBox.x).toBeGreaterThan(sourceBox.x + sourceBox.width)
    // Same size (within a rounding pixel) and vertically centred on it.
    expect(Math.abs(newBox.width - sourceBox.width)).toBeLessThan(2)
    expect(Math.abs(newBox.height - sourceBox.height)).toBeLessThan(2)
    const sourceCentreY = sourceBox.y + sourceBox.height / 2
    const newCentreY = newBox.y + newBox.height / 2
    expect(Math.abs(newCentreY - sourceCentreY)).toBeLessThan(2)
    // Same kind: a rectangle source yields a <rect>, not an ellipse.
    await expect(shapeNode(page, newId!).locator('rect').first()).toBeAttached()
  })

  test('QC-04: the new shape is selected with its label editor open', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await clickMarker(page, IDS.rectShape, 'bottom')

    // The label editor opens focused, so typing goes straight into it —
    // no extra gesture. This is the click-type-click-type flow.
    const editor = page.locator('.react-flow__node.react-flow__node-shape textarea')
    await expect(editor.first()).toBeFocused()

    await page.keyboard.type('Child A')
    await page.keyboard.press('Escape')

    await expect(page.getByText('Child A')).toBeVisible()

    // And it persisted.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Shapes' })).toBeVisible()
    await expect(page.getByText('Child A')).toBeVisible()
  })

  test('QC-05: dragging a marker still connects and creates no shape', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const shapesBefore = await allShapeNodes(page).count()
    const connectorsBefore = await allConnectorEdges(page).count()

    // The shipped drag-to-connect path must survive the new click handler —
    // this is the regression guard for "the click gesture ate pointerdown".
    const source = shapeNode(page, IDS.diamondShape)
    await source.hover()
    const handle = source.locator('.react-flow__handle.shape-src').first()
    const handleBox = (await handle.boundingBox())!
    const targetBox = (await shapeNode(page, IDS.textShape).boundingBox())!

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    )
    await page.mouse.up()

    await expect(allConnectorEdges(page)).toHaveCount(connectorsBefore + 1)
    // Crucially: NO new shape. A drag is a connect, never a quick-create.
    await expect(allShapeNodes(page)).toHaveCount(shapesBefore)
  })

  test('QC-06: a quick-created shape clears an occupied slot', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // rectShape (x 120) has ellipseShape at x 420 to its right — the default
    // slot region. The new shape must land clear of the ellipse, not on it.
    const knownIds = await allShapeNodes(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-id')),
    )

    await clickMarker(page, IDS.rectShape, 'right')
    await expect(allShapeNodes(page)).toHaveCount(knownIds.length + 1)

    const ellipseBox = await boxRelativeToCanvas(
      page,
      shapeNode(page, IDS.ellipseShape),
    )

    const newId = await allShapeNodes(page).evaluateAll(
      (els, known) =>
        els
          .map((el) => el.getAttribute('data-id'))
          .find((id) => id && !known.includes(id)) ?? null,
      knownIds,
    )
    const newBox = await boxRelativeToCanvas(page, shapeNode(page, newId!))

    const overlapsEllipse =
      newBox.x < ellipseBox.x + ellipseBox.width &&
      newBox.x + newBox.width > ellipseBox.x &&
      newBox.y < ellipseBox.y + ellipseBox.height &&
      newBox.y + newBox.height > ellipseBox.y
    expect(overlapsEllipse).toBe(false)
  })

  test('QC-07: Alt+Arrow is the pointerless equivalent', async ({ page }) => {
    await openWhiteboard(page)

    const shapesBefore = await allShapeNodes(page).count()
    const connectorsBefore = await allConnectorEdges(page).count()

    const source = shapeNode(page, IDS.diamondShape)
    await source.click({ position: { x: 5, y: 5 } })
    const startBox = await boxRelativeToCanvas(page, source)

    await page.keyboard.press('Alt+ArrowDown')

    await expect(allShapeNodes(page)).toHaveCount(shapesBefore + 1)
    await expect(allConnectorEdges(page)).toHaveCount(connectorsBefore + 1)
    // Alt+Arrow must NOT also nudge the source shape.
    const afterBox = await boxRelativeToCanvas(page, source)
    expect(Math.abs(afterBox.x - startBox.x)).toBeLessThan(2)
    expect(Math.abs(afterBox.y - startBox.y)).toBeLessThan(2)
  })

  test('QC-08: a plain arrow still nudges and creates nothing', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const shapesBefore = await allShapeNodes(page).count()
    const source = shapeNode(page, IDS.diamondShape)
    await source.click({ position: { x: 5, y: 5 } })
    const startBox = await boxRelativeToCanvas(page, source)

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    const afterBox = await boxRelativeToCanvas(page, source)
    expect(afterBox.x).toBeGreaterThan(startBox.x)
    await expect(allShapeNodes(page)).toHaveCount(shapesBefore)
  })

  test('QC-09: a read-only viewer gets no markers', async ({ browser }) => {
    // A VIEWER-role member: canEdit is false, so the markers must be neither
    // painted nor clickable (the N1 gate, now visual as well as interactive).
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const viewerPage = await context.newPage()
    await viewerPage.goto('/login')
    await viewerPage.waitForLoadState('networkidle')
    await viewerPage
      .getByRole('textbox', { name: 'Email' })
      .fill(E2E_VIEWER_USER.email)
    await viewerPage
      .getByRole('textbox', { name: 'Password' })
      .fill(E2E_VIEWER_USER.password)
    await viewerPage.getByRole('button', { name: 'Sign in' }).click()
    await viewerPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    })

    await viewerPage.goto(WB_URL)
    await expect(
      viewerPage.getByRole('heading', { name: 'E2E Shapes' }),
    ).toBeVisible()
    // Wait for BOTH data sources before interacting, exactly as
    // openWhiteboard does. Shapes and tables load via separate queries, and
    // interacting while the second is still settling is what left the
    // earlier version of this case clicking into an overlay for 106 retries
    // until timeout (`<html> intercepts pointer events`).
    await expect(shapeNode(viewerPage, IDS.rectShape)).toBeVisible()
    await expect(shapeNode(viewerPage, IDS.lineShape)).toBeVisible()
    await expect(
      viewerPage.locator('[data-table-name="shapes_a"]'),
    ).toBeVisible()
    await expect(
      viewerPage.locator('[data-table-name="shapes_b"]'),
    ).toBeVisible()
    await refitToScreen(viewerPage)

    const shapesBefore = await allShapeNodes(viewerPage).count()

    const rect = shapeNode(viewerPage, IDS.rectShape)
    await expect(rect).toBeVisible()
    await rect.hover()

    // Hover is the strongest reveal trigger available to a viewer; the
    // arrows must stay hidden anyway (the N1 gate is visual as well as
    // interactive).
    expect(await markerChipOpacity(viewerPage, IDS.rectShape, 'right')).toBe(0)

    // And pressing where the arrow would be creates nothing.
    const handle = marker(viewerPage, IDS.rectShape, 'right')
    const box = (await handle.boundingBox())!
    await viewerPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await viewerPage.mouse.down()
    await viewerPage.mouse.up()
    await viewerPage.waitForTimeout(400)
    await expect(allShapeNodes(viewerPage)).toHaveCount(shapesBefore)

    await context.close()
  })
})

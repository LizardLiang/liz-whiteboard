// e2e/whiteboard-viewport.spec.ts
// Regression test for LizMeter #63: under the authenticated shell, the ERD
// whiteboard route root used `h-screen` (100vh) instead of a height that
// resolves against its actual parent — `<main className="flex-1
// overflow-auto">` in __root.tsx, already reduced by the 65px <Header/>
// above it. The route root was positioned at `top: 65` but given the full
// viewport height, so its bottom landed 65px past the window bottom. React
// Flow's pane consumes wheel events for pan/zoom, so the ancestor <main
// overflow-auto> scrollbar could never reach that overflowing strip — the
// only way to catch this is measured geometry, the same way Hades diagnosed
// it (getBoundingClientRect() down the ancestor chain).
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

test.describe('Whiteboard viewport geometry (LizMeter #63)', () => {
  test('route root and React Flow pane fit within the viewport, no overflow', async ({
    page,
  }) => {
    await page.goto(WB_URL)
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    // Canvas ready: the seeded "users" table's node exists.
    await expect(tableNode(page, 'users').first()).toBeVisible()

    const innerHeight = await page.evaluate(() => window.innerHeight)

    // Route root — the direct child $whiteboardId.tsx renders into the
    // authenticated shell's <main className="flex-1 overflow-auto">
    // (__root.tsx). This is the element that broke (h-screen vs h-full).
    const routeRoot = page.locator('main.flex-1.overflow-auto > div').first()
    const rootBox = await routeRoot.boundingBox()
    expect(rootBox).not.toBeNull()

    // React Flow's own pane (ReactFlowCanvas.tsx) — the descendant whose
    // overflow was unreachable because React Flow consumes wheel events for
    // pan/zoom, so the ancestor <main overflow-auto> scrollbar never helps.
    const canvasPane = page.locator('.react-flow')
    const canvasBox = await canvasPane.boundingBox()
    expect(canvasBox).not.toBeNull()

    // The bug: both elements' bottom edge must not exceed the viewport's
    // bottom edge. Pre-fix this failed by exactly the Header's height (65px).
    expect(rootBox!.y + rootBox!.height).toBeLessThanOrEqual(innerHeight)
    expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(innerHeight)

    // Not just "doesn't overflow" — the canvas must actually fill the space
    // below the Header down to the viewport bottom, not shrink/clip short of
    // it. Sub-pixel rounding only.
    expect(innerHeight - (canvasBox!.y + canvasBox!.height)).toBeLessThanOrEqual(
      2,
    )
  })

  // Zen mode renders under a DIFFERENT shell branch (__root.tsx: <main
  // className="h-screen overflow-auto"> with no Header sibling, vs the
  // authenticated shell's <main className="flex-1 overflow-auto"> above).
  // h-full must resolve correctly against BOTH — this guards against fixing
  // one branch while regressing the other.
  test('zen mode: React Flow pane fills the full viewport with no Header', async ({
    page,
  }) => {
    await page.goto(WB_URL)
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(tableNode(page, 'users').first()).toBeVisible()

    // Toggle zen mode via the app's own `z` shortcut (ignored on form
    // fields/modifiers — see the route's keydown handler).
    await page.keyboard.press('z')
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeHidden()

    const innerHeight = await page.evaluate(() => window.innerHeight)
    const canvasPane = page.locator('.react-flow')
    const canvasBox = await canvasPane.boundingBox()
    expect(canvasBox).not.toBeNull()

    // No Header in zen mode, so the canvas starts at the very top of the
    // viewport and fills all the way to the bottom.
    expect(canvasBox!.y).toBeLessThanOrEqual(2)
    expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(innerHeight)
    expect(innerHeight - (canvasBox!.y + canvasBox!.height)).toBeLessThanOrEqual(
      2,
    )
  })
})

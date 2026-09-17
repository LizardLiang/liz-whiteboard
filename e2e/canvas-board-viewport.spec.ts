// e2e/canvas-board-viewport.spec.ts
// Regression test for LizMeter #63 (canvas board route), widened from the
// ERD whiteboard fix in e2e/whiteboard-viewport.spec.ts. Same root cause,
// same file structure — see that spec's header comment for the full
// diagnosis. This file exists SEPARATELY rather than extending that spec
// because the canvas board suite has its own seeding contract
// (e2e/seed-canvas.ts, requiring e2e/seed-stress.ts to have run first for
// the FK on IDS.viewerUser — see e2e/canvas-board.spec.ts's beforeAll/
// beforeEach) that whiteboard-viewport.spec.ts does not carry; folding a
// second seeding pipeline into that file would obscure its simpler
// global-setup-only contract.
//
// $boardId.tsx (src/routes/canvas/$boardId.tsx) had `h-screen` at its two
// return points (CenteredMessage helper, CanvasBoardPage main return) —
// same bug as the whiteboard route: under the authenticated shell
// (__root.tsx), the route root sits inside `<main className="flex-1
// overflow-auto">`, already reduced by the 65px <Header/>. `h-screen`
// (100vh) at `top: 65` pushes the bottom 65px past the window, unreachable
// because CanvasBoard's own <canvas> consumes pointer/wheel events for
// pan/zoom.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.describe('Canvas board viewport geometry (LizMeter #63)', () => {
  test.beforeAll(() => {
    // seed-canvas.ts's ProjectMember row for IDS.viewerUser needs that User
    // row to exist first (foreign_keys=ON) — seed-stress.ts is what creates
    // it. Mirrors e2e/canvas-board.spec.ts's own beforeAll exactly.
    execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
  })

  test.beforeEach(() => {
    execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
  })

  test('route root and canvas pane fit within the viewport, no overflow', async ({
    page,
  }) => {
    await page.goto(BOARD_URL)
    await expect(
      page.getByRole('heading', { name: 'E2E Canvas' }),
    ).toBeVisible()
    // Canvas ready: the engine has mounted and published its scene
    // (window.__canvasEngine, dev/e2e-only — see canvas-test-hook.ts).
    await page.waitForSelector('canvas')
    await page.waitForFunction(
      () => window.__canvasEngine !== undefined,
      null,
      { timeout: 10_000 },
    )

    const innerHeight = await page.evaluate(() => window.innerHeight)

    // Route root — $boardId.tsx renders directly into the authenticated
    // shell's <main className="flex-1 overflow-auto"> (__root.tsx). This is
    // the element that broke (h-screen vs h-full).
    const routeRoot = page.locator('main.flex-1.overflow-auto > div').first()
    const rootBox = await routeRoot.boundingBox()
    expect(rootBox).not.toBeNull()

    // The canvas engine's own <canvas> (CanvasBoard.tsx) — the descendant
    // whose overflow was unreachable because it consumes pointer/wheel
    // events for pan/zoom, so the ancestor <main overflow-auto> scrollbar
    // never helps.
    const canvasPane = page.locator('canvas')
    const canvasBox = await canvasPane.boundingBox()
    expect(canvasBox).not.toBeNull()

    // The bug: both elements' bottom edge must not exceed the viewport's
    // bottom edge. Pre-fix this failed by exactly the Header's height (65px).
    expect(rootBox!.y + rootBox!.height).toBeLessThanOrEqual(innerHeight)
    expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(innerHeight)

    // Not just "doesn't overflow" — the canvas must actually fill the space
    // down to the viewport bottom, not shrink/clip short of it. Sub-pixel
    // rounding only.
    expect(
      innerHeight - (canvasBox!.y + canvasBox!.height),
    ).toBeLessThanOrEqual(2)
  })

  // Zen mode is a GLOBAL preference (`liz-whiteboard:zen-mode` in
  // localStorage, read by __root.tsx regardless of route — see
  // src/hooks/use-zen-mode.ts) — not something $boardId.tsx opts into
  // itself. Unlike whiteboard/$whiteboardId.tsx, this route has no 'z'
  // keydown handler and never reads isZenMode, so its own top bar (board
  // name + share button) is NOT hidden by the preference — only the global
  // Header/Sidebar shell around it is. The route IS reachable in the
  // zen-mode shell branch (e.g. a tab that toggled zen mode on the
  // whiteboard route, then navigated here — localStorage is shared across
  // routes), so this test sets the flag directly and confirms the actual
  // LizMeter #63 regression (bottom-edge clamp) still holds. It deliberately
  // does NOT assert the canvas starts at y<=0 / fills the full viewport —
  // that would be asserting chrome-hiding this route never implemented, not
  // the h-screen/h-full bug this ticket is about.
  test('zen-mode shell (no Header): canvas pane still respects the viewport bottom', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('liz-whiteboard:zen-mode', 'true')
    })
    await page.goto(BOARD_URL)
    await page.waitForSelector('canvas')
    await page.waitForFunction(
      () => window.__canvasEngine !== undefined,
      null,
      { timeout: 10_000 },
    )

    const innerHeight = await page.evaluate(() => window.innerHeight)
    const canvasPane = page.locator('canvas')
    const canvasBox = await canvasPane.boundingBox()
    expect(canvasBox).not.toBeNull()

    expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(innerHeight)
    expect(
      innerHeight - (canvasBox!.y + canvasBox!.height),
    ).toBeLessThanOrEqual(2)
  })
})

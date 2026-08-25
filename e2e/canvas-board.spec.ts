// e2e/canvas-board.spec.ts
// End-to-end coverage for the FigJam-style canvas engine (tactical plan Wave 5,
// step 17) — the mandatory Playwright completion gate per CLAUDE.md.
//
// WHY THIS SUITE ASSERTS THROUGH `window.__canvasEngine`
// Canvas content has no DOM: no nodes, no data-testid, nothing to query. A
// pixel assertion proves something was painted but never WHAT. The engine
// publishes its scene and camera on `window.__canvasEngine` in dev/e2e builds
// only (src/components/canvas/canvas-test-hook.ts — verified absent from
// `bun run build` output), and that is what makes element-level assertions
// possible at all.
//
// DEBUGGING NOTE FOR WHOEVER COMES NEXT
// The dev stack is two processes: Vite (3000) and a standalone Socket.IO
// server (3010, `server.dev.ts`). A STALE bun process still holding 3010 makes
// the new server.dev.ts fail to start silently — the browser then talks to
// whatever code the old process loaded, and every canvas socket event fails
// with `Invalid namespace`. It looks exactly like an application bug. Check
// the port before believing the app is broken.
//
// DEV/PROD BROADCAST — this suite differs from shapes-and-connectors.spec.ts
// Canvas mutations run in the SOCKET handler, which lives in the standalone
// server.dev.ts process, so they persist AND broadcast in dev. The documented
// `io === null` gap applies to server functions in the Vite process, and
// Wave 4 adds none. The live-sync case below therefore asserts a genuine
// second-client push rather than falling back to reload.
//
// Isolation: dedicated project + boards (IDS.canvasProject/canvasBoard),
// re-seeded before EVERY test because these cases create, move, resize and
// delete elements. Own seed script: e2e/seed-canvas.ts.
//
// NOT COVERED HERE, and why — named rather than quietly omitted:
//   * Rollback on a REFUSED mutation, and the 10s ack timeout. Both live in
//     the client hook and need a server that refuses or stalls. A VIEWER's
//     socket does get refused, but a viewer has no tools to trigger a
//     mutation through the UI, and reaching past the UI to emit directly
//     would test the server rather than the rollback. Covered instead by
//     src/hooks/use-canvas-elements.test.ts (rollback to the last
//     server-confirmed state; late ack ignored after timeout).
//   * `lostpointercapture` from an OS gesture takeover. Playwright cannot make
//     the OS steal a gesture. The touch case below exercises the touch pointer
//     path itself; the capture-loss reset is unit-tested in
//     src/components/canvas/use-canvas-input.test.ts.
//   * Rotation — stored but not editable in milestone 1, by design.
//   * Public share links for canvas boards — step 12 of the plan is UNMET.
//     `WhiteboardShareLink` foreign-keys `Whiteboard`, so canvas boards have
//     no share path to test. This is a known gap awaiting a product decision,
//     not an oversight in this suite.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_VIEWER_USER, IDS, STORAGE_STATE } from './fixtures'
import type { Browser, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`
const VIEWER_BOARD_URL = `/canvas/${IDS.canvasViewerBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed.ts (global-setup) and seed-stress.ts must both have run first —
  // seed-canvas.ts reuses IDS.user (ADMIN) and IDS.viewerUser (VIEWER) as its
  // project's members. seed-stress.ts runs here only so E2E_VIEWER_USER's
  // account exists; its own 100-table board is never touched by this suite.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── helpers ─────────────────────────────────────────────────────────────────

interface EngineElement {
  id: string
  kind: 'rectangle' | 'text'
  x: number
  y: number
  width: number
  height: number
  text: string | null
  zIndex: number
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  editingElementId: string | null
  tool: string
  readOnly: boolean
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

/** Wait for the board to mount and publish its state. */
async function openBoard(page: Page, url = BOARD_URL): Promise<EngineState> {
  await page.goto(url)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
}

/** Backing-store size and painted-pixel count — the "did it render" probe. */
async function canvasStats(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return null
    const ctx = c.getContext('2d')
    if (!ctx) return null
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted += 1
    const rect = c.getBoundingClientRect()
    return {
      width: c.width,
      height: c.height,
      cssWidth: Math.round(rect.width),
      cssHeight: Math.round(rect.height),
      painted,
    }
  })
}

/**
 * World point -> page coordinates, using the engine's OWN camera.
 *
 * Never hand-roll the transform here. `camera.ts` owns exactly one
 * screen<->world pair, and a second one living in the test would drift from
 * the renderer silently — which is the exact bug class (W1/W3) the engine was
 * designed to make impossible.
 */
async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function selectTool(page: Page, label: string) {
  await page.click(`[aria-label="${label}"]`)
}

async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  // Deliver the final position a second time. Under load the browser can
  // coalesce the tail of a stepped move, leaving the gesture a few pixels
  // short — which passes a "did it grow?" poll and then fails an exact
  // geometry assertion after reload. A duplicate move at the exact target is
  // idempotent for every gesture here (move, resize, marquee, draw) and makes
  // the end point deterministic.
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

function byId(state: EngineState, id: string) {
  return state.elements.find((element) => element.id === id)
}

/** Mirrors global-setup.ts's login flow — real form, cookie is ground truth. */
async function loginAsViewer(browser: Browser): Promise<Page> {
  // An EXPLICITLY empty storage state is load-bearing. `browser.newContext()`
  // here picks up the config's ADMIN `use.storageState`, so without this the
  // context arrives already signed in as the owner: /login redirects away, the
  // credentials below never take effect, and the cookie check passes on its
  // first iteration against the OWNER's cookie. The test then asserts
  // "read-only" against a session that can edit everything, and fails in a way
  // that looks like a permissions bug in the app.
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const email = page.getByRole('textbox', { name: 'Email' })
  const password = page.getByRole('textbox', { name: 'Password' })
  const signIn = page.getByRole('button', { name: 'Sign in' })
  await email.click()
  await email.pressSequentially(E2E_VIEWER_USER.email)
  await password.click()
  await password.pressSequentially(E2E_VIEWER_USER.password)
  await expect(signIn).toBeEnabled({ timeout: 10_000 })
  await signIn.click()

  // Wait for the session cookie rather than any redirect — global-setup.ts
  // records the same rationale: the post-login client redirect can bounce, so
  // the cookie, not the URL, is the ground truth.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === 'session_token' && c.value.length > 0)) {
      // Hand back a FRESH page in the now-authenticated context rather than
      // the one that submitted the form.
      //
      // The app bounces back to `/login?redirect=%2F` after sign-in (the
      // known, pre-existing redirect bounce global-setup.ts documents) and
      // then client-redirects again. Navigating that page supersedes the
      // in-flight navigation and Playwright reports `net::ERR_ABORTED`, which
      // reads like a broken route rather than a race — and `networkidle` does
      // not settle it, because the redirect is client-side. A brand-new page
      // in the same context carries the session cookie and has no pending
      // navigation to lose to.
      const fresh = await context.newPage()
      await page.close()
      return fresh
    }
    await page.waitForTimeout(250)
  }
  throw new Error('viewer login failed: session_token cookie was never set')
}

// ── regressions that shipped green and were only caught by hand ─────────────

test.describe('regressions', () => {
  test('REG-1: the board renders — backing store matches the CSS box and pixels are painted', async ({
    page,
  }) => {
    // This shipped BROKEN with 1820 unit tests passing: a stale animation-frame
    // id survived an effect cleanup, `requestRedraw` early-returned on it
    // forever, and `drawScene` was never called on any frame. The backing store
    // stayed at the 300x150 HTML default and the board painted nothing at all.
    // use-frame-loop.test.ts covers the mechanism; this covers the symptom.
    await openBoard(page)
    await expect
      .poll(async () => (await canvasStats(page))?.painted ?? 0, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0)

    const stats = await canvasStats(page)
    expect(stats).not.toBeNull()
    expect(stats!.width).toBeGreaterThan(1000)
    expect(stats!.height).toBeGreaterThan(500)
    // Sized from the CSS box times the device pixel ratio, never left at the
    // 300x150 HTML default.
    expect(stats!.width).toBeGreaterThanOrEqual(stats!.cssWidth)
    expect(stats!.height).toBeGreaterThanOrEqual(stats!.cssHeight)
  })

  test('REG-2: a text element can be created, typed into, committed and reloaded — exactly one row', async ({
    page,
  }) => {
    // This shipped broken too, and differently: the browser's native
    // focus-on-mousedown stole focus from the off-screen IME proxy, the empty
    // element was discarded on blur, and no text row ever reached the
    // database. A separate defect committed TWICE, producing two rows for one
    // element — hence the exact count here rather than a truthy check.
    await openBoard(page)
    const before = await engine(page)
    const textBefore = before.elements.filter((e) => e.kind === 'text').length

    await selectTool(page, 'Text (T)')
    const at = await worldToPage(page, { x: 700, y: 260 })
    await page.mouse.click(at.x, at.y)

    // Focus must land on the off-screen proxy, not the board container.
    await expect
      .poll(async () =>
        page.evaluate(() => document.activeElement?.tagName ?? null),
      )
      .toBe('TEXTAREA')

    await page.keyboard.type('e2e typed text')
    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .not.toBeNull()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)

    const after = await openBoard(page)
    const created = after.elements.filter(
      (e) => e.kind === 'text' && e.text === 'e2e typed text',
    )
    expect(created).toHaveLength(1)
    expect(after.elements.filter((e) => e.kind === 'text')).toHaveLength(
      textBefore + 1,
    )
  })
})

// ── the plan's named Wave 5 scope (step 17) ─────────────────────────────────

test.describe('draw, move, persist', () => {
  test('draws a rectangle and reports it through the engine hook', async ({
    page,
  }) => {
    const before = await openBoard(page)
    await selectTool(page, 'Rectangle (R)')

    await dragMouse(
      page,
      await worldToPage(page, { x: 700, y: 160 }),
      await worldToPage(page, { x: 900, y: 300 }),
    )

    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)

    const state = await engine(page)
    const drawn = state.elements.find(
      (e) => !before.elements.some((b) => b.id === e.id),
    )!
    expect(drawn.kind).toBe('rectangle')
    expect(drawn.x).toBeCloseTo(700, 0)
    expect(drawn.y).toBeCloseTo(160, 0)
    expect(drawn.width).toBeCloseTo(200, 0)
    expect(drawn.height).toBeCloseTo(140, 0)
    // Drawing selects what was just drawn and returns to the select tool.
    expect(state.selectedIds).toEqual([drawn.id])
    expect(state.tool).toBe('select')
  })

  test('moves an element and the move survives a reload', async ({ page }) => {
    await openBoard(page)

    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }), // inside canvasRect
      await worldToPage(page, { x: 700, y: 620 }),
    )

    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeGreaterThan(500)
    await page.waitForTimeout(800)

    const after = await openBoard(page)
    const moved = byId(after, IDS.canvasRect)!
    // Dragged by +300/+250 world units from 300,300.
    expect(moved.x).toBeCloseTo(600, 0)
    expect(moved.y).toBeCloseTo(550, 0)
    // Geometry must not drift while moving.
    expect(moved.width).toBeCloseTo(200, 0)
    expect(moved.height).toBeCloseTo(140, 0)
  })

  test('deletes the selected element and the deletion survives a reload', async ({
    page,
  }) => {
    await openBoard(page)
    const at = await worldToPage(page, { x: 400, y: 370 })
    await page.mouse.click(at.x, at.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasRect])

    await page.keyboard.press('Delete')
    await page.waitForTimeout(800)

    const after = await openBoard(page)
    expect(byId(after, IDS.canvasRect)).toBeUndefined()
  })
})

// ── interactions that were unit-tested but never clicked ────────────────────

test.describe('selection and transform', () => {
  test('resizes with a corner handle and persists the new size', async ({
    page,
  }) => {
    await openBoard(page)
    const inside = await worldToPage(page, { x: 400, y: 370 })
    await page.mouse.click(inside.x, inside.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(1)

    // The south-east grip sits ON the element's bottom-right corner in SCREEN
    // space, a constant 8px regardless of zoom (plan decision B7).
    await dragMouse(
      page,
      await worldToPage(page, { x: 500, y: 440 }),
      await worldToPage(page, { x: 620, y: 540 }),
    )

    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.width ?? 0)
      .toBeGreaterThan(280)
    await page.waitForTimeout(800)

    const after = await openBoard(page)
    const resized = byId(after, IDS.canvasRect)!
    expect(resized.width).toBeCloseTo(320, 0)
    expect(resized.height).toBeCloseTo(240, 0)
    // Resizing from the SE corner must not move the origin.
    expect(resized.x).toBeCloseTo(300, 0)
    expect(resized.y).toBeCloseTo(300, 0)
  })

  test('marquee selects every element it intersects', async ({ page }) => {
    await openBoard(page)
    // Drag from empty space across both seeded elements.
    const from = await worldToPage(page, { x: 250, y: 250 })
    const to = await worldToPage(page, { x: 620, y: 620 })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.move(to.x, to.y)

    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)
    await page.mouse.up()

    const state = await engine(page)
    expect([...state.selectedIds].sort()).toEqual(
      [IDS.canvasRect, IDS.canvasText].sort(),
    )
  })

  test('moves a multi-selection together and persists both', async ({
    page,
  }) => {
    await openBoard(page)
    await dragMouse(
      page,
      await worldToPage(page, { x: 250, y: 250 }),
      await worldToPage(page, { x: 620, y: 620 }),
    )
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)

    // Drag from inside the rectangle; both selected elements must follow.
    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 500, y: 470 }),
    )
    await page.waitForTimeout(900)

    const after = await openBoard(page)
    expect(byId(after, IDS.canvasRect)!.x).toBeCloseTo(400, 0)
    expect(byId(after, IDS.canvasText)!.x).toBeCloseTo(400, 0)
    expect(byId(after, IDS.canvasText)!.y).toBeCloseTo(620, 0)
  })
})

test.describe('camera', () => {
  test('wheel zooms and keeps the world point under the cursor fixed', async ({
    page,
  }) => {
    await openBoard(page)
    const anchorWorld = { x: 400, y: 370 }
    const anchorPage = await worldToPage(page, anchorWorld)

    await page.mouse.move(anchorPage.x, anchorPage.y)
    await page.mouse.wheel(0, -400)
    await expect
      .poll(async () => (await engine(page)).camera.zoom)
      .toBeGreaterThan(1)

    // zoomAt's invariant: the world point under the cursor does not move.
    const afterAnchor = await worldToPage(page, anchorWorld)
    expect(afterAnchor.x).toBeCloseTo(anchorPage.x, 0)
    expect(afterAnchor.y).toBeCloseTo(anchorPage.y, 0)
  })

  test('space-drag pans the camera without moving any element', async ({
    page,
  }) => {
    const before = await openBoard(page)
    const from = await worldToPage(page, { x: 700, y: 700 })

    // Click empty canvas first so the board container holds keyboard focus.
    const empty = await worldToPage(page, { x: 900, y: 800 })
    await page.mouse.click(empty.x, empty.y)

    await page.keyboard.down('Space')
    await dragMouse(page, from, { x: from.x - 200, y: from.y - 120 })
    await page.keyboard.up('Space')

    const after = await engine(page)
    // panByScreenDelta divides by zoom; at zoom 1 a -200px drag is +200 world.
    expect(after.camera.x).toBeCloseTo(200, 0)
    expect(after.camera.y).toBeCloseTo(120, 0)
    // Panning is a camera change only — no element may move.
    expect(byId(after, IDS.canvasRect)!.x).toBe(byId(before, IDS.canvasRect)!.x)
  })
})

test.describe('theme', () => {
  test('default text stays readable in BOTH themes (resolveTextColor policy)', async ({
    page,
  }) => {
    // The stored default colour is #0f172a, unreadable on the dark theme's
    // near-black background. `resolveTextColor` substitutes the theme
    // foreground when — and only when — the stored colour is that default.
    // Sampling the seeded text element's own region is the only way to see
    // this: the colour never reaches the DOM.
    async function textLuminance(theme: 'light' | 'dark') {
      await page.addInitScript(
        (value) => window.localStorage.setItem('theme', value),
        theme,
      )
      await openBoard(page)
      await expect
        .poll(async () => (await canvasStats(page))?.painted ?? 0)
        .toBeGreaterThan(0)

      return page.evaluate(() => {
        const c = document.querySelector('canvas')!
        const ctx = c.getContext('2d')!
        const ratio = c.width / c.getBoundingClientRect().width
        // The seeded text element sits at world 300,520 with the default
        // camera, so its glyphs fall inside this box in device pixels.
        const d = ctx.getImageData(
          Math.round(300 * ratio),
          Math.round(520 * ratio),
          Math.round(240 * ratio),
          Math.round(48 * ratio),
        ).data
        let total = 0
        let count = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue
          total += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
          count += 1
        }
        return count === 0 ? null : total / count
      })
    }

    const light = await textLuminance('light')
    const dark = await textLuminance('dark')
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // The dark theme draws the same text in a LIGHT foreground. If the stored
    // #0f172a were used verbatim, the two would be indistinguishable.
    expect(dark!).toBeGreaterThan(light!)
  })
})

test.describe('permissions', () => {
  test('a VIEWER sees the board but gets no tools', async ({ browser }) => {
    const viewerPage = await loginAsViewer(browser)
    try {
      const state = await openBoard(viewerPage, VIEWER_BOARD_URL)

      expect(state.readOnly).toBe(true)
      expect(byId(state, IDS.canvasViewerRect)).toBeDefined()
      await expect(
        viewerPage.getByRole('heading', { name: 'E2E Canvas Viewer' }),
      ).toBeVisible()
      await expect(viewerPage.getByText('Read-only')).toBeVisible()

      // No tool palette at all — not a disabled one.
      await expect(
        viewerPage.locator('[role="toolbar"][aria-label="Canvas tools"]'),
      ).toHaveCount(0)
      for (const label of ['Select (V)', 'Rectangle (R)', 'Text (T)']) {
        await expect(
          viewerPage.locator(`[aria-label="${label}"]`),
        ).toHaveCount(0)
      }

      // The board still renders for them.
      await expect
        .poll(async () => (await canvasStats(viewerPage))?.painted ?? 0)
        .toBeGreaterThan(0)

      // And a drag changes nothing: read-only pans, it does not move.
      const before = byId(state, IDS.canvasViewerRect)!.x
      const box = await viewerPage.locator('canvas').boundingBox()
      await viewerPage.mouse.move(box!.x + 400, box!.y + 370)
      await viewerPage.mouse.down()
      await viewerPage.mouse.move(box!.x + 700, box!.y + 620, { steps: 8 })
      await viewerPage.mouse.up()
      await viewerPage.waitForTimeout(500)

      const after = await engine(viewerPage)
      expect(byId(after, IDS.canvasViewerRect)!.x).toBe(before)
    } finally {
      await viewerPage.context().close()
    }
  })
})

test.describe('collaboration', () => {
  test('a second client sees an element appear live, without reloading', async ({
    page,
    browser,
  }) => {
    // Unlike shapes-and-connectors.spec.ts, this asserts a REAL broadcast.
    // Canvas mutations run in the Socket.IO handler inside server.dev.ts, so
    // they broadcast in dev; the `io === null` gap applies to server functions
    // in the Vite process and Wave 4 adds none. If this ever turns flaky, the
    // fallback is asserting persistence by reload — but do not make that
    // change without first confirming 3010 is actually alive (see the header).
    await openBoard(page)

    const observer = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE,
      viewport: { width: 1600, height: 1000 },
    })
    const observerPage = await observer.newPage()
    try {
      const before = await openBoard(observerPage)

      await selectTool(page, 'Rectangle (R)')
      await dragMouse(
        page,
        await worldToPage(page, { x: 800, y: 160 }),
        await worldToPage(page, { x: 950, y: 280 }),
      )

      await expect
        .poll(async () => (await engine(observerPage)).elements.length, {
          timeout: 15_000,
        })
        .toBe(before.elements.length + 1)

      const observed = (await engine(observerPage)).elements.find(
        (e) => !before.elements.some((b) => b.id === e.id),
      )!
      expect(observed.kind).toBe('rectangle')
      expect(observed.x).toBeCloseTo(800, 0)
      expect(observed.width).toBeCloseTo(150, 0)
    } finally {
      await observer.close()
    }
  })
})

test.describe('touch input', () => {
  test('a touch drag moves an element', async ({ browser }) => {
    // Pen and touch share the pointer-event path, and the canvas sets
    // `touch-action: none` so the browser cannot claim the gesture for
    // scrolling. Driven through CDP `Input.dispatchTouchEvent` because
    // Playwright's touchscreen API only taps — a real touch DRAG is the point.
    //
    // What is NOT reachable here is an OS gesture takeover revoking pointer
    // capture without a cancel event; see the file header.
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE,
      hasTouch: true,
      viewport: { width: 1600, height: 1000 },
    })
    const page = await context.newPage()
    try {
      await openBoard(page)
      const from = await worldToPage(page, { x: 400, y: 370 })
      const to = await worldToPage(page, { x: 650, y: 570 })

      const cdp = await context.newCDPSession(page)
      const touch = (x: number, y: number) => [{ x, y, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: touch(from.x, from.y),
      })
      for (let step = 1; step <= 8; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: touch(
            from.x + ((to.x - from.x) * step) / 8,
            from.y + ((to.y - from.y) * step) / 8,
          ),
        })
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })

      await expect
        .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
        .toBeCloseTo(550, 0)
      await expect
        .poll(async () => byId(await engine(page), IDS.canvasRect)?.y ?? 0)
        .toBeCloseTo(500, 0)
    } finally {
      await context.close()
    }
  })
})

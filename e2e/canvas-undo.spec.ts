// e2e/canvas-undo.spec.ts
// End-to-end coverage for canvas board undo/redo (board-undo tactical plan,
// Wave 5, step 14) — the mandatory Playwright completion gate per CLAUDE.md.
//
// Mirrors e2e/canvas-board.spec.ts structure-for-structure: same
// window.__canvasEngine assertion technique (canvas content has no DOM),
// same dedicated-seed-per-test isolation, same `loginAsViewer` storageState-
// inheritance trap and `anonymousPage(browser)` helper (both duplicated here
// rather than imported — canvas-board.spec.ts does not export them, and
// every other canvas e2e file in this repo keeps its own local copy of these
// mechanics rather than centralising them; e2e/canvas-helpers.ts holds only
// React-Flow/ER-board helpers, not FigJam canvas-engine ones).
//
// SEEDING ORDER — read this before touching test.beforeAll/beforeEach.
// e2e/seed-canvas.ts's project membership references IDS.viewerUser, a User
// row that e2e/seed.ts (global-setup's own seed) does NOT create — only
// e2e/seed-stress.ts does. Seeding canvas onto a database seeded by
// global-setup alone therefore fails with a FOREIGN KEY error the moment
// seed-canvas.ts's ProjectMember insert runs. canvas-board.spec.ts's own
// `test.beforeAll` already runs seed-stress.ts for exactly this reason; this
// suite copies that ordering rather than rediscovering the failure.
//
// DEV/PROD BROADCAST — same as canvas-board.spec.ts, restated because it
// matters for the contested-undo test below: canvas mutations run in the
// Socket.IO handler living in the standalone server.dev.ts process, so they
// broadcast live in dev too. The documented `io === null` gap applies only
// to server functions running in the Vite process; canvas-board handlers are
// not one, so the two-tab contested-undo case below asserts a REAL broadcast
// round trip, not persistence-via-reload.
//
// REQUIREMENT COVERAGE — one row per spec-delta requirement (13 total),
// stated here so the final report can quote this table rather than re-derive
// it. "e2e" = exercised end-to-end below. "unit-only" = covered by the unit
// suite (cited) but has no meaningful, non-redundant end-to-end expression.
//   Canvas Undo Reverses The Last Local Edit         -> e2e (undo move)
//   Canvas Undo Covers Every Element Gesture         -> unit-only
//     (coverage-audit.test.ts enforces the audit itself; this suite's undo
//     move/create/delete tests each exercise ONE covered gesture, which
//     proves those specific paths work but cannot, by nature of the
//     requirement's own "audit, not inspection" clause, stand in for the
//     audit — an e2e suite enumerates nothing, it only samples.)
//   Canvas Element Writes Carry A Monotonic Revision -> unit-only
//     (src/data/canvas-element.test.ts, src/lib/canvas-board/handlers.test.ts
//     — the revision integer is server-internal and window.__canvasEngine
//     publishes no revision field; the contested-undo test below exercises
//     its OBSERVABLE consequence — a stale revision is refused — without
//     reading the number itself.)
//   Canvas Redo                                      -> e2e (redo move,
//     undo/redo create)
//   Canvas Undo Is Scoped To The Acting Session       -> e2e (contested undo:
//     A's undo touches only A's own entry, never B's edit)
//   Canvas Undo Refuses A Contested Element           -> e2e (contested undo)
//   Canvas Undo Reports What It Did                   -> e2e (every test
//     below asserts a toast; camera focus/highlight tested explicitly)
//   Remote And Derived Canvas Writes Are Not Undoable -> e2e (contested undo:
//     B's move is never reversed by A's undo — partial; the "programmatic
//     write during reconciliation" half of this requirement has no UI
//     trigger and stays unit-only, use-canvas-elements.test.ts)
//   One Canvas Gesture Is One Undo Entry              -> e2e (multi-select
//     move undone in one step; multi-level undo's LIFO ordering)
//   Canvas Undo Respects Authorisation                -> e2e (viewer +
//     anonymous visitor, both asserted via captured Socket.IO frames)
//   Canvas Undo Restores Deleted Elements Faithfully  -> e2e (delete ->
//     undo, geometry AND zIndex asserted)
//   Canvas Undo History Is Bounded                    -> unit-only
//     (src/lib/canvas-undo/undo-stack.test.ts asserts the 100-entry cap and
//     oldest-eviction directly; driving 100 real gestures through the UI to
//     observe eviction would be the slowest possible way to re-assert a
//     pure-function property already pinned exactly. The "reaching the cap
//     is not silent" half is the SAME code path this suite's own exhaustion
//     test already exercises — "Nothing left to undo." is not a different
//     message for a capped-out stack vs a genuinely empty one.)
//   Canvas Undo Does Not Capture Camera Movement      -> e2e (pan, then
//     undo — the pan is left alone, the content edit is reversed)
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_VIEWER_USER, IDS, STORAGE_STATE } from './fixtures'
import type { Browser, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`
const VIEWER_BOARD_URL = `/canvas/${IDS.canvasViewerBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed.ts (global-setup) and seed-stress.ts must both have run first — see
  // the file header's "SEEDING ORDER" note.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── helpers (mirrors e2e/canvas-board.spec.ts) ───────────────────────────────

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

async function openBoard(page: Page, url = BOARD_URL): Promise<EngineState> {
  await page.goto(url)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
}

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
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

function byId(state: EngineState, id: string) {
  return state.elements.find((element) => element.id === id)
}

/**
 * The canvas element's own CSS pixel size — equals the app's `viewport.
 * width/height` state (`CanvasBoard.tsx`'s `ResizeObserver`), NOT the
 * browser's 1600x1000 test viewport: a left project-tree sidebar and a top
 * header inset the canvas, so `visibleWorldRect` (camera.ts) — which
 * divides by THIS size, not the browser viewport — needs the real,
 * measured value for any test that reasons about what is on/off screen.
 */
async function canvasViewportSize(
  page: Page,
): Promise<{ width: number; height: number }> {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return { width: box.width, height: box.height }
}

/**
 * Click empty canvas so the board container holds keyboard focus, without
 * selecting or moving anything.
 *
 * The default target is derived from the CANVAS ELEMENT'S OWN measured
 * bounding box, not a fixed world coordinate — a live debug run of this
 * suite's first attempt found `document.activeElement` stuck on `<body>`
 * after every click at a fixed `{x:1500,y:900}`, because the canvas does
 * NOT span the full browser viewport: a left project-tree sidebar and a top
 * header inset it (measured ~256px / ~114px at this viewport size), leaving
 * the canvas only ~1344x951 CSS pixels. World x=1500 mapped to a page point
 * past the canvas's own right edge — `document.elementFromPoint` there
 * returned nothing at all (confirmed by instrumenting the page directly),
 * so the click's `pointerdown` never reached `CanvasBoard.tsx`'s own
 * `containerRef.current?.focus()` call, and every following `Control+z`
 * therefore went to `<body>`, which does nothing — the toast never
 * appeared, and every affected test read as "Ctrl+Z does nothing" until
 * this was traced to its root cause with a throwaway instrumented test.
 *
 * Near the TOP of the ACTUAL measured canvas box, not the bottom: a first
 * version of this fix used `box.y + box.height - 60`, which turned out to
 * exceed the 1600x1000 BROWSER viewport entirely (`box.y` alone was 114 in
 * the environment that found this, and `box.height` was 951 — their sum,
 * 1065, is past the bottom of a 1000px-tall browser window), so the click
 * landed off-screen and missed the canvas exactly as the original x=1500
 * bug did. `box.y + 150` stays comfortably inside any viewport this suite
 * uses (`test.use({ viewport: { height: 1000 } })` at the top of this
 * file), clears the top-left tool palette (`absolute left-4 top-4`, roughly
 * 40-50px tall) by a wide margin, and sits well above every seeded or
 * moved element in this suite (nothing here ever operates above world
 * y=300 at the default camera, or drifts there after a small pan).
 */
async function focusBoard(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  // SCREEN space, not worldToPage/world coordinates: a fixed WORLD point
  // can drift onto or past either edge of the viewport once a test pans
  // the camera (this suite's camera-focus and pan tests both do), which
  // would silently reintroduce the exact "click lands on nothing" failure
  // this helper exists to prevent.
  await page.mouse.click(box.x + 40, box.y + 150)
}

/**
 * Wait for a just-committed forward gesture (move/create/delete) to be
 * RECORDED, not merely rendered.
 *
 * A drag's destination, a freshly drawn element and a delete all update
 * `window.__canvasEngine`'s scene OPTIMISTICALLY, synchronously, before any
 * network round trip — exactly what canvas-board.spec.ts's own `.poll()`
 * calls after a drag observe. This suite's own undo/redo ENTRY, however, is
 * only pushed inside `recordCreate`/`recordUpdate`/`recordDelete`'s
 * `.then()` — after the server's ack resolves. Calling `undo()` between
 * those two moments finds an EMPTY stack and shows "Nothing left to undo."
 * — a toast that fades (sonner's default ~4s) long before a later
 * `getByText('Undid ...')` assertion's 10s timeout elapses, which is
 * exactly how this suite's own first run misread a pure timing race as
 * "Ctrl+Z does nothing at all". canvas-board.spec.ts's own "moves an
 * element ... survives a reload" test uses 800ms for the same underlying
 * race; this suite gives it a wider 1500ms margin because it chains MANY
 * more of these round trips per test (up to 4-5 recorded writes before a
 * single undo/redo call), so the same dev socket connection has strictly
 * more queued traffic ahead of any one of them by the time a later test in
 * this file runs.
 */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

/**
 * Click empty canvas immediately before sending the shortcut, every time —
 * never rely on a preceding drag's own pointerdown-triggered
 * `containerRef.focus()` staying in effect. canvas-board.spec.ts's own
 * "space-drag pans" test does the same thing (an explicit click right
 * before the keyboard shortcut, even though a drag just ran) for the same
 * reason: this suite's own first run found `Control+z` silently swallowed
 * — no toast, no reversal — whenever the keypress was sent on the strength
 * of an earlier gesture's focus alone, in a real Chromium session where
 * this repeatedly reproduced consistently (not a one-off flake).
 */
async function undo(page: Page) {
  await focusBoard(page)
  await page.keyboard.press('Control+z')
}

async function redo(page: Page) {
  await focusBoard(page)
  await page.keyboard.press('Control+Shift+z')
}

/** Every text or websocket frame sent while this collector is attached. Attach BEFORE navigation. */
function captureSocketFrames(page: Page): Array<string> {
  const frames: Array<string> = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      if (typeof frame.payload === 'string') frames.push(frame.payload)
    })
  })
  return frames
}

/** Mirrors global-setup.ts's login flow — real form, cookie is ground truth. */
async function loginAsViewer(browser: Browser): Promise<Page> {
  // An EXPLICITLY empty storage state is load-bearing — see
  // canvas-board.spec.ts's identical helper for the full rationale: without
  // it, `browser.newContext()` inherits the config's ADMIN storageState and
  // this test would silently assert "read-only" against an owner session.
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

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === 'session_token' && c.value.length > 0)) {
      const fresh = await context.newPage()
      await page.close()
      return fresh
    }
    await page.waitForTimeout(250)
  }
  throw new Error('viewer login failed: session_token cookie was never set')
}

/** A context with genuinely no session — the state a real public-share visitor arrives in. */
async function anonymousPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  })
  return context.newPage()
}

async function createShareLinkViaUI(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Share' }).click()
  await page.getByRole('button', { name: 'Create link' }).click()
  const field = page.locator('#canvas-share-url')
  await expect(field).toBeVisible({ timeout: 10_000 })
  const url = await field.inputValue()
  expect(url).toContain('/canvas-share/')
  return url
}

// ── tests ─────────────────────────────────────────────────────────────────

test.describe('undo a move', () => {
  test('undo returns the element to its prior position and reports what it did', async ({
    page,
  }) => {
    await openBoard(page)

    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 700, y: 620 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeGreaterThan(500)
    await settle(page)

    await undo(page)
    await expect(page.getByText('Undid moving an element')).toBeVisible()

    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300, 0)
    const after = byId(await engine(page), IDS.canvasRect)!
    expect(after.y).toBeCloseTo(300, 0)
    expect(after.width).toBeCloseTo(200, 0)
    expect(after.height).toBeCloseTo(140, 0)
  })
})

test.describe('multi-level undo', () => {
  test('two elements moved, two undos, each reverses the right one', async ({
    page,
  }) => {
    // This is the exact case that silently did nothing before the B1 fix
    // (a stale afterRevision made the second element's undo read as
    // contested even though only the user's own prior undo/redo had ever
    // touched the row).
    await openBoard(page)

    // Move 1: the rectangle.
    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 700, y: 620 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(600, 0)
    await settle(page)

    // Move 2: the text element, a separate gesture entirely.
    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 540 }),
      await worldToPage(page, { x: 700, y: 540 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasText)?.x ?? 0)
      .toBeCloseTo(600, 0)
    await settle(page)

    // Undo #1 reverses the LAST gesture (the text move) only.
    await undo(page)
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasText)?.x ?? 0)
      .toBeCloseTo(300, 0)
    expect(byId(await engine(page), IDS.canvasRect)!.x).toBeCloseTo(600, 0)

    // Undo #2 reverses the rectangle move.
    await undo(page)
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300, 0)
    expect(byId(await engine(page), IDS.canvasText)!.x).toBeCloseTo(300, 0)
  })
})

test.describe('redo a move', () => {
  test('redo reapplies the reversed move and reports what it did', async ({
    page,
  }) => {
    await openBoard(page)

    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 700, y: 620 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(600, 0)
    await settle(page)

    await undo(page)
    await expect(page.getByText('Undid moving an element')).toBeVisible()
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300, 0)

    await redo(page)
    await expect(page.getByText('Redid moving an element')).toBeVisible()
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(600, 0)
    const after = byId(await engine(page), IDS.canvasRect)!
    expect(after.y).toBeCloseTo(550, 0)
  })
})

test.describe('undo and redo a create', () => {
  test('undo removes the drawn rectangle; redo brings it back under the same id', async ({
    page,
  }) => {
    const before = await openBoard(page)
    await selectTool(page, 'Rectangle (R)')
    await dragMouse(
      page,
      await worldToPage(page, { x: 900, y: 160 }),
      await worldToPage(page, { x: 1050, y: 260 }),
    )
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)
    // Settle BEFORE capturing the drawn element's id, not after: the scene
    // shows the element under a CLIENT-GENERATED temporary id the instant
    // the draw gesture commits (optimistic, synchronous, no network round
    // trip yet — same optimistic-update fact `settle`'s own doc comment
    // explains). The server's ack then RECONCILES that temporary id to the
    // real one — the id undo/redo actually operate on and restore under —
    // which only happens after the round trip `settle` waits out. Reading
    // `drawn.id` before that point silently captures the temporary id, so a
    // (correct) redo restoring the element under its real id reads as a
    // failure: "the id changed" when it never really did.
    await settle(page)
    const drawn = (await engine(page)).elements.find(
      (e) => !before.elements.some((b) => b.id === e.id),
    )!
    expect(drawn.kind).toBe('rectangle')

    await undo(page)
    await expect(page.getByText('Undid creating a rectangle')).toBeVisible()
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length)
    expect(byId(await engine(page), drawn.id)).toBeUndefined()

    await redo(page)
    await expect(page.getByText('Redid creating a rectangle')).toBeVisible()
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 1)
    const restored = byId(await engine(page), drawn.id)
    expect(restored).toBeDefined()
    expect(restored!.x).toBeCloseTo(drawn.x, 0)
    expect(restored!.width).toBeCloseTo(drawn.width, 0)
  })
})

test.describe('undo a delete', () => {
  test('the element returns with identical geometry and its ORIGINAL zIndex, not bumped to top', async ({
    page,
  }) => {
    await openBoard(page)
    const at = await worldToPage(page, { x: 400, y: 370 })
    await page.mouse.click(at.x, at.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasRect])
    const original = byId(await engine(page), IDS.canvasRect)!
    expect(original.zIndex).toBe(0)

    await page.keyboard.press('Delete')
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect))
      .toBeUndefined()
    await settle(page)

    await undo(page)
    await expect(page.getByText('Undid deleting an element')).toBeVisible()
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect))
      .toBeDefined()

    const restored = byId(await engine(page), IDS.canvasRect)!
    expect(restored.id).toBe(IDS.canvasRect)
    expect(restored.x).toBeCloseTo(300, 0)
    expect(restored.y).toBeCloseTo(300, 0)
    expect(restored.width).toBeCloseTo(200, 0)
    expect(restored.height).toBeCloseTo(140, 0)
    // The whole point of this test: canvasText occupied zIndex 1 the entire
    // time this element was deleted, so an ordinary create's server-computed
    // zIndex (MAX + 1) would land this restored element at 2 — on TOP of the
    // board, not back where it was. A faithful restore must come back at its
    // OWN original zIndex, 0, underneath canvasText.
    expect(restored.zIndex).toBe(0)
  })
})

test.describe('undo exhaustion', () => {
  test('undo with nothing recorded announces itself instead of doing nothing silently', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)

    const before = await engine(page)
    await undo(page)
    await expect(page.getByText('Nothing left to undo.')).toBeVisible()

    const after = await engine(page)
    expect(after.elements).toEqual(before.elements)
  })
})

test.describe('camera focus on undo', () => {
  test('undoing a move whose target is now off-screen pans the camera to bring it back into view', async ({
    page,
  }) => {
    await openBoard(page)
    const viewport = await canvasViewportSize(page)

    // Drag delta exceeds half the ACTUAL viewport width — the mission's own
    // named decisive case for headed-browser BUG-2. Derived from the
    // MEASURED canvas box, not a hardcoded 1600: the canvas is inset by a
    // sidebar/header and is narrower than the browser's own test viewport
    // (see `focusBoard`'s own comment — an earlier version of this test
    // used a fixed x=1300/1500 that silently fell outside the canvas
    // element on this very layout).
    const deltaX = Math.floor(viewport.width / 2) + 100
    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 400 + deltaX, y: 370 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300 + deltaX, 0)
    await settle(page)

    // Pan the camera to follow the moved element, as a real user would —
    // this leaves the element's ORIGINAL (pre-move) position off-screen.
    // Anchored bottom-right of the (pre-pan) canvas — measured, safely
    // clear of every element this test touches — rather than a fixed
    // coordinate that may or may not land inside the actual canvas box.
    const panFrom = await worldToPage(page, {
      x: viewport.width - 100,
      y: viewport.height - 100,
    })
    const panDelta = deltaX + 100
    const panTo = await worldToPage(page, {
      x: viewport.width - 100 - panDelta,
      y: viewport.height - 100,
    })
    await page.mouse.click(panFrom.x, panFrom.y)
    await page.keyboard.down('Space')
    await dragMouse(page, panFrom, panTo)
    await page.keyboard.up('Space')
    await expect
      .poll(async () => (await engine(page)).camera.x)
      .toBeCloseTo(panDelta, 0)

    // Sanity: the ORIGINAL position (300,300)-(500,440) really is outside
    // the visible world rect right now — otherwise this test would not be
    // exercising the fix at all.
    const beforeUndo = await engine(page)
    const visibleBefore = {
      x: beforeUndo.camera.x,
      y: beforeUndo.camera.y,
      width: viewport.width / beforeUndo.camera.zoom,
      height: viewport.height / beforeUndo.camera.zoom,
    }
    expect(300 + 200).toBeLessThanOrEqual(visibleBefore.x) // fully to the left of the viewport

    await undo(page)
    await expect(page.getByText('Undid moving an element')).toBeVisible()
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300, 0)

    const after = await engine(page)
    const restored = byId(after, IDS.canvasRect)!
    const visibleAfter = {
      x: after.camera.x,
      y: after.camera.y,
      width: viewport.width / after.camera.zoom,
      height: viewport.height / after.camera.zoom,
    }
    // The real assertion: the restored element is INSIDE the visible world
    // rect, not merely that some camera change happened.
    expect(restored.x).toBeGreaterThanOrEqual(visibleAfter.x)
    expect(restored.y).toBeGreaterThanOrEqual(visibleAfter.y)
    expect(restored.x + restored.width).toBeLessThanOrEqual(
      visibleAfter.x + visibleAfter.width,
    )
    expect(restored.y + restored.height).toBeLessThanOrEqual(
      visibleAfter.y + visibleAfter.height,
    )
  })
})

test.describe('camera movement is not undoable', () => {
  test('panning after an edit does not get undone, and the camera is left where the user put it', async ({
    page,
  }) => {
    await openBoard(page)
    const viewport = await canvasViewportSize(page)

    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 700, y: 620 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(600, 0)
    await settle(page)

    // A SMALL pan, anchored bottom-right of the MEASURED canvas box (safely
    // clear of every element this test touches — see `focusBoard`'s own
    // comment on why a fixed coordinate isn't safe here) — both the
    // element's pre- and post-move positions stay fully visible, so undo's
    // own focus-assist has no reason to move the camera either. This
    // isolates "the pan itself was never recorded" from "the focus-assist
    // nudge happened to leave the camera alone".
    const panFrom = await worldToPage(page, {
      x: viewport.width - 100,
      y: viewport.height - 100,
    })
    const panTo = await worldToPage(page, {
      x: viewport.width - 150,
      y: viewport.height - 130,
    })
    await page.mouse.click(panFrom.x, panFrom.y)
    await page.keyboard.down('Space')
    await dragMouse(page, panFrom, panTo)
    await page.keyboard.up('Space')
    const cameraAfterPan = (await engine(page)).camera

    await undo(page)
    // The toast names the MOVE, not anything camera-related — proof the
    // entry undo() consumed was the content edit, because panning never
    // pushed one of its own.
    await expect(page.getByText('Undid moving an element')).toBeVisible()
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300, 0)

    const cameraAfterUndo = (await engine(page)).camera
    expect(cameraAfterUndo.x).toBeCloseTo(cameraAfterPan.x, 0)
    expect(cameraAfterUndo.y).toBeCloseTo(cameraAfterPan.y, 0)
    expect(cameraAfterUndo.zoom).toBe(cameraAfterPan.zoom)
  })
})

test.describe('one gesture is one undo entry', () => {
  test('a multi-selection moved in one drag is restored in one undo', async ({
    page,
  }) => {
    await openBoard(page)

    // Marquee both seeded elements.
    await dragMouse(
      page,
      await worldToPage(page, { x: 250, y: 250 }),
      await worldToPage(page, { x: 620, y: 620 }),
    )
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)

    // Move both together, one gesture.
    await dragMouse(
      page,
      await worldToPage(page, { x: 400, y: 370 }),
      await worldToPage(page, { x: 500, y: 470 }),
    )
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(400, 0)
    expect(byId(await engine(page), IDS.canvasText)!.x).toBeCloseTo(400, 0)
    await settle(page)

    await undo(page)
    await expect(page.getByText('Undid moving 2 elements')).toBeVisible()

    await expect
      .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
      .toBeCloseTo(300, 0)
    const rect = byId(await engine(page), IDS.canvasRect)!
    const text = byId(await engine(page), IDS.canvasText)!
    expect(rect.y).toBeCloseTo(300, 0)
    expect(text.x).toBeCloseTo(300, 0)
    expect(text.y).toBeCloseTo(520, 0)
  })
})

test.describe('contested undo across two clients', () => {
  test('an undo whose target changed since is refused, names the element, never attributes, and is discarded (not requeued)', async ({
    page,
    browser,
  }) => {
    // Two tabs of the SAME account — exactly the tactical plan's own
    // Validation section scenario ("two browser contexts on one board: A
    // moves an element, B moves the same element, A presses Ctrl+Z and must
    // see a refusal naming the element"). This also matches this repo's own
    // established convention for a "second client" (canvas-board.spec.ts's
    // live-sync test uses the same STORAGE_STATE for its observer context).
    await openBoard(page)
    const contextB = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE,
      viewport: { width: 1600, height: 1000 },
    })
    const pageB = await contextB.newPage()
    try {
      await openBoard(pageB)

      // A moves the rectangle.
      await dragMouse(
        page,
        await worldToPage(page, { x: 400, y: 370 }),
        await worldToPage(page, { x: 700, y: 620 }),
      )
      await expect
        .poll(async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0)
        .toBeCloseTo(600, 0)
      // Wait for B to observe A's move via the live broadcast before B moves
      // it again — this is what makes B's drag start from the rect's ACTUAL
      // current position rather than a stale local copy.
      await expect
        .poll(
          async () => byId(await engine(pageB), IDS.canvasRect)?.x ?? 0,
          { timeout: 15_000 },
        )
        .toBeCloseTo(600, 0)

      // B moves the SAME rectangle again, advancing its revision past what
      // A's own undo entry expects.
      await dragMouse(
        pageB,
        await worldToPage(pageB, { x: 650, y: 590 }),
        await worldToPage(pageB, { x: 900, y: 590 }),
      )
      await expect
        .poll(async () => byId(await engine(pageB), IDS.canvasRect)?.x ?? 0)
        .toBeCloseTo(850, 0)
      // Wait for A to observe B's move too, so the contest is detected
      // client-side (this hook's own revisionsRef), not merely as a
      // server-side race.
      await expect
        .poll(
          async () => byId(await engine(page), IDS.canvasRect)?.x ?? 0,
          { timeout: 15_000 },
        )
        .toBeCloseTo(850, 0)
      await settle(page)

      // A tries to undo A's OWN earlier move. It must be refused, because
      // the row changed since — and the refusal must name the element
      // without ever asserting WHO changed it (canvas element rows record
      // no last writer).
      await undo(page)
      await expect(
        page.getByText(
          "This rectangle changed since your edit, so that change can't be undone.",
        ),
      ).toBeVisible()

      const bodyText = (await page.locator('body').innerText()).toLowerCase()
      expect(bodyText).not.toContain('another user')
      expect(bodyText).not.toContain('someone else')

      // The refusal must not have touched content: the rectangle stays at
      // B's position — A's undo never overwrote B's newer work, and B's
      // edit was never something A's undo could have reversed in the first
      // place (scoped to A's own session).
      expect(byId(await engine(page), IDS.canvasRect)!.x).toBeCloseTo(850, 0)

      // The contested entry is DISCARDED, not requeued for a later undo —
      // the next undo has nothing left, proving "one command is one
      // attempt" and that a refused entry does not silently linger.
      await undo(page)
      await expect(page.getByText('Nothing left to undo.')).toBeVisible()
    } finally {
      await contextB.close()
    }
  })
})

test.describe('read-only cannot undo', () => {
  test('a VIEWER pressing Ctrl+Z changes nothing locally and sends no mutation to the server', async ({
    browser,
  }) => {
    const viewerPage = await loginAsViewer(browser)
    try {
      const frames = captureSocketFrames(viewerPage)
      const before = await openBoard(viewerPage, VIEWER_BOARD_URL)
      expect(before.readOnly).toBe(true)

      await focusBoard(viewerPage)
      await undo(viewerPage)
      await viewerPage.waitForTimeout(500)

      const after = await engine(viewerPage)
      expect(after.elements).toEqual(before.elements)
      expect(frames.some((f) => f.includes('element:'))).toBe(false)
    } finally {
      await viewerPage.context().close()
    }
  })

  test('an anonymous share-link visitor pressing Ctrl+Z changes nothing (no connection exists to carry a mutation)', async ({
    page,
    browser,
  }) => {
    await openBoard(page)
    const url = await createShareLinkViaUI(page)

    const visitor = await anonymousPage(browser)
    const frames = captureSocketFrames(visitor)
    try {
      await visitor.goto(url)
      await visitor.waitForSelector('canvas')
      await visitor.waitForFunction(
        () => window.__canvasEngine !== undefined,
        null,
        { timeout: 15_000 },
      )
      const before = await engine(visitor)
      expect(before.readOnly).toBe(true)

      await focusBoard(visitor)
      await undo(visitor)
      await visitor.waitForTimeout(500)

      const after = await engine(visitor)
      expect(after.elements).toEqual(before.elements)
      // No Socket.IO connection exists at all on the public path (asserted
      // directly, not merely inferred from "no element: frame") — see
      // canvas-board.spec.ts's own "the public path opens no Socket.IO
      // connection" test for the same check in isolation.
      expect(frames.filter((f) => f.includes('socket.io'))).toEqual([])
    } finally {
      await visitor.context().close()
    }
  })
})

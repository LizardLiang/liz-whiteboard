// e2e/canvas-handle-visibility.spec.ts
// Regression coverage for the reported bug: the per-column drag-to-connect
// handle dots are invisible in canvas mode. Drag-to-connect still WORKS —
// the DOM `<Handle>` elements (ColumnHandles.tsx) are intact and this
// canvas is `pointer-events-none`, so hit-testing passes straight through
// to them — but CanvasNodeLayer paints an OPAQUE table body above the
// chrome-light DOM row (z-[4] vs the node's own z=1 stacking context), so
// the DOM `.column-row:hover > .react-flow__handle...::before` CSS reveal
// rule (react-flow-theme.css) can never show through, no matter its
// z-index — that z-index is scoped inside the occluded node's own stacking
// context. Users see no way to start a connection and conclude the feature
// was removed.
//
// Fix: CanvasNodeLayer now paints the same dot ON THE CANVAS, keyed off its
// existing `hoveredKey` hover state (CanvasNodeLayer.tsx) — plus a "safe
// corridor" (the classic hoverable-submenu triangle technique) that keeps a
// SINGLE dot (and the real DOM handle underneath it) alive while the cursor
// transits from the row out to the dot itself, which sits entirely OUTSIDE
// the row's own box. Without the corridor, the row's hitbox clears the
// instant the cursor leaves its rectangle — before it reaches the dot —
// hiding the target exactly as the user arrives, and permanently stranding
// the real DOM handle at `pointer-events: none` (it can only turn
// interactive while `.column-row:hover` is genuinely true, which requires
// the cursor to literally be within the row's box).
//
// This spec asserts SIX halves of the fix:
//  1. The canvas actually paints the dot pixels on row hover (and clears
//     them again on unhover) — read directly from CanvasNodeLayer's own
//     <canvas> via getImageData, at the EXACT position ColumnHandles.tsx's
//     inline style places the real DOM handle (`left: '-14px'` /
//     `right: '-14px'`, row-vertical-centered) — the same geometry
//     CanvasNodeLayer.tsx's draw loop uses, so this test would fail if the
//     canvas paint ever drifts from the DOM handle position.
//  2. The safe corridor: the dot survives the cursor's transit from the row
//     out to it — including a DIAGONAL approach that exits through the
//     row's TOP edge rather than its side edge — and disappears immediately
//     if the cursor moves away instead of toward it.
//  3. The underlying affordance is actually reachable end-to-end: a real
//     drag from a source column handle to another table's column handle
//     creates a relationship, which persists across reload.
//  4. Regression guard (user-reported): arming a handle for hit-testing
//     (CanvasNodeLayer.tsx lifts `content-visibility` narrowly so the
//     protruding handle is reachable — see its doc comment) must NOT
//     change the table node's own box dimensions, and must NOT expose its
//     hover-highlight/selection box-shadow ring as a stray "second table"
//     outline — both were confirmed root causes of "i feels like you
//     overlapped two table on each other".
//  5. During an active connection drag from a table column handle, the
//     canvas paints target-handle dots on the OTHER table's columns
//     WITHOUT the cursor ever hovering them individually (previously
//     deferred requirement, confirmed a real gap: "for the target i need
//     to actually hover it once so that the connectable handle start to
//     display").
//  6. FR-016 (shape-origin suppression) is implemented in
//     `isConnectingFromTable` (CanvasNodeLayer.tsx: `c.fromNode.type !==
//     'shape'`) but is NOT e2e-verifiable here — commit 0a32df8 ("hide
//     shapes and connectors from the ERD view", same day) retired shapes
//     from this route entirely; no shape node can ever render inside this
//     canvas to originate such a drag. Left as a code-level guard only;
//     documented rather than faked with a test that cannot exercise it.
//
// No live Socket.IO broadcast is asserted (`io` is null in the dev Vite
// process — same limitation documented in e2e/canvas-comments.spec.ts);
// persistence is checked via reload.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { HEADER_H, ROW_H, getViewportScale, tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.handleVisWhiteboard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-handle-visibility.ts'], {
    stdio: 'inherit',
  })
})

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: 'E2E Handle Visibility' }),
  ).toBeVisible()
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
  await expect(tableNode(page, 'orders').first()).toBeVisible()
}

/** Screen-space point inside column row `rowIndex` on table `tableName`,
 * `xFraction` of the way across its width (0 = left edge, 1 = right edge) —
 * genuinely inside the row's own DOM box (unlike the handle dot itself,
 * which sits 14px OUTSIDE it and is `pointer-events: none` until the row is
 * hovered — see react-flow-theme.css's `.column-row:hover >
 * .react-flow__handle.source...` rule). Moving the real mouse here is what
 * a real user does to reveal the handle; moving straight to the handle's
 * own (currently non-interactive) position would never trigger the row's
 * `:hover` in the first place. `xFraction` matters for which side the
 * safe-corridor commits to on exit (CanvasNodeLayer.tsx picks left/right by
 * comparing the exit point to the row's horizontal center) — 0.5 (row
 * center) is fine when the test doesn't care which side, but a directed
 * approach (e.g. toward the right-side handle) should bias toward that
 * side, exactly as a real user's cursor would already be doing by the time
 * it leaves the row. */
async function columnRowPoint(
  page: Page,
  tableName: string,
  rowIndex: number,
  xFraction = 0.5,
) {
  const box = (await tableNode(page, tableName).first().boundingBox())!
  const zoom = await getViewportScale(page)
  return {
    x: box.x + box.width * xFraction,
    y: box.y + (HEADER_H + rowIndex * ROW_H + ROW_H / 2) * zoom,
    top: box.y + (HEADER_H + rowIndex * ROW_H) * zoom,
    zoom,
  }
}

/** Screen-space center of the handle dot itself (side `left`/`right`) —
 * same geometry `handleDotAlpha` below reads pixels at, and the exact
 * position ColumnHandles.tsx's real DOM handle sits at. */
async function dotScreenPos(
  page: Page,
  tableName: string,
  rowIndex: number,
  side: 'left' | 'right',
) {
  const box = (await tableNode(page, tableName).first().boundingBox())!
  const zoom = await getViewportScale(page)
  return {
    x: side === 'left' ? box.x - 14 * zoom : box.x + box.width + 14 * zoom,
    y: box.y + (HEADER_H + rowIndex * ROW_H + ROW_H / 2) * zoom,
  }
}

/** Alpha channel (0-255) of the pixel CanvasNodeLayer's own <canvas> paints
 * at the exact spot ColumnHandles.tsx's real DOM handle sits — computed
 * from the table's live boundingClientRect + the current zoom, matching
 * CanvasNodeLayer.tsx's draw-loop geometry exactly (`x - 14` / `x + w + 14`,
 * row-vertical-centered). 0 = nothing painted there (transparent); a value
 * near 255 = the handle dot's opaque fill/border. Runs entirely inside
 * `page.evaluate` so both rects come from the SAME frame (no Node/browser
 * coordinate-space mismatch). */
async function handleDotAlpha(
  page: Page,
  tableName: string,
  rowIndex: number,
  side: 'left' | 'right',
): Promise<number> {
  const zoom = await getViewportScale(page)
  return page.evaluate(
    (args) => {
      const tableEl = document.querySelector(args.tableSelector)
      const canvasEl = document.querySelector(
        '[data-testid="canvas-node-layer"]',
      )
      if (!tableEl || !(canvasEl instanceof HTMLCanvasElement)) return -1
      const tableRect = tableEl.getBoundingClientRect()
      const canvasRect = canvasEl.getBoundingClientRect()
      const rowCenterY =
        tableRect.top +
        (args.headerH + args.rowIndex * args.rowH + args.rowH / 2) *
          args.zoom
      const handleX =
        args.side === 'left'
          ? tableRect.left - 14 * args.zoom
          : tableRect.right + 14 * args.zoom
      const dpr = window.devicePixelRatio || 1
      const px = Math.round((handleX - canvasRect.left) * dpr)
      const py = Math.round((rowCenterY - canvasRect.top) * dpr)
      if (px < 0 || py < 0 || px >= canvasEl.width || py >= canvasEl.height) {
        return -2
      }
      const ctx = canvasEl.getContext('2d')
      if (!ctx) return -1
      return ctx.getImageData(px, py, 1, 1).data[3]
    },
    {
      tableSelector: `[data-table-name="${tableName}"]`,
      rowIndex,
      side,
      zoom,
      headerH: HEADER_H,
      rowH: ROW_H,
    },
  )
}

test.describe('Canvas drag-to-connect handle visibility (bug fix)', () => {
  test('hovering a column row paints the handle dots on the canvas, and unhovering clears them', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Baseline, no hover: nothing painted at either handle position — this
    // is the RED state the bug report describes (before this fix, hovering
    // never painted anything here either, so this spec would still fail at
    // the post-hover assertion below).
    expect(await handleDotAlpha(page, 'users', 0, 'left')).toBe(0)
    expect(await handleDotAlpha(page, 'users', 0, 'right')).toBe(0)

    // Move the real mouse into the row's own box (NOT onto the handle,
    // which is non-interactive/invisible until this hover fires) — mirrors
    // a real user moving their cursor over a table row.
    const center = await columnRowPoint(page, 'users', 0)
    await page.mouse.move(center.x, center.y)
    await page.mouse.move(center.x, center.y)

    // Both source handles (left AND right — react-flow-theme.css's
    // `.column-row:hover` rule does not discriminate by side) are now
    // painted opaque.
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'left'), { timeout: 3_000 })
      .toBeGreaterThan(200)
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'right'), {
        timeout: 3_000,
      })
      .toBeGreaterThan(200)

    // Move away — the dots disappear again (not a stray permanent paint).
    await page.mouse.move(60, 60)
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'left'), { timeout: 3_000 })
      .toBe(0)
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'right'), {
        timeout: 3_000,
      })
      .toBe(0)
  })

  test('a real drag from a source handle to another table column creates a relationship that persists across reload', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Handle IDs — format `{tableId}__{columnId}__{side}__{type}`
    // (createColumnHandleId, src/lib/react-flow/edge-routing.ts). Not
    // imported from `@/lib/...` — Playwright's Node runner does not resolve
    // this repo's app path aliases (same convention as canvas-helpers.ts's
    // own HEADER_H/ROW_H/PAD_X, hand-duplicated there for the same reason).
    const sourceHandleId = `${IDS.handleVisUsersTable}__${IDS.handleVisUsersId}__right__source`
    const targetHandleId = `${IDS.handleVisOrdersTable}__${IDS.handleVisOrdersUserId}__left__target`

    const sourceHandle = page.locator(`[data-handleid="${sourceHandleId}"]`)
    const targetHandle = page.locator(`[data-handleid="${targetHandleId}"]`)
    await expect(sourceHandle).toHaveCount(1)
    await expect(targetHandle).toHaveCount(1)

    // Step 1 — hover `users`'s row so its SOURCE handle becomes
    // interactive (`pointer-events: all` only applies under
    // `.column-row:hover` — see react-flow-theme.css). Moving straight to
    // the handle's own (still `pointer-events: none`) position first would
    // hit-test through to the pane, not the handle. Biased toward the RIGHT
    // edge (xFraction 0.85, not the row's dead center) so the safe corridor
    // commits to the correct side once the cursor leaves — same as a real
    // user's cursor, already headed rightward toward that handle.
    const usersRowPoint = await columnRowPoint(page, 'users', 0, 0.85)
    await page.mouse.move(usersRowPoint.x, usersRowPoint.y)
    await page.mouse.move(usersRowPoint.x, usersRowPoint.y)

    // Step 2 — move onto the handle's own position, OUTSIDE the row's own
    // box. The safe corridor (CanvasNodeLayer.tsx) commits to the RIGHT
    // side on this exit (Step 1's 0.85 bias) and, landing exactly on the
    // dot's center, is immediately within its "arrived" radius — arming the
    // real DOM handle (`.handle-armed`, react-flow-theme.css) even though
    // native `:hover` no longer covers this point.
    const sourceBox = (await sourceHandle.boundingBox())!
    const sourceCenter = {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    }
    await page.mouse.move(sourceCenter.x, sourceCenter.y)
    await page.mouse.move(sourceCenter.x, sourceCenter.y)
    await page.mouse.down()

    // Step 3 — drag toward `orders`'s target handle. Target handles become
    // droppable everywhere as soon as `.is-connecting` is set (independent
    // of that row's own hover — react-flow-theme.css's `.is-connecting
    // .react-flow__handle.target...` rule), so no separate row-hover step
    // is needed on the target side.
    const targetBox = (await targetHandle.boundingBox())!
    const targetCenter = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height / 2,
    }
    const midX = (sourceCenter.x + targetCenter.x) / 2
    const midY = (sourceCenter.y + targetCenter.y) / 2
    await page.mouse.move(midX, midY, { steps: 10 })
    await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 })
    await page.mouse.move(targetCenter.x, targetCenter.y)
    await page.mouse.up()

    // FR-017 flow: dropping a valid table-to-table column connection opens
    // the cardinality picker rather than creating the relationship
    // immediately (ReactFlowWhiteboard.tsx's `handleConnect`).
    await expect(
      page.getByRole('heading', { name: 'Set Relationship Cardinality' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Create' }).click()

    // A new relationship edge now exists.
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    // Persists — proves the DB row was actually created, not just local
    // React Flow state (Playwright's Node runner cannot open bun:sqlite to
    // check directly).
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Handle Visibility' }),
    ).toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  })

  test('the safe corridor keeps the dot alive through a diagonal transit, and hides it when the cursor moves away instead', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // --- Diagonal transit: exit through the row's TOP edge, not its side
    // edge, while still generally heading toward the RIGHT-side dot.
    const rowPoint = await columnRowPoint(page, 'users', 0, 0.85)
    const dot = await dotScreenPos(page, 'users', 0, 'right')

    await page.mouse.move(rowPoint.x, rowPoint.y)
    await page.mouse.move(rowPoint.x, rowPoint.y)
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'right'), {
        timeout: 3_000,
      })
      .toBeGreaterThan(200)

    // A point ABOVE the row's own top edge (exiting vertically, not
    // sideways) but roughly between the row and the dot horizontally — the
    // "diagonal exit" the corridor's flared wedge exists to tolerate.
    const diagonalX = (rowPoint.x + dot.x) / 2
    const diagonalY = rowPoint.top - 8
    await page.mouse.move(diagonalX, diagonalY)

    // Still armed — the row's own rect no longer covers this point (it's
    // above the row), so this only holds if the corridor, not plain
    // row-hover, is keeping it alive.
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'right'), {
        timeout: 3_000,
      })
      .toBeGreaterThan(200)
    // The LEFT dot was never targeted by this corridor — it stays hidden
    // throughout, proving this is a single-side arm, not a fallback to
    // "reveal the whole row".
    expect(await handleDotAlpha(page, 'users', 0, 'left')).toBe(0)

    // Complete the transit onto the dot itself — still armed ("arrived").
    await page.mouse.move(dot.x, dot.y)
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'right'), {
        timeout: 3_000,
      })
      .toBeGreaterThan(200)

    // The real DOM handle underneath is armed too (not just the canvas
    // paint) — `.handle-armed` is the JS-toggled twin of `.column-row:hover
    // > .react-flow__handle...` (react-flow-theme.css) that keeps the
    // actual hit target interactive through the corridor.
    const sourceHandleId = `${IDS.handleVisUsersTable}__${IDS.handleVisUsersId}__right__source`
    await expect(
      page.locator(`[data-handleid="${sourceHandleId}"].handle-armed`),
    ).toHaveCount(1)

    // --- Moving away (not toward the dot) hides it immediately — no grace
    // period, no timeout wait needed to observe the disarm.
    await page.mouse.move(diagonalX, diagonalY)
    await page.mouse.move(60, 60)
    await expect
      .poll(() => handleDotAlpha(page, 'users', 0, 'right'), {
        timeout: 3_000,
      })
      .toBe(0)
    await expect(
      page.locator(`[data-handleid="${sourceHandleId}"].handle-armed`),
    ).toHaveCount(0)
  })

  test('arming a handle does not change the table node\'s box dimensions or expose a duplicate-looking box-shadow ring (regression: "overlapped two tables")', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const nodeSelector = '[data-table-name="users"]'
    const before = await page.locator(nodeSelector).first().evaluate((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return { w: r.width, h: r.height, x: r.left, y: r.top, boxShadow: s.boxShadow }
    })

    const usersRowPoint = await columnRowPoint(page, 'users', 0, 0.85)
    await page.mouse.move(usersRowPoint.x, usersRowPoint.y)
    await page.mouse.move(usersRowPoint.x, usersRowPoint.y)
    const dot = await dotScreenPos(page, 'users', 0, 'right')
    await page.mouse.move(dot.x, dot.y)
    await page.mouse.move(dot.x, dot.y)

    // Confirm the handle actually armed (content-visibility lifted) before
    // asserting on its side effects — otherwise this test would trivially
    // pass by testing nothing.
    await expect(page.locator(`${nodeSelector}.content-visibility-armed`)).toHaveCount(1)

    const after = await page.locator(nodeSelector).first().evaluate((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return { w: r.width, h: r.height, x: r.left, y: r.top, boxShadow: s.boxShadow }
    })

    // No layout change (Defect 1 hypothesis (a) — confirmed NOT the actual
    // cause, but guarded here anyway since it would be an equally bad
    // regression).
    expect(after.w).toBeCloseTo(before.w, 1)
    expect(after.h).toBeCloseTo(before.h, 1)
    expect(after.x).toBeCloseTo(before.x, 1)
    expect(after.y).toBeCloseTo(before.y, 1)

    // No stray box-shadow ring — the confirmed actual cause. The hover-
    // highlight/selected ring pattern is a ZERO-offset spread (`0px 0px Npx`
    // var(--rf-edge-stroke-selected)); the table's own normal card shadow
    // (`0 1px 3px 0 ...`, non-zero vertical offset) is fine and expected.
    expect(after.boxShadow).not.toMatch(/0px 0px [12]px/)
  })

  test('during an active connection drag from a table column handle, the canvas paints target dots on the OTHER table without hovering them, and clears them when the drag ends without a drop', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Baseline — nothing painted on `orders` before any drag starts.
    expect(await handleDotAlpha(page, 'orders', 0, 'left')).toBe(0)
    expect(await handleDotAlpha(page, 'orders', 0, 'right')).toBe(0)

    const usersRowPoint = await columnRowPoint(page, 'users', 0, 0.85)
    await page.mouse.move(usersRowPoint.x, usersRowPoint.y)
    await page.mouse.move(usersRowPoint.x, usersRowPoint.y)
    const sourceDot = await dotScreenPos(page, 'users', 0, 'right')
    await page.mouse.move(sourceDot.x, sourceDot.y)
    await page.mouse.move(sourceDot.x, sourceDot.y)
    await page.mouse.down()

    // Move into open canvas space — nowhere NEAR `orders`, well short of
    // hovering it — to prove the reveal is NOT tied to hovering the target.
    await page.mouse.move(sourceDot.x + 80, sourceDot.y, { steps: 10 })

    // Both of `orders`' target handles for its one column are now visible,
    // unhovered — requirement 2's whole point (previously the user had to
    // "hover it once" for the dot to appear at all).
    await expect
      .poll(() => handleDotAlpha(page, 'orders', 0, 'left'), { timeout: 3_000 })
      .toBeGreaterThan(200)
    await expect
      .poll(() => handleDotAlpha(page, 'orders', 0, 'right'), {
        timeout: 3_000,
      })
      .toBeGreaterThan(200)

    // Releasing over empty space cancels the connection (no valid drop
    // target under the cursor) — the target reveal must clear with it, not
    // linger as a stray permanent paint.
    await page.mouse.up()
    await expect
      .poll(() => handleDotAlpha(page, 'orders', 0, 'left'), { timeout: 3_000 })
      .toBe(0)
    await expect
      .poll(() => handleDotAlpha(page, 'orders', 0, 'right'), {
        timeout: 3_000,
      })
      .toBe(0)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
  })
})

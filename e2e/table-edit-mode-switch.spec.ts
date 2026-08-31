// e2e/table-edit-mode-switch.spec.ts
// Regression coverage for LizMeter #53: "table edit mode gets stuck in read
// mode when switching edit mode from one table to another."
//
// Root cause (fixed, tactical plan
// .claude/.Arena/tactical-plans/2026-08-31-table-edit-mode-stuck-in-read-mode-after-switching-tables.md):
// double-clicking table A then table B while A is still in edit mode did not
// move edit mode to B. A React re-render between B's first click's mousedown
// and its own click event unmounts the `.column-row` the mousedown landed
// on; the browser retargets the resulting click/dblclick to
// `div.react-flow__nodes`. Two consequences follow from one retargeted
// event: B's `onDoubleClick` never fires (stuck in read mode), and the
// retargeted `dblclick` reaches React Flow's own pane, which still had its
// default `zoomOnDoubleClick` behavior — triggering an unwanted 2x zoom+pan
// that threw the previously-overlaid table off-screen ("two tables
// overlapping"). A second, independent defect: closing a column's inline
// editor with an UNCHANGED value still committed and wrote to the database,
// broadcasting a no-op `column:update` to every collaborator.
//
// Critical implementation rule (per the tactical plan's explicit caveat):
// double-clicks in this file MUST be driven with Playwright's real
// `locator.dblclick()` (two genuine mouse-down/up pairs with real timing),
// never `element.dispatchEvent('dblclick', ...)`. The synthetic single-event
// dispatch this repo's other canvas specs use does not reproduce the
// retargeting bug — there is no intervening `mousedown` for a re-render to
// race against.
//
// Reuses the shared "E2E ERD" board (IDS.whiteboard/usersTable/ordersTable) —
// the exact board the bug was reproduced on — and the default project's
// STORAGE_STATE (no extra login). Both tests are non-destructive: they leave
// the shared board's table/column names and zoom exactly as they found them,
// since other specs read this same board. The `afterEach` cleanup hook below
// is the guaranteed-restore safety net for the second test's rename, in
// case the test body fails partway through (see that hook's comment).
import { expect, test } from '@playwright/test'
import { getViewportScale, tableNode } from './canvas-helpers'
import { IDS } from './fixtures'

test.use({ viewport: { width: 1720, height: 1000 } })

test.afterEach(async ({ page }) => {
  // Guaranteed cleanup (user-approved amendment on top of the tactical
  // plan): the second test below renames the shared board's users.email
  // column to 'email_tmp' and restores it inline as its own happy-path last
  // step. That inline restore is only safe when the test body runs to
  // completion — if it fails or throws between the rename and the restore,
  // the SHARED "E2E ERD" board would be left with a column literally named
  // 'email_tmp', breaking every other spec that reads that board until
  // someone manually reseeds.
  //
  // This hook runs after EVERY test in this file (pass, fail, or timeout)
  // and force-restores users.email through the same UI/server path the test
  // itself uses (double-click table -> double-click column -> commit
  // 'email') rather than touching the database directly — Playwright's
  // Node runner cannot open bun:sqlite anyway. It is idempotent: a fresh
  // page load first checks whether the column is already named 'email' (the
  // overwhelmingly common case, and always true after the first test, which
  // never touches this column at all) and no-ops if so, so it is always
  // safe to run regardless of run order or prior state.
  //
  // Double-clicks in THIS hook are dispatched directly (`dispatchEvent`)
  // rather than a real `locator.dblclick()` — unlike the test bodies above,
  // this hook is not exercising the retargeting fix (no intervening
  // mousedown needed for correctness: a synthetic dblclick still fires the
  // kept-in-place native `onDoubleClick` handler, see the tactical plan's
  // Blast Radius section), so it can use the same hit-testing-proof
  // technique canvas-edit-overlay.spec.ts's `dblclickTable`/`clickEmptyPane`
  // helpers already establish in this repo — real mouse movement across the
  // board risks landing on the shared board's own area-container node
  // (rendered above a table whenever `rf-hover-highlighted` bumps its
  // z-index), which a cleanup hook must not depend on being avoidable.
  await page.goto(`/whiteboard/${IDS.whiteboard}`)
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
  // Close any overlay a failed test body may have left open before we
  // start our own fresh interaction.
  await page.keyboard.press('Escape')

  await tableNode(page, 'users').dispatchEvent('dblclick', {
    bubbles: true,
    cancelable: true,
  })
  // Wait for the overlay to actually mount before inspecting its contents —
  // `dispatchEvent` returns as soon as the DOM event handler runs, not once
  // React has committed the resulting re-render, so an immediate `.count()`
  // below would race the overlay's mount and false-negative "nothing to
  // restore".
  await expect(page.locator('.table-header')).toHaveCount(1)
  const staleEmail = tableNode(page, 'users').getByText('email_tmp', {
    exact: true,
  })
  if ((await staleEmail.count()) === 0) {
    // Already 'email' (or this test never touched the column) — nothing to
    // restore.
    await page.keyboard.press('Escape')
    return
  }

  await staleEmail.dispatchEvent('dblclick', {
    bubbles: true,
    cancelable: true,
  })
  const nameInput = page.locator('.table-columns input[type="text"]')
  await expect(nameInput).toBeVisible()
  await nameInput.fill('email')
  await nameInput.press('Enter')
  await expect(
    tableNode(page, 'users').getByText('email', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
})

test('double-clicking table B while table A is being edited moves the overlay to B and does not change zoom', async ({
  page,
}) => {
  await page.goto(`/whiteboard/${IDS.whiteboard}`)
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()

  const zoomBefore = await getViewportScale(page)

  await tableNode(page, 'users').dblclick()
  await expect(page.locator('.table-header')).toHaveCount(1)
  await expect(tableNode(page, 'users')).not.toHaveAttribute(
    'data-testid',
    'table-node-chrome-light',
  )
  expect(await getViewportScale(page)).toBeCloseTo(zoomBefore, 5)

  await tableNode(page, 'orders').dblclick()

  // The core "not stuck in read mode" assertion: exactly one overlay, and it moved.
  await expect(page.locator('.table-header')).toHaveCount(1)
  await expect(tableNode(page, 'orders')).not.toHaveAttribute(
    'data-testid',
    'table-node-chrome-light',
  )
  await expect(tableNode(page, 'users')).toHaveAttribute(
    'data-testid',
    'table-node-chrome-light',
  )

  // The core anti-zoom-regression assertion.
  expect(await getViewportScale(page)).toBeCloseTo(zoomBefore, 5)

  await page.keyboard.press('Escape') // restore board to pristine (no overlay open)
  await expect(page.locator('.table-header')).toHaveCount(0)
})

test('committing an unchanged column value sends no column:update; a real rename still does, and is reverted', async ({
  page,
}) => {
  const updateFrames: Array<string> = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      if (
        typeof frame.payload === 'string' &&
        frame.payload.includes('"column:update"')
      ) {
        updateFrames.push(frame.payload)
      }
    })
  })

  await page.goto(`/whiteboard/${IDS.whiteboard}`)
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()

  await tableNode(page, 'users').dblclick()
  await tableNode(page, 'users').getByText('email', { exact: true }).dblclick()
  const nameInput = page.locator('.table-columns input[type="text"]')
  await expect(nameInput).toBeVisible()

  // Real rename (positive control — proves the WS-frame capture actually works).
  await nameInput.fill('email_tmp')
  await nameInput.press('Enter')
  await expect(tableNode(page, 'users').getByText('email_tmp')).toBeVisible()
  expect(updateFrames.filter((f) => f.includes('email_tmp'))).toHaveLength(1)

  // Reopen, don't change anything, exit via the forced-blur-on-exit path
  // (pane click) — this is the exact path the DB check caught.
  await tableNode(page, 'users')
    .getByText('email_tmp', { exact: true })
    .dblclick()
  await expect(nameInput).toBeVisible()
  const framesBeforeNoop = updateFrames.length
  // Dispatched directly on `.react-flow__pane` rather than a coordinate-
  // based Playwright `.click()` (mirrors canvas-edit-overlay.spec.ts's
  // `clickEmptyPane` helper) — a fixed corner offset is unreliable on this
  // board: the shape-drawing toolbar ("Add subject area" etc.) floats at
  // `left-4 top-4`, intercepting a literal (20, 20) click. Dispatching the
  // event straight on the pane element sidesteps hit-testing entirely, and
  // `event.target` is the pane itself either way, which is all React Flow's
  // `onPaneClick` needs.
  await page
    .locator('.react-flow__pane')
    .dispatchEvent('click', { bubbles: true, cancelable: true })
  await expect(page.locator('.table-header')).toHaveCount(0)
  expect(updateFrames.length).toBe(framesBeforeNoop) // no new frame for the unchanged commit

  // Restore the original name so the shared board is left as found (happy
  // path — the afterEach hook above is the guaranteed fallback if anything
  // above this point throws).
  await tableNode(page, 'users').dblclick()
  await tableNode(page, 'users')
    .getByText('email_tmp', { exact: true })
    .dblclick()
  await nameInput.fill('email')
  await nameInput.press('Enter')
  await expect(
    tableNode(page, 'users').getByText('email', { exact: true }),
  ).toBeVisible()
  expect(updateFrames.filter((f) => f.includes('"email"'))).toHaveLength(1)
  await page.keyboard.press('Escape')
})

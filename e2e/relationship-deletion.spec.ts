// e2e/relationship-deletion.spec.ts
// Regression coverage for the reported bug: "select a relation line, press
// Delete, the line goes — then move a table it was attached to and the line
// is back."
//
// Root cause (fixed): ReactFlowCanvas's `onEdgesDelete` only routed CONNECTOR
// edges to a mutation. A relationship edge was removed from React Flow's own
// store and nothing else — no socket emit, so the row survived in SQLite.
// ReactFlowCanvas then re-derives its edges from `initialEdges` on every
// `initialNodes` change, and a table drag produces exactly that (the position
// persist patches the ['whiteboard', id] cache → the `nodes` memo → the
// `initialNodes` prop), so the "deleted" line came straight back.
//
// The load-bearing assertion is therefore NOT "the line disappears" — that
// passed before the fix too. It is that the line stays gone ACROSS a table
// drag, and across a reload (the reload is what proves the database row is
// actually gone, since Playwright's Node runner cannot open bun:sqlite).
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.relDelWhiteboard}`
const EDGE = `.react-flow__edge[data-id="${IDS.relDelRelationship}"]`

// Every test here deletes the seeded relationship, so it has to be restored
// before the next one — a suite-level seed would leave the later tests with no
// line to delete. seed-relationship.ts touches only this board (never "User"),
// so re-running it cannot invalidate the storageState session.
test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-relationship.ts'], { stdio: 'inherit' })
})

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: 'E2E Relation Delete' }),
  ).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
  await expect(tableNode(page, 'orders').first()).toBeVisible()
  await expect(page.locator(EDGE)).toHaveCount(1)
  // Let the board settle before touching it. ReactFlowCanvas rebuilds its
  // whole edge array from `initialEdges` on every `initialNodes` change, and
  // that rebuild drops the `selected` flag (the parent's copy never carries
  // one). While the opening data fetches are still landing those rebuilds
  // keep firing, so an edge selected too early is silently deselected a beat
  // later — which made both the keyboard and the button case flake.
  await page.waitForLoadState('networkidle')
  // Wait until the board is actually CONNECTED. Relationship writes travel
  // over the whiteboard Socket.IO connection, which comes up after the board
  // mounts; until it does, ConnectionStatusIndicator shows a banner and
  // useRelationshipMutations correctly refuses the write. Acting before this
  // clears tests a state in which the app has already told the user their
  // change will not sync — not the behaviour these tests are about.
  await expect(
    page.getByText(/^(Reconnecting|Disconnected) —/),
  ).toHaveCount(0)
}

/**
 * Click a point that genuinely lies ON the edge's stroke, and confirm the
 * click actually selected it.
 *
 * Two traps, both hit while writing this spec:
 *
 * 1. `locator.click()` targets an element's bounding-box centre, which for a
 *    curved SVG path is empty space — the click falls through to the pane and
 *    deselects instead of selecting. Walk the real path geometry instead.
 * 2. The path MIDPOINT is the one place not to click: RelationshipEdge renders
 *    its label and its delete button there, in an EdgeLabelRenderer portal
 *    that sits above the stroke. Whether they swallow the click depends on
 *    label width vs zoom, which made a midpoint click pass locally and flake
 *    under Playwright's 1600x1000 viewport. Quarter points are clear of it.
 */
async function selectEdge(page: Page, root = '') {
  const selector = `${root}${EDGE}`
  // The `<g class="react-flow__edge">` wrapper is in the DOM one render
  // BEFORE the stroke inside it, so `toHaveCount(1)` on the wrapper is not
  // enough to start measuring geometry — wait for the drawn path itself.
  // (`react-flow__edge-path` is the addressable one: the edge also carries an
  // unclassed interaction halo and two short cardinality-marker paths.)
  const strokeSelector = `${selector} path.react-flow__edge-path`
  await page.locator(strokeSelector).first().waitFor({ state: 'attached' })

  for (const fraction of [0.25, 0.75, 0.15]) {
    const point = await page.evaluate(
      ({ sel, frac }) => {
        const path = document.querySelector<SVGPathElement>(sel)
        if (!path) return null
        const svg = path.ownerSVGElement
        const ctm = path.getScreenCTM()
        if (!svg || !ctm) return null
        const at = path.getPointAtLength(path.getTotalLength() * frac)
        const p = svg.createSVGPoint()
        p.x = at.x
        p.y = at.y
        const screen = p.matrixTransform(ctm)
        return { x: screen.x, y: screen.y }
      },
      { sel: strokeSelector, frac: fraction },
    )
    if (!point) throw new Error(`could not resolve a point on ${strokeSelector}`)
    await page.mouse.click(point.x, point.y)
    // Retrying assertion, NOT a synchronous classList read: the click and
    // React's commit of the resulting selection are separate ticks, so a
    // plain read here returns the PRE-click value and sends the loop on to
    // the next fraction — whose click then lands on the pane and undoes the
    // selection the previous one had just made.
    try {
      await expect(page.locator(selector)).toHaveClass(/selected/, {
        timeout: 2_000,
      })
      return
    } catch {
      // Try the next point along the path.
    }
  }
  throw new Error(`clicking ${selector} never selected it`)
}

/** TanStack Start server-fn URLs are `/_serverFn/<base64url(JSON)>` naming the
 * source file + export. Decode it so `waitForResponse` targets the exact
 * single-table position persist — matching any POST risks resolving on an
 * unrelated server-fn call (session checks fire around a drag too). Excludes
 * `updateTablePositionsBulk`, the multi-select drag's separate export. */
function isPositionPersistUrl(url: string): boolean {
  const marker = '/_serverFn/'
  const idx = url.indexOf(marker)
  if (idx === -1) return false
  const encoded = url.slice(idx + marker.length).split(/[?#]/)[0]
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8')
    return (
      decoded.includes('updateTablePosition') &&
      !decoded.includes('updateTablePositionsBulk')
    )
  } catch {
    return false
  }
}

/**
 * Drag `orders` and WAIT for the position to persist. The wait is
 * load-bearing, not tidiness: the resurrection was driven by the persist
 * response patching the query cache, which is what regenerates `initialNodes`
 * and re-runs the edge resync. Returning before that lands would let this
 * test pass without ever exercising the code path it exists to guard.
 */
async function dragOrdersTable(page: Page) {
  const box = (await tableNode(page, 'orders').first().boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + 12 // header strip — the drag handle
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 90, startY + 70, { steps: 10 })
  const persisted = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' && isPositionPersistUrl(res.url()),
    { timeout: 10_000 },
  )
  await page.mouse.up()
  await persisted
}

test.describe('Relationship deletion', () => {
  test('Delete key removes the line for good — it does not return when a connected table is moved', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await selectEdge(page)
    await expect(page.locator(EDGE)).toHaveClass(/selected/)

    await page.keyboard.press('Delete')
    await expect(page.locator(EDGE)).toHaveCount(0)

    // The regression itself. Before the fix the line reappeared here.
    await dragOrdersTable(page)
    await expect(page.locator(EDGE)).toHaveCount(0)

    // Proves the DB row is gone rather than only the local edge state — a
    // pre-fix Delete left the row intact, so a reload brought the line back.
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Relation Delete' }),
    ).toBeVisible()
    await expect(tableNode(page, 'orders').first()).toBeVisible()
    await expect(page.locator(EDGE)).toHaveCount(0)
  })

  test('the edge delete button still persists — the Delete key now shares its path', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Selecting the edge reveals its delete button (opacity/pointerEvents
    // gated in RelationshipEdge.tsx). This path already worked before the
    // fix; it is asserted here because the Delete key was routed INTO it, so
    // a break in this one mutation would now take both affordances down
    // together rather than just this one.
    await selectEdge(page)
    await page.getByRole('button', { name: 'Delete relationship' }).click()
    await expect(page.locator(EDGE)).toHaveCount(0)

    await dragOrdersTable(page)
    await expect(page.locator(EDGE)).toHaveCount(0)

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Relation Delete' }),
    ).toBeVisible()
    await expect(page.locator(EDGE)).toHaveCount(0)
  })

  test('Delete is inert inside the read-only Focus view — it cannot phantom-remove a line', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // TableFocusOverlay mounts its own nested ReactFlowCanvas with no delete
    // handler. Without the `onBeforeDelete` veto, Delete there would strip the
    // edge from the dialog's local state while persisting nothing — the same
    // false success this fix removes from the main canvas.
    await tableNode(page, 'orders').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Focus view' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const dialogEdge = dialog.locator(EDGE)
    await expect(dialogEdge).toHaveCount(1)

    await selectEdge(page, '[role="dialog"] ')
    await page.keyboard.press('Delete')

    // The line must still be there — the veto refused a delete that could not
    // reach the server.
    await expect(dialogEdge).toHaveCount(1)

    // Reload rather than closing the dialog first: ReactFlowCanvas installs a
    // document-level Escape handler that consumes the keypress before Radix's
    // dismiss layer sees it, and the overlay exposes no other close control
    // this spec can address. A reload proves the stronger property anyway —
    // nothing was persisted behind the dialog's back — and leaves exactly one
    // canvas rendering the edge, so this count is unambiguous (with the
    // dialog open, both canvases carry a node with the same `data-id`).
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Relation Delete' }),
    ).toBeVisible()
    await expect(page.locator(EDGE)).toHaveCount(1)
  })

  // 2026-08-31 tactical plan (#54): the edge's single delete button now
  // reads Trash2, never X — clearing a LABEL happens by emptying its text,
  // which is now the ONLY way to clear a label (#52's original X-clears-
  // label control was cancelled). Nothing guarded this path before. The
  // seed relationship carries the label 'belongs to' (seed-relationship.ts).
  test('emptying the label text clears the label and leaves the line — the only remaining way to clear a label', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const label = page.getByText('belongs to', { exact: true })
    await expect(label).toBeVisible()

    await label.dblclick()
    // Locator-scoped `.press()` (not `page.keyboard.press()`) focuses the
    // input itself before sending each key, closing the race where the
    // React state update that mounts the edit `<input>` hasn't landed yet —
    // same guard canvas-edit-overlay.spec.ts uses around its name editor.
    const labelInput = page.locator('input.nodrag.nopan')
    await expect(labelInput).toBeVisible()
    await labelInput.press('Control+A')
    await labelInput.press('Delete')
    await labelInput.press('Enter')

    // Label is gone; the line itself is untouched.
    await expect(page.getByText('belongs to', { exact: true })).toHaveCount(0)
    await expect(page.locator(EDGE)).toHaveCount(1)

    // Survives a table drag (the same resurrection-style regression Part A
    // guards deletion against — a stale/cached label must not come back).
    await dragOrdersTable(page)
    await expect(page.getByText('belongs to', { exact: true })).toHaveCount(0)
    await expect(page.locator(EDGE)).toHaveCount(1)

    // Survives a reload — proves the empty string was actually persisted to
    // the database, not just removed from local state.
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'E2E Relation Delete' }),
    ).toBeVisible()
    await expect(page.locator(EDGE)).toHaveCount(1)
    await expect(page.getByText('belongs to', { exact: true })).toHaveCount(0)
  })
})

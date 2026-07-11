// e2e/canvas-edit-overlay.spec.ts
// Functional e2e for the canvas-node-rendering migration's Phase 3
// ("In-place DOM edit overlay") — see
// .claude/.Arena/tactical-plans/canvas-edit-overlay-phase3.md. Phase 1 (DOM
// strip) is covered by e2e/canvas-rendering.spec.ts; this spec covers what
// Phase 3 adds on top of it: double-clicking a canvas-drawn (chrome-light)
// table mounts the real, full-DOM TableNode for exactly that one table in
// place, reusing every existing editor, while the canvas skips drawing it.
//
// Reuses the same stress-seed harness as canvas-rendering.spec.ts (own
// beforeAll re-seed — the suite runs with workers:1/fullyParallel:false, so
// re-seeding the shared stress whiteboard per spec file is safe/sequential,
// not a race). A smaller table count than the Phase 1 spec is enough here —
// these assertions only ever touch a handful of fixed table indices.
//
// Validates (tactical plan Validation section, (a)-(e)):
//  (a) double-clicking a column row mounts the full DOM table
//      (`.table-header` 0→1) with that column's editor open
//  (b) the edited column name persists after exit + reload
//  (c) single-click another table keeps the overlay open (still 1 header)
//  (d) pane-click / Escape / double-click-another each close/move it
//  (e) a viewer (no edit permission) double-clicking gets no overlay
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import {
  LOD_ZOOM_THRESHOLD,
  getViewportScale,
  zoomAboveLodThreshold,
  zoomBelowLodThreshold,
} from './canvas-helpers'
import { IDS } from './fixtures'
import type { Browser, Locator, Page } from '@playwright/test'

const STRESS_TABLE_COUNT = 12

const WB_URL = `/whiteboard/${IDS.stressWhiteboard}?canvas=1`
const PROJECT_URL = `/project/${IDS.project}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], {
    stdio: 'inherit',
    env: { ...process.env, STRESS_TABLE_COUNT: String(STRESS_TABLE_COUNT) },
  })
})

async function openStressWhiteboardCanvasMode(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: `E2E Stress (${STRESS_TABLE_COUNT})` }),
  ).toBeVisible()
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
}

// Below LOD_ZOOM_THRESHOLD (imported from ./canvas-helpers, single-sourced
// with canvas-rendering.spec.ts — Hermes review WARNING 2), TableNode's LOD
// collapse (GH #121) renders each column as a handles-only LodColumnRow
// instead of a full, editable ColumnRow. Real dense canvas-mode boards (the
// whole point of canvas mode) typically sit BELOW this threshold at their
// fitView zoom — a dogfood bug (tactical plan Phase 3) found the edit
// overlay's own full-DOM render still collapsed there too, since it reused
// this same LOD gate with no exemption for the table currently being
// edited: the overlay would mount (`.table-header` appeared) but every
// column row was empty (LodColumnRow renders only handles, no name/type
// text, no `<input>`), so the seeded editingField had no ColumnRow left to
// actually open. Fixed in TableNode.tsx by exempting
// `editingTableId === table.id` from the LOD collapse.

/** Chrome-light table nodes (canvas mode, not currently overlaid) — see
 * canvas-rendering.spec.ts's identical helper. */
function chromeLightNodes(page: Page): Locator {
  return page.locator('[data-testid="table-node-chrome-light"]')
}

/** The Nth column row within a chrome-light node — index 1 is always a
 * plain `field_1` column in the stress seed's shape (see
 * canvas-rendering.spec.ts's `columnHandle` comment for why). */
function chromeLightColumnRow(node: Locator, columnIndex: number): Locator {
  return node.locator('.column-row').nth(columnIndex)
}

/** Double-click a chrome-light row via a direct `dispatchEvent`, not a
 * coordinate-based Playwright `.dblclick()`. React Flow's edge layer
 * renders ABOVE nodes with a wide (`stroke-width: 20`) invisible hit-path
 * per edge, and on this densely connected stress board that hit-path can
 * be the actual topmost element at a row's on-screen center — a
 * coordinate click (even with `force: true`, which only skips Playwright's
 * own actionability checks, not real browser hit-testing) would then
 * genuinely land on the edge instead of the row. Dispatching the event
 * directly on the row element sidesteps hit-testing entirely — same
 * technique canvas-rendering.spec.ts uses to reach a `pointer-events: none`
 * handle underneath its own hover-reveal CSS. */
async function dblclickRow(row: Locator) {
  await row.dispatchEvent('dblclick', { bubbles: true, cancelable: true })
}

/** Double-click a chrome-light node's own wrapper (not a specific column
 * row) — the generic "open the overlay, no field pre-selected" entry point
 * (`onDoubleClick={canEdit ? () => requestEdit(table.id) : undefined}` on
 * the chrome-light wrapper div, TableNode.tsx). This is the ONLY
 * double-click target left below LOD_ZOOM_THRESHOLD once canvas-node-
 * rendering-migration Phase 4 collapses every column's handles onto a
 * single header row there (see this file's first test) — same direct-
 * `dispatchEvent` rationale as `dblclickRow` above. */
async function dblclickTable(node: Locator) {
  await node.dispatchEvent('dblclick', { bubbles: true, cancelable: true })
}

/** The single open inline-name editor input on the page — at most one
 * overlay (and one open field) exists at a time under this spec's flows. */
function openNameEditorInput(page: Page): Locator {
  return page.locator('.table-columns input[type="text"]')
}

/** A column's plain (non-editing) name text within the mounted overlay's
 * `.table-columns` — only present once the full-DOM `ColumnRow` is
 * rendering (chrome-light's `LodColumnRow`/collapsed header row never
 * render name text at all, only handles), so this doubles as proof the
 * overlay is showing REAL editable rows, not a collapsed shell. Manually
 * double-clicking it (`handleNameDoubleClick`, ColumnRow.tsx) is how a user
 * opens that one column's editor once the overlay is already open with no
 * field pre-selected (the generic `dblclickTable` entry point). */
function columnNameText(page: Page, name: string): Locator {
  return page.locator('.table-columns').getByText(name, { exact: true })
}

/** Empty-pane click that closes the edit overlay, dispatched directly on
 * `.react-flow__pane` rather than a coordinate-based Playwright `.click()`
 * (see `dblclickRow`'s comment above for the same rationale). A
 * coordinate click is unreliable on this densely connected stress board:
 * neither a fixed corner offset nor avoiding every `.react-flow__node`
 * bounding box is enough, since React Flow's edge layer draws wide
 * invisible hit-paths that can cross anywhere between two tables,
 * including near the pane's edges — dispatching the event straight on the
 * pane element sidesteps hit-testing entirely, and `event.target` is the
 * pane itself either way, which is all React Flow's `onPaneClick` needs. */
async function clickEmptyPane(page: Page) {
  await page
    .locator('.react-flow__pane')
    .dispatchEvent('click', { bubbles: true, cancelable: true })
}

test.describe('Canvas edit overlay — Phase 3 (in-place DOM edit overlay)', () => {
  test('double-clicking the table below LOD_ZOOM_THRESHOLD opens the overlay generically, a column can still be edited, and the edit persists after exit + reload', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    // Drive the board BELOW LOD_ZOOM_THRESHOLD before touching anything —
    // the realistic canvas-mode working zoom on a dense board, and the
    // exact condition the original dogfood bug needed (at a zoom above the
    // threshold this whole scenario passed even with that bug present).
    //
    // canvas-node-rendering-migration Phase 4 ("parity sweep") later made
    // this below-threshold collapse apply to the chrome-light DOM itself
    // (not just canvas), by design (locked decision, confirmed): every
    // column's handles now stack onto ONE header-height `.column-row`
    // instead of one row per column, mirroring showMode TABLE_NAME. That
    // removed the specific-column `.column-row` double-click TARGET this
    // test used to rely on below threshold — there is no longer a per-
    // column row to double-click there. The only double-click entry point
    // left below threshold is the chrome-light wrapper itself (generic
    // "open the overlay, no field pre-selected" — same as clicking the
    // table header/body above threshold). This test now exercises THAT
    // entry point, then opens a specific column's editor manually from
    // inside the mounted overlay (which — per the ORIGINAL Phase 3 fix
    // this test still protects — is exempt from LOD collapse once it's the
    // active overlay, so it always renders full, editable `ColumnRow`s
    // regardless of zoom). The direct "double-click column X to jump
    // straight into its editor" shortcut is covered separately below, at a
    // zoom ABOVE the threshold where a per-column chrome-light row still
    // exists to double-click.
    await zoomBelowLodThreshold(page)
    expect(await getViewportScale(page)).toBeLessThan(LOD_ZOOM_THRESHOLD)

    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT)
    await expect(page.locator('.table-header')).toHaveCount(0)

    const targetNode = chromeLightNodes(page).nth(5)
    await dblclickTable(targetNode)

    // The full DOM table mounted (0→1) and the canvas skipped it.
    await expect(page.locator('.table-header')).toHaveCount(1)
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT - 1)

    // The overlay is showing REAL, editable `ColumnRow`s — not a collapsed
    // shell — proven by the column's plain name TEXT being present at all
    // (chrome-light's `LodColumnRow`/collapsed header row never render name
    // text, only handles). This is the exact assertion the original
    // dogfood bug broke: below LOD_ZOOM_THRESHOLD, the overlay table's own
    // columns used to still collapse to handles-only `LodColumnRow` (no
    // name/type text, no `<input>` anywhere in the node) with no exemption
    // for the active overlay table.
    await expect(columnNameText(page, 'field_1')).toBeVisible()

    // No field is pre-selected by this generic entry point (the wrapper's
    // `onDoubleClick` calls `requestEdit(table.id)` with no columnId) — the
    // editor only opens once the user double-clicks that column's name text
    // manually, same as any full-DOM table's normal editing flow
    // (ColumnRow.tsx's `handleNameDoubleClick`).
    await expect(openNameEditorInput(page)).toHaveCount(0)
    await columnNameText(page, 'field_1').dispatchEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    })
    const nameInput = openNameEditorInput(page)
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue('field_1')

    // Commit a rename via the real InlineNameEditor Enter-to-commit path.
    await nameInput.fill('field_1_edited')
    await nameInput.press('Enter')
    await expect(columnNameText(page, 'field_1_edited')).toBeVisible()

    // Exit via empty-pane click (locked decision #2).
    await clickEmptyPane(page)
    await expect(page.locator('.table-header')).toHaveCount(0)
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT)

    // Reload and re-open the same column: the rename round-tripped through
    // the real column-update mutation, not just local state. Zoom resets on
    // reload (fitView re-runs), so re-drive it below threshold before
    // re-opening — otherwise this second open would pass even with the
    // original bug present, same as the pre-strengthening version of this
    // spec did.
    await page.reload()
    await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
    await zoomBelowLodThreshold(page)
    const reloadedNode = chromeLightNodes(page).nth(5)
    await dblclickTable(reloadedNode)
    await expect(columnNameText(page, 'field_1_edited')).toBeVisible()
    await columnNameText(page, 'field_1_edited').dispatchEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    })
    await expect(openNameEditorInput(page)).toHaveValue('field_1_edited')
  })

  test('double-clicking a specific column row above LOD_ZOOM_THRESHOLD still opens that column\'s editor directly', async ({
    page,
  }) => {
    // Complements the test above: above the threshold, a chrome-light node
    // still renders one `.column-row` per column (canvas-node-rendering-
    // migration Phase 4's collapse only applies BELOW LOD_ZOOM_THRESHOLD),
    // so the original direct "double-click column X to jump straight into
    // its editor, pre-filled, in one step" shortcut this test used to cover
    // below threshold is still fully available here.
    await openStressWhiteboardCanvasMode(page)
    await zoomAboveLodThreshold(page)
    expect(await getViewportScale(page)).toBeGreaterThanOrEqual(
      LOD_ZOOM_THRESHOLD,
    )

    const targetNode = chromeLightNodes(page).nth(6)
    await dblclickRow(chromeLightColumnRow(targetNode, 1))

    await expect(page.locator('.table-header')).toHaveCount(1)
    const nameInput = openNameEditorInput(page)
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue('field_1')
  })

  test('single-clicking another table keeps the overlay open', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    await dblclickRow(chromeLightColumnRow(chromeLightNodes(page).nth(2), 1))
    await expect(page.locator('.table-header')).toHaveCount(1)

    // A plain single click on a DIFFERENT table selects it but must NOT
    // close the overlay (locked decision #2 — selecting keeps editing).
    // Dispatched directly (see `dblclickRow`'s comment) for the same
    // edge-hit-path-occlusion reason.
    await chromeLightNodes(page)
      .nth(3)
      .dispatchEvent('click', { bubbles: true, cancelable: true })
    await expect(page.locator('.table-header')).toHaveCount(1)
  })

  test('pane-click, Escape, and double-click-another each close or move the overlay', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    // (d) sub-case 1: empty-pane click closes it.
    await dblclickRow(chromeLightColumnRow(chromeLightNodes(page).nth(6), 1))
    await expect(page.locator('.table-header')).toHaveCount(1)
    await clickEmptyPane(page)
    await expect(page.locator('.table-header')).toHaveCount(0)

    // (d) sub-case 2: Escape closes it.
    await dblclickRow(chromeLightColumnRow(chromeLightNodes(page).nth(7), 1))
    await expect(page.locator('.table-header')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.table-header')).toHaveCount(0)

    // (d) sub-case 3: double-clicking a DIFFERENT table's column moves the
    // overlay there instead of stacking a second one — still exactly one
    // `.table-header`, and table 8 (the one that lost the overlay) is back
    // to chrome-light.
    await dblclickRow(chromeLightColumnRow(chromeLightNodes(page).nth(8), 1))
    await expect(page.locator('.table-header')).toHaveCount(1)
    await dblclickRow(chromeLightColumnRow(chromeLightNodes(page).nth(9), 1))
    await expect(page.locator('.table-header')).toHaveCount(1)
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT - 1)
    await expect(chromeLightNodes(page).nth(8)).toBeVisible()
  })

  test('Escape closes a nested Radix layer (data-type selector) without closing the overlay; a second, unconsumed Escape then closes it', async ({
    page,
  }) => {
    // Code review defect 1 (BLOCKER). Radix's DismissableLayer (backing
    // DataTypeSelector — a real shadcn Popover+Command, not a hand-rolled
    // dropdown) registers a capture-phase Escape handler that calls
    // `preventDefault()` to dismiss its own layer, but never
    // `stopPropagation()`. Before the fix, ReactFlowCanvas's document-level
    // Escape listener had no way to tell "a nested layer already handled
    // this" from "nothing did" — so the SAME Escape press that closed the
    // data-type selector also tore down the whole edit overlay underneath
    // it. The fix guards that listener on `!e.defaultPrevented`.
    await openStressWhiteboardCanvasMode(page)

    await dblclickTable(chromeLightNodes(page).nth(10))
    await expect(page.locator('.table-header')).toHaveCount(1)

    // Open the data-type selector on the table's primary key column ('id',
    // always seeded as 'UUID') from inside the mounted overlay.
    const dataTypeText = page
      .locator('.table-columns .column-row')
      .first()
      .getByText('UUID', { exact: true })
    await dataTypeText.dispatchEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    })
    const searchInput = page.getByPlaceholder('Search types...')
    await expect(searchInput).toBeVisible()

    // First Escape: Radix's DismissableLayer consumes it — closes only the
    // nested selector. The overlay itself must stay mounted (defect 1 fix;
    // without it this Escape would ALSO have closed `.table-header`).
    await page.keyboard.press('Escape')
    await expect(searchInput).toHaveCount(0)
    await expect(page.locator('.table-header')).toHaveCount(1)

    // Second Escape: nothing left to consume it — this one legitimately
    // closes the overlay (locked decision #2 still holds).
    await page.keyboard.press('Escape')
    await expect(page.locator('.table-header')).toHaveCount(0)
  })
})

/** Open the project page and its Share panel (ADMIN-only trigger) — mirrors
 * share-links.spec.ts's identical helper. */
async function openSharePanel(page: Page) {
  await page.goto(PROJECT_URL)
  await expect(
    page.getByRole('heading', { name: 'E2E Project' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(
    page.getByRole('heading', { name: 'Share Project' }),
  ).toBeVisible()
}

/** Create a read-only share link for the stress whiteboard (NOT "E2E ERD"
 * — that board is seeded once per whole suite run by global-setup and
 * never reset between spec files, so a share link created against it here
 * would permanently leave a second "Revoke E2E ERD share link" row for the
 * rest of the run, breaking share-links.spec.ts's own single-link
 * assumption. The stress board is re-seeded — wipe + recreate, which
 * cascades away any WhiteboardShareLink row via its FK — at the top of
 * every canvas/perf spec's own `beforeAll`, so a link left here is
 * self-cleaning and never leaks into another spec file). */
async function createShareLink(page: Page): Promise<string> {
  await page.getByRole('combobox', { name: 'Select whiteboard' }).click()
  await page
    .getByRole('option', { name: `E2E Stress (${STRESS_TABLE_COUNT})` })
    .click()

  const create = page.getByRole('button', {
    name: 'Create read-only share link',
  })
  await expect(create).toBeEnabled()
  await create.click()

  const linkInput = page.getByRole('textbox', { name: 'Share link' })
  await expect(linkInput).toBeVisible()
  const url = await linkInput.inputValue()
  expect(url).toContain('/share/')
  return url
}

/** A fresh, cookie-less context — a real logged-out public visitor, same as
 * share-links.spec.ts's identical helper. */
async function anonPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  return context.newPage()
}

test.describe('Canvas edit overlay — viewer permission gate', () => {
  test('a read-only viewer double-clicking a table gets no overlay', async ({
    page,
    browser,
  }) => {
    await openSharePanel(page)
    const shareUrl = await createShareLink(page)

    // The public share path renders with viewerRole=null → canEdit=false
    // (ReactFlowWhiteboard.tsx), but still opts into canvas mode via
    // `?canvas=1` (enableEdgeAblation is unconditional there) — exactly the
    // "viewer under canvas mode" case locked decision #5 gates.
    const visitor = await anonPage(browser)
    await visitor.goto(`${shareUrl}?canvas=1`)
    await expect(visitor.getByTestId('canvas-node-layer')).toBeVisible()

    const node = visitor.locator('[data-testid="table-node-chrome-light"]')
    await expect(node.first()).toBeVisible()

    // Header/body double-click — a viewer gets no onDoubleClick handler at
    // all, so this is a no-op: no overlay mounts. Dispatched directly (see
    // `dblclickRow`'s comment above) rather than a coordinate click.
    await node
      .first()
      .dispatchEvent('dblclick', { bubbles: true, cancelable: true })
    await expect(visitor.locator('.table-header')).toHaveCount(0)

    await visitor.context().close()

    // Tidy up the panel (not strictly required for isolation — see
    // createShareLink's comment on why the stress board's share links are
    // already self-cleaning — but leaves no dangling "active" link either
    // way).
    await page
      .getByRole('button', {
        name: `Revoke E2E Stress (${STRESS_TABLE_COUNT}) share link`,
      })
      .click()
    await expect(
      page
        .getByRole('list', { name: 'Outstanding read-only links' })
        .getByText('Revoked'),
    ).toBeVisible()
  })
})

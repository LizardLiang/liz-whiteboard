// e2e/cross-file-reference.spec.ts
// End-to-end coverage for the cross-file table reference (LizMeter #83).
//
// Two seeded boards in one project: "E2E Ref Local" holds the reference node,
// "E2E Ref Billing" owns the `orders` table it points at. Auth comes from
// global-setup (storageState); the boards come from e2e/seed-table-reference.ts.
//
// ONE test, walked end to end, on purpose. The reference this suite creates is
// the subject of every later assertion, and `beforeAll` re-seeds the boards —
// splitting the walk into separate tests would either wipe the reference
// between them or make each test depend on the last one's leftovers.
//
// Assertions never read table names off the board: ERD tables are drawn into a
// <canvas> (canvas-mode rendering is unconditional on the main board), so their
// text is not in the DOM. Reference nodes ARE real DOM — they render through
// their own React Flow node type — which is what makes them addressable here.
//
// Every assertion traces to a spec-delta scenario in
// .claude/feature/2026-09-09-erd-cross-file-table-reference-node/spec-delta/erd-cross-file-references.md:
//   - "Picker excludes the current file" / "Table list follows the chosen file"
//     / "Column list follows the chosen table"
//   - "Node shows its source file"
//   - "Reference is findable" (Cmd+K, labelled with its file)
//   - "Double-click jumps and focuses" / "Shortcut jumps and focuses"
//
// Not covered here, and deliberately: the VIEWER gate (proved by the Toolbar
// unit test and the route's own tests — the e2e user is the project OWNER, and
// logging a second user in would buy nothing), and the drag gesture (HTML5
// drag-and-drop with a custom MIME is the one interaction Playwright cannot
// dispatch faithfully; the click path runs the identical picker and mutation).
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'

test.use({ viewport: { width: 1600, height: 1000 } })

// Playwright's runner is Node and cannot open bun:sqlite, so the seed is
// shelled out to Bun — the same pattern every other suite here uses.
test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-table-reference.ts'], {
    stdio: 'inherit',
  })
})

const LOCAL_BOARD = `/whiteboard/${IDS.trLocalWhiteboard}`
const SOURCE_BOARD = `/whiteboard/${IDS.trSourceWhiteboard}`

test('reference another file’s table, then follow it back to its source', async ({
  page,
}) => {
  const referenceNode = page.locator('[data-testid^="external-table-node-"]')

  await page.goto(LOCAL_BOARD)
  // The Reference item is EDITOR-gated, so its presence also proves the gate
  // let this user through.
  const referenceTool = page.getByTestId('add-reference-tool')
  await expect(referenceTool).toBeEnabled()
  await expect(referenceNode).toHaveCount(0)

  // ── Pick: file → table → column ────────────────────────────────────────────
  await referenceTool.click()

  const picker = page.getByRole('dialog')
  // The file list offers the OTHER board of this project, never the board we
  // are standing on.
  await expect(picker.getByText('E2E Ref Billing')).toBeVisible()
  await expect(picker.getByText('E2E Ref Local')).toHaveCount(0)
  await picker.getByText('E2E Ref Billing').click()

  // The table list follows the chosen file.
  await expect(picker.getByText('orders')).toBeVisible()
  await picker.getByText('orders').click()

  // The column list follows the chosen table.
  await expect(picker.getByText('customer_id')).toBeVisible()
  await picker.getByText('id', { exact: true }).click()
  await picker.getByRole('button', { name: /add reference/i }).click()

  // ── The node renders, naming the file its table really lives in ────────────
  await expect(referenceNode).toBeVisible()
  await expect(referenceNode).toContainText('E2E Ref Billing')
  await expect(referenceNode).toContainText('orders')
  await expect(referenceNode).toHaveAttribute('data-missing', 'false')

  // ── It survives a reload, so it is really persisted ────────────────────────
  await page.reload()
  await expect(referenceNode).toBeVisible()

  // ── It is findable, labelled with the file the real table lives in ─────────
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByPlaceholder(/search tables and columns/i).fill('orders')
  await expect(page.getByText(/in E2E Ref Billing/).first()).toBeVisible()
  await page.keyboard.press('Escape')

  // Fit the board before interacting with the node: it was placed at the
  // viewport centre in FLOW coordinates, and the reload's fitView leaves the
  // canvas wherever the whole diagram fits — which at this board's zoom can be
  // off-screen. Fitting is what a person does here too.
  await page.getByTitle('Fit to Screen').click()

  // ── `g` on the selected node jumps to the source, focused on that table ────
  await referenceNode.click()
  await page.keyboard.press('g')
  await page.waitForURL(
    (url) =>
      url.pathname === SOURCE_BOARD &&
      url.searchParams.get('focusTable') === IDS.trOrdersTable,
  )

  // ── Double-click does the same thing ───────────────────────────────────────
  await page.goBack()
  await expect(referenceNode).toBeVisible()
  await page.getByTitle('Fit to Screen').click()
  await referenceNode.dblclick()
  await page.waitForURL(
    (url) =>
      url.pathname === SOURCE_BOARD &&
      url.searchParams.get('focusTable') === IDS.trOrdersTable,
  )
})

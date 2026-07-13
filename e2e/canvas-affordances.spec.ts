// e2e/canvas-affordances.spec.ts
// End-to-end coverage for canvas table affordances (note / comment /
// relations) — see .claude/.Arena/tactical-plans/canvas-table-affordances.md.
// Canvas is now the default render path (canvas-node-rendering-migration
// Phase 5), which strips tables to chrome-light DOM (header/columns painted
// on <canvas>, no in-node buttons — CanvasNodeLayer paints OVER them, so
// in-node DOM buttons would be invisible). This spec restores the note/
// comment affordances via the chosen model: canvas-drawn indicator glyphs
// (visibility, NOT e2e-testable — pixels, see the tactical plan's Validation
// section for the required visual check) + a right-click context menu
// (action, fully e2e-testable — this file).
//
// Reuses the same stress-seed harness as canvas-edit-overlay.spec.ts (own
// beforeAll re-seed — the suite runs with workers:1/fullyParallel:false, so
// re-seeding the shared stress whiteboard per spec file is safe/sequential,
// not a race). Every stress table is seeded with a note (`Stress fixture
// table N` — see e2e/seed-stress.ts's insertTable call), so the Note menu
// item's popover has real content to assert without an extra setup step.
//
// Real-time broadcast is NOT asserted here: Socket.IO's `io` is null in the
// dev Vite process, so comment:created no-ops for peers in dev (same
// limitation noted in e2e/canvas-comments.spec.ts). Persistence is verified
// via reload, not the live broadcast.
//
// Validates (tactical plan Validation section, (a)-(d)):
//  (a) right-click a chrome-light table → the menu shows Note (editor) +
//      Comment
//  (b) choosing Comment opens the comment popover WITHOUT the full
//      `.table-header` mounting (stays 0 — proves no edit-mode entry)
//  (c) a comment persists after close + reload
//  (d) a viewer sees Comment but not Note in the menu; opening Note is not
//      offered at all (no edit-mode entry point for it either)
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { E2E_VIEWER_USER, IDS } from './fixtures'
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'

const STRESS_TABLE_COUNT = 12

const WB_URL = `/whiteboard/${IDS.stressWhiteboard}?canvas=1`

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

/** Chrome-light table nodes (canvas mode, not currently overlaid) — same
 * helper as canvas-edit-overlay.spec.ts. */
function chromeLightNodes(page: Page): Locator {
  return page.locator('[data-testid="table-node-chrome-light"]')
}

/** Right-click a chrome-light node via a direct `dispatchEvent`, not a
 * coordinate-based Playwright `.click({ button: 'right' })`. Same rationale
 * as canvas-edit-overlay.spec.ts's `dblclickRow`/`dblclickTable` helpers:
 * React Flow's edge layer renders ABOVE nodes with a wide invisible hit-path
 * per edge, which on this densely connected stress board can be the actual
 * topmost element at a node's on-screen center — dispatching the event
 * directly on the node element sidesteps hit-testing entirely. */
async function rightClickTable(node: Locator) {
  await node.dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
}

function noteMenuItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: 'Note', exact: true })
}

function commentMenuItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: 'Comment', exact: true })
}

test.describe('Canvas table affordances — context menu (tactical plan: canvas-table-affordances)', () => {
  test('right-click shows Note + Comment for an editor; opening Note shows the seeded note WITHOUT mounting the edit overlay', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    const targetNode = chromeLightNodes(page).nth(4)
    await rightClickTable(targetNode)

    // (a) — both items present for an editor (the seeded e2e user is the
    // project ADMIN — see e2e/seed-stress.ts).
    await expect(noteMenuItem(page)).toBeVisible()
    await expect(commentMenuItem(page)).toBeVisible()

    await noteMenuItem(page).click()

    // A seeded note (`Stress fixture table N` — every stress table gets one,
    // see e2e/seed-stress.ts's insertTable call) is pre-filled — proves the
    // SAME TableNotePopover/handleTableNoteSave the full-DOM header uses is
    // reused, not a stub. Asserted by pattern, not a specific N: React
    // Flow's internal nodeLookup Map iteration order (which CanvasNodeLayer
    // and the chrome-light DOM both render from) is not guaranteed to match
    // seed insertion order 1:1, so `nth(4)` above is not guaranteed to be
    // literally "table 4".
    const textarea = page.getByRole('textbox')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveValue(/^Stress fixture table \d+$/)

    // (b)/(d) — opening it did NOT enter edit mode: the table stays
    // canvas-drawn (no full-DOM `.table-header` mounted), unlike
    // double-clicking the table (canvas-edit-overlay.spec.ts), which does.
    await expect(page.locator('.table-header')).toHaveCount(0)
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT)

    await page.keyboard.press('Escape')
  })

  test('choosing Comment opens the popover without mounting the edit overlay, and a new comment persists after close + reload', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    const targetNode = chromeLightNodes(page).nth(5)
    await rightClickTable(targetNode)
    await commentMenuItem(page).click()

    // (b) — the comment popover opened (no seeded comments on this table
    // yet) WITHOUT the full-DOM edit overlay mounting.
    await expect(page.getByText('No comments yet.')).toBeVisible()
    await expect(page.locator('.table-header')).toHaveCount(0)
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT)

    // Create a comment through the SAME composer/handler the full-DOM
    // header's badge popover uses (onCreateTableComment).
    const body = 'Canvas-affordances e2e comment on stress_table_5.'
    await page.getByPlaceholder('Start a new thread...').fill(body)
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(page.getByText(body)).toBeVisible()

    await page.keyboard.press('Escape')

    // (c) — persists across reload (dev Socket.IO broadcast no-ops — see
    // file header note; persistence is checked via a fresh load).
    await page.reload()
    await expect(page.getByTestId('canvas-node-layer')).toBeVisible()

    const reloadedNode = chromeLightNodes(page).nth(5)
    await rightClickTable(reloadedNode)
    await commentMenuItem(page).click()
    await expect(page.getByText(body)).toBeVisible()
    await expect(page.locator('.table-header')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

/**
 * Log in as the seeded VIEWER-role project member (e2e/seed-stress.ts) via
 * the real /login form, mirroring global-setup.ts's login flow but scoped
 * to this one test (not the shared STORAGE_STATE, which is the ADMIN e2e
 * user). Deliberately NOT the public `/share/:token` path — that renders
 * with `viewerRole={null}` (share.$token.tsx), which gates BOTH `canEdit`
 * AND `canComment` to false and so cannot discriminate the "Comment is
 * viewer+, Note is editor+" permission split this test exists to prove. A
 * real authenticated `ProjectMember` with role `VIEWER` is the only way to
 * get `canComment=true` together with `canEdit=false`
 * (`hasMinimumRole` in src/lib/auth/permissions.ts).
 */
async function loginAsViewer(browser: Browser): Promise<Page> {
  const context: BrowserContext = await browser.newContext()
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

  // Wait for the session cookie rather than any redirect (see
  // global-setup.ts's identical rationale: the app's post-login client
  // redirect can bounce, so the cookie — not the URL — is the ground truth).
  const deadline = Date.now() + 15_000
  let authenticated = false
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (
      cookies.some((c) => c.name === 'session_token' && c.value.length > 0)
    ) {
      authenticated = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!authenticated) {
    throw new Error(
      'canvas-affordances e2e: session_token cookie was never set after viewer login',
    )
  }
  // Let the app's own post-login redirect settle before the caller issues
  // its own `page.goto` — login.tsx's success handler does a FULL
  // `window.location.assign('/')` (not a client-side router.navigate — see
  // that file's comment on why), which is a real, separate navigation that
  // can still be in flight once the session cookie appears. Racing a
  // `page.goto` against it aborts one of the two navigations
  // (net::ERR_ABORTED) — wait for the URL to actually leave /login first.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  })
  return page
}

test.describe('Canvas table affordances — viewer permission gate', () => {
  test('a VIEWER-role project member sees Comment but not Note in the context menu', async ({
    browser,
  }) => {
    const viewerPage = await loginAsViewer(browser)

    // Dedicated project/whiteboard (IDS.viewerProject/viewerWhiteboard, seeded
    // by e2e/seed-stress.ts) — NOT the shared stress board, which this VIEWER
    // user is not a member of (see IDS.viewerProject's fixtures.ts comment for
    // why a shared-project membership was reverted: it broke an unrelated
    // spec's Share panel layout).
    await viewerPage.goto(`/whiteboard/${IDS.viewerWhiteboard}?canvas=1`)
    await expect(
      viewerPage.getByRole('heading', { name: 'E2E Viewer Whiteboard' }),
    ).toBeVisible()
    await expect(viewerPage.getByTestId('canvas-node-layer')).toBeVisible()

    const node = chromeLightNodes(viewerPage).nth(0)
    await expect(node).toBeVisible()
    await rightClickTable(node)

    // (d) — Comment (viewer+, canComment=true for this VIEWER member) is
    // offered; Note (editor-only, canEdit=false for VIEWER) is not — same
    // gate the full-DOM header's TableNotePopover/CommentThreadPopover use.
    await expect(commentMenuItem(viewerPage)).toBeVisible()
    await expect(noteMenuItem(viewerPage)).toHaveCount(0)

    await viewerPage.keyboard.press('Escape')
    await viewerPage.context().close()
  })
})

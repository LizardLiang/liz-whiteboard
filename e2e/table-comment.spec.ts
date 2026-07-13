// e2e/table-comment.spec.ts
// End-to-end coverage for the table-level comment/note (table-comment): a
// free-text note editable via a StickyNote popover on the table header —
// reuses the existing DiagramTable.description column (no schema change) and
// the already-plumbed table:update/table:updated socket contract. Distinct
// from the GH #110 threaded comment pins (MessageCircle icon) covered in
// e2e/canvas-comments.spec.ts — this is a single free-text field per table,
// not a discussion thread.
//
// Real-time broadcast is NOT asserted here: Socket.IO's `io` is null in the
// dev Vite process (server fns run in a separate process from server.dev.ts),
// so the table:updated broadcast no-ops for peers in dev (same limitation
// noted in playwright.config.ts / canvas-comments.spec.ts). We assert
// persistence CORRECTNESS by reloading and re-reading the popover, which only
// depends on the initial whiteboard data load, not the live broadcast.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

// Canvas is unconditional (canvas-unconditional-default) — no `?canvas` opt
// out. A chrome-light table has no header DOM (no note/comment trigger
// buttons — CanvasNodeLayer paints over them), so this spec drives the
// canvas-native entry point instead: right-click → Note (TableNodeContextMenu,
// tactical plan: canvas-table-affordances) — same pattern as
// e2e/canvas-affordances.spec.ts, applied here against the seeded "users"
// table's real pre-existing note (rather than the stress-seed fixture).
const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

function usersTableNode(page: Page) {
  return tableNode(page, 'users').first()
}

async function rightClickTable(page: Page) {
  await usersTableNode(page).dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
  })
}

function noteMenuItem(page: Page) {
  return page.getByRole('menuitem', { name: 'Note', exact: true })
}

function commentMenuItem(page: Page) {
  return page.getByRole('menuitem', { name: 'Comment', exact: true })
}

test.describe('Table comment / note (table-comment)', () => {
  test('edit the table note, and it persists across reload', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // AC-2 — the seeded "users" table already has a description ("app
    // users" — see e2e/seed.ts). Open the popover via right-click → Note.
    await rightClickTable(page)
    await expect(noteMenuItem(page)).toBeVisible()
    await noteMenuItem(page).click()

    const textarea = page.getByRole('textbox')
    await expect(textarea).toHaveValue('app users')

    // AC-1 — edit the note.
    const newNote = 'Stores registered end-user accounts (e2e-edited).'
    await textarea.fill(newNote)

    // Debounced autosave (500ms) — wait past the debounce window before
    // closing, since there is no visible "saved" indicator to poll for.
    await page.waitForTimeout(800)
    await page.keyboard.press('Escape')

    // Persistence check via reload (dev Socket.IO broadcast no-ops — see
    // file header note).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(usersTableNode(page)).toBeVisible()

    await rightClickTable(page)
    await noteMenuItem(page).click()
    await expect(page.getByRole('textbox')).toHaveValue(newNote)
    await page.keyboard.press('Escape')
  })

  test('is distinct from the threaded comment (StickyNote Note vs MessageCircle Comment)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Both menu items coexist without colliding — the table note
    // (StickyNote) is a single free-text field; the threaded comment
    // (MessageCircle, GH #110) is a discussion. Asserting both are
    // independently present, and that each opens its OWN distinct popover,
    // guards against one implementation accidentally replacing or shadowing
    // the other.
    await rightClickTable(page)
    await expect(noteMenuItem(page)).toBeVisible()
    await expect(commentMenuItem(page)).toBeVisible()

    await noteMenuItem(page).click()
    // Distinctness only — Note opens a free-text field (don't assert the value:
    // the preceding "edit the table note" test mutates it, and these share one
    // seeded board with no per-test reset).
    await expect(page.getByRole('textbox')).toBeVisible()
    await page.keyboard.press('Escape')

    await rightClickTable(page)
    await commentMenuItem(page).click()
    // Assert the Comment popover's thread composer (present regardless of
    // existing threads) rather than the "No comments yet." empty state —
    // canvas-comments.spec.ts runs earlier on the SAME seeded board and leaves
    // a thread on `users`, so the empty state is order-fragile. The composer
    // placeholder is what makes this popover distinct from Note's textarea.
    await expect(page.getByPlaceholder('Start a new thread...')).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

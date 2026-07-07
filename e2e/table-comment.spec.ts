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
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
}

function usersTableNode(page: Page) {
  return page.locator('.react-flow__node').filter({ hasText: 'users' }).first()
}

test.describe('Table comment / note (table-comment)', () => {
  test('edit the table note, and it persists across reload', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const node = usersTableNode(page)

    // AC-2 — the seeded "users" table already has a description ("app
    // users" — see e2e/seed.ts), so the note trigger is tinted/visible
    // without needing to hover the header first (mirrors the always-visible
    // behavior of the unresolved-comment badge in canvas-comments.spec.ts).
    const noteTrigger = node.getByTestId('table-note-trigger')
    await expect(noteTrigger).toBeVisible()

    // Open the popover — pre-filled with the existing seeded note.
    await noteTrigger.click()
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
    await expect(
      page.locator('.react-flow').getByText('users', { exact: true }).first(),
    ).toBeVisible()

    const reopenedNode = usersTableNode(page)
    await expect(
      reopenedNode.getByTestId('table-note-trigger'),
    ).toBeVisible()
    await reopenedNode.getByTestId('table-note-trigger').click()
    await expect(page.getByRole('textbox')).toHaveValue(newNote)
    await page.keyboard.press('Escape')
  })

  test('is distinct from the threaded comment badge (StickyNote vs MessageCircle)', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const node = usersTableNode(page)
    // Both triggers coexist in the header without colliding — the table
    // note (StickyNote) is a single free-text field; the comment badge
    // (MessageCircle, GH #110) is a threaded discussion. Asserting both are
    // independently present/clickable guards against one implementation
    // accidentally replacing or shadowing the other.
    await expect(node.getByTestId('table-note-trigger')).toBeVisible()
    await expect(node.getByTestId('table-comment-trigger')).toBeVisible()
  })
})

// e2e/canvas-comments.spec.ts
// End-to-end coverage for canvas comments / annotations (GH #110): a
// table-anchored thread (create → reply → resolve) and a free-canvas-point
// pin, plus the header's unresolved-thread badge. Auth + seed data come from
// global-setup (storageState) — mirrors e2e/version-history.spec.ts.
//
// Real-time broadcast is NOT asserted here: Socket.IO's `io` is null in the
// dev Vite process (server fns run in a separate process from server.dev.ts),
// so `comment:created`/`comment:resolved` etc. no-op for peers in dev (see
// playwright.config.ts's note on the same limitation for version history).
// We assert CORRECTNESS by reloading and checking the thread/resolved state
// persisted server-side — that works regardless of the dev/prod broadcast
// split, since it only depends on the initial `getWhiteboardComments` load.
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

/** Opens the "users" table's comment popover via its header badge trigger. */
async function openUsersTableCommentPopover(page: Page) {
  await page
    .locator('.react-flow__node')
    .filter({ hasText: 'users' })
    .first()
    .getByTestId('table-comment-trigger')
    .click()
}

test.describe('Canvas comments / annotations (GH #110)', () => {
  test('table-anchored thread: create, reply, resolve, and persist across reload', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // AC — create a root thread anchored to the "users" table.
    await openUsersTableCommentPopover(page)
    await expect(page.getByText('No comments yet.')).toBeVisible()
    const newThreadBody = 'Should this table have a soft-delete flag?'
    await page.getByPlaceholder('Start a new thread...').fill(newThreadBody)
    // exact: true — "Comment" would otherwise substring-match the "Comments"
    // toolbar button, the "Add comment" placement tool, and other tables'
    // "Comment on <table>" badge triggers.
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(page.getByText(newThreadBody)).toBeVisible()

    // AC — reply to the thread.
    const replyBody = 'Agreed, adding deletedAt.'
    await page.getByPlaceholder('Reply...').fill(replyBody)
    await page.getByRole('button', { name: 'Reply' }).click()
    await expect(page.getByText(replyBody)).toBeVisible()

    // AC — resolve the thread. exact: true — non-exact "Resolve" would also
    // substring-match the trigger's "N unresolved comment on <table>"
    // aria-label ("unresolved" contains "resolve").
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Reopen', exact: true }),
    ).toBeVisible()

    // Close the popover, then reload — real-time broadcast no-ops in dev
    // (io is null in the Vite process), so persistence must be verified via
    // a fresh load, not the live peer echo.
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()

    await openUsersTableCommentPopover(page)
    await expect(page.getByText(newThreadBody)).toBeVisible()
    await expect(page.getByText(replyBody)).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Reopen', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('free-canvas-point pin: click-to-place, persists across reload, and drives the header unread badge', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Baseline: the "users" thread from the previous test is resolved, so no
    // unread badge should be showing yet.
    await expect(page.getByText(/unresolved$/)).toHaveCount(0)

    // AC — enter placement mode and click an empty region of the canvas
    // (top-right corner, well clear of the seeded tables/area which sit in
    // the diagram's top-left/middle region).
    await page.getByRole('button', { name: 'Add comment' }).click()
    const pane = page.locator('.react-flow__pane')
    const box = await pane.boundingBox()
    if (!box) throw new Error('react-flow pane not found')
    await pane.click({ position: { x: box.width - 60, y: 60 } })

    // AC — the placement dialog opens; confirm with a body (required —
    // comments cannot be empty).
    await expect(
      page.getByRole('heading', { name: 'New comment' }),
    ).toBeVisible()
    const pinBody = 'Consider a legend explaining the color coding here.'
    await page.getByPlaceholder('Add a comment...').fill(pinBody)
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'New comment' }),
    ).toBeHidden()

    // AC — the pin renders on the canvas and its popover shows the body.
    const pin = page.getByTestId('comment-pin')
    await expect(pin).toBeVisible()
    await pin.click()
    await expect(page.getByText(pinBody)).toBeVisible()
    await page.keyboard.press('Escape')

    // AC — header unread badge reflects the one unresolved thread (the
    // table thread was resolved in the previous test; this new point
    // thread is the only unresolved one).
    await expect(page.getByText('1 unresolved')).toBeVisible()

    // Reload — persistence check (dev broadcast no-ops, see file header).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(page.getByTestId('comment-pin')).toBeVisible()
    await expect(page.getByText('1 unresolved')).toBeVisible()

    // AC — the side panel (Toolbar's Comments button) opens and lists it.
    await page.getByRole('button', { name: 'Comments' }).click()
    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible()
    await expect(
      page
        .getByRole('list', { name: 'Comment thread list' })
        .getByText(pinBody),
    ).toBeVisible()
  })
})

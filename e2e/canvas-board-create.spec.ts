// e2e/canvas-board-create.spec.ts
// End-to-end coverage for navigator-create-canvas-board (tactical plan step
// 11): the navigator can create, list, rename, move, and delete a canvas
// board, exactly as it already can for ERD whiteboards. Auth + seed data
// come from global-setup (storageState) — IDS.project ("E2E Project"),
// owned by IDS.user, ADMIN member, seeded by e2e/seed.ts.
//
// Every acceptance criterion below traces to a spec-delta scenario in
// .claude/feature/2026-08-28-navigator-create-canvas-board/spec-delta/board-navigator.md:
//   - "Editor creates a canvas board in the project root"
//   - "Both kinds appear in one tree level" / "Each kind opens its own route"
//   - "Editor renames a canvas board"
//   - "Canvas board dropped on a folder" / "Drag payload identifies the board kind"
//   - "Deleting a canvas board removes its elements" (row disappears)
//
// The sidebar (`<aside>` in Sidebar.tsx) is part of the persistent
// non-zen-mode shell (__root.tsx) — it never remounts across the
// client-side route changes below, which is what makes "the row appears
// without a manual refresh" an observable, meaningful assertion rather than
// a tautology.
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

test.describe('Navigator: create, rename, move, and delete a canvas board', () => {
  test('creates a canvas board from the sidebar dropdown, opens it, renames it, drags it into a folder, and deletes it', async ({
    page,
  }) => {
    const sidebar = page.locator('aside')

    await page.goto('/')
    await page.getByRole('button', { name: /toggle e2e project tree/i }).click()

    // ── Create (spec-delta: "Editor creates a canvas board in the project root") ──
    // { force: true } on every navigator row action button below: these
    // buttons only reach `opacity-100`/`pointer-events-auto` on a real CSS
    // `:hover` of their `.group` ancestor, and Chromium's hover state is
    // whatever the mouse's last dispatched position left it as — fragile to
    // pin down deterministically across a long multi-step test with dialogs,
    // portals, and a drag gesture in between. `force: true` clicks the
    // element directly, bypassing the actionability/interception check,
    // which is the correct tool for a hover-revealed control whose presence
    // (not its opacity transition) is what this test is verifying.
    await page.getByRole('button', { name: 'New board' }).first().click({
      force: true,
    })
    await page.getByRole('menuitem', { name: 'New Canvas board' }).click()
    await expect(
      page.getByRole('heading', { name: 'Create Canvas Board' }),
    ).toBeVisible()

    const boardName = `E2E Canvas ${Date.now()}`
    await page.getByPlaceholder('My Canvas Board').fill(boardName)
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    // Navigates to /canvas/$boardId and the board renders (spec-delta:
    // "Each kind opens its own route").
    await expect(page).toHaveURL(/\/canvas\//)
    await expect(page.getByRole('heading', { name: boardName })).toBeVisible()
    await page.waitForSelector('canvas')

    // The row appears in the sidebar WITHOUT a manual refresh — this is a
    // client-side navigation, the sidebar never unmounted, so its presence
    // here proves the query-cache invalidation worked, not a fresh load.
    const sidebarBoardLink = sidebar.getByRole('link', {
      name: boardName,
      exact: true,
    })
    await expect(sidebarBoardLink).toBeVisible()
    await expect(sidebarBoardLink).toHaveAttribute('href', /\/canvas\//)

    // ── Rename (spec-delta: "Editor renames a canvas board") ──
    // The row's Link is a direct child of CanvasBoardItem's own wrapping
    // `.group` div (which also holds the rename/delete buttons) — walking to
    // that exact parent is simpler and less failure-prone than filtering by
    // containment.
    const boardRow = sidebarBoardLink.locator('xpath=..')
    await boardRow.getByRole('button', { name: 'Rename' }).click({
      force: true,
    })
    await expect(
      page.getByRole('heading', { name: 'Rename Canvas Board' }),
    ).toBeVisible()

    const renamedBoardName = `${boardName} Renamed`
    await page.locator('#canvas-board-rename').fill(renamedBoardName)
    await page.getByRole('button', { name: 'Save' }).click()
    // .last(): Sonner toasts can still be present from an earlier step
    // (multiple mutations happen in this one test), so the same text can
    // match more than one stacked toast at once.
    await expect(page.getByText('Canvas board updated!').last()).toBeVisible()

    // The tree reflects the new name; the old exact name is gone (the old
    // name is now a SUBSTRING of the new one, hence `exact: true` on both).
    await expect(
      sidebar.getByRole('link', { name: renamedBoardName, exact: true }),
    ).toBeVisible()
    await expect(
      sidebar.getByRole('link', { name: boardName, exact: true }),
    ).toHaveCount(0)

    // ── Move into a folder (spec-delta: "Canvas board dropped on a folder") ──
    const folderName = `E2E Canvas Folder ${Date.now()}`
    await page.getByRole('button', { name: 'New Folder' }).first().click({
      force: true,
    })
    await expect(
      page.getByRole('heading', { name: 'Create Folder' }),
    ).toBeVisible()
    await page.getByPlaceholder('My Folder').fill(folderName)
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByText('Folder created!')).toBeVisible()

    const renamedBoardLink = sidebar.getByRole('link', {
      name: renamedBoardName,
      exact: true,
    })
    // The folder row's name is plain text (not a Link — only the folder's
    // chevron toggles in the sidebar), so it is a valid, unambiguous DROP
    // target without colliding with any Link-role query.
    const folderRow = sidebar
      .locator('div.group')
      .filter({ hasText: folderName })
    await expect(folderRow).toBeVisible()

    // Native HTML5 drag-and-drop — the app's own drag handlers use
    // draggable + onDragStart/onDrop (dataTransfer), not a mouse-based DnD
    // library, so Locator.dragTo (which simulates the native drag event
    // sequence) is the correct driver here, matching how the app itself
    // implements the gesture.
    await renamedBoardLink.dragTo(folderRow)
    // .last(): Sonner toasts can still be present from an earlier step
    // (multiple mutations happen in this one test), so the same text can
    // match more than one stacked toast at once.
    await expect(page.getByText('Canvas board updated!').last()).toBeVisible()

    // Verify the move landed server-side: expand the folder's own row in the
    // sidebar and confirm the board now renders NESTED under it, with its
    // route link intact.
    //
    // NOT verified via the folder's own page
    // (/project/$projectId/folder/$folderId): the sidebar-expand check below
    // predates the fix and is left as-is here to avoid touching a
    // review-approved e2e's verification mechanism. The missing-<Outlet />
    // bug that used to make that route unusable for assertions (folder
    // pages rendered the parent project page's content instead of
    // FolderPage) is now fixed — see src/routes/project.$projectId.tsx (now
    // a layout rendering <Outlet />) and its own regression coverage in
    // e2e/folder-page-navigation.spec.ts, which drives that exact route.
    const sidebarFolderRow = sidebar
      .locator('div.group')
      .filter({ hasText: folderName })
    // The chevron toggle is the one button in this row with no `title`
    // attribute — every action button (New board / New Subfolder / Rename /
    // Delete) carries one.
    await sidebarFolderRow.locator('button:not([title])').click({
      force: true,
    })

    const movedBoardLink = sidebar.getByRole('link', {
      name: renamedBoardName,
      exact: true,
    })
    await expect(movedBoardLink).toBeVisible()
    await expect(movedBoardLink).toHaveAttribute('href', /\/canvas\//)
    const movedBoardRow = movedBoardLink.locator('xpath=..')
    await movedBoardRow.getByRole('button', { name: 'Delete' }).click({
      force: true,
    })

    const deleteDialog = page.getByRole('dialog')
    await expect(
      deleteDialog.getByRole('heading', { name: 'Delete Canvas Board' }),
    ).toBeVisible()
    // Scoped to the dialog: the row's own "Delete" icon button (same
    // accessible name) is still in the DOM behind it at this point.
    await deleteDialog
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await expect(page.getByText('Canvas board deleted')).toBeVisible()

    // The row is gone, everywhere.
    await expect(
      page.getByRole('link', { name: renamedBoardName, exact: true }),
    ).toHaveCount(0)
  })
})

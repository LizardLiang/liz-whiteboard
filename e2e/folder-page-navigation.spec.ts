// e2e/folder-page-navigation.spec.ts
// Regression coverage for the missing <Outlet /> bug: `/project/$projectId`
// is a layout route with `/project/$projectId/folder/$folderId` as its
// child in the generated route tree (`getParentRoute: () =>
// ProjectProjectIdRoute` in routeTree.gen.ts), but before this fix the
// layout never rendered <Outlet />, so navigating into a folder silently
// re-rendered the PARENT project page instead of FolderPage — traced to
// 44214f5, affecting whiteboards and canvas boards alike.
//
// No earlier e2e test caught this because none navigated into a folder page
// THROUGH THE ROUTER (by clicking a folder card). Even
// canvas-board-create.spec.ts's own folder verification deliberately routes
// around it via the sidebar's folder-expand rather than the folder route —
// see the comment there.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'

test.use({ viewport: { width: 1600, height: 1000 } })

test.describe('Folder route renders its own page, not the parent project page', () => {
  test('clicking a folder card on the project page navigates to the folder route and renders FolderPage', async ({
    page,
  }) => {
    await page.goto(`/project/${IDS.project}`)
    await expect(page.getByRole('heading', { name: 'E2E Project' })).toBeVisible()

    // Create a folder to navigate into. Scoped to <main>: the sidebar has
    // its own "New Folder" button at the project root, distinct from the
    // project page header's.
    const folderName = `E2E Nav Folder ${Date.now()}`
    await page
      .getByRole('main')
      .getByRole('button', { name: 'New Folder' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Create Folder' }),
    ).toBeVisible()
    await page.getByPlaceholder('My Folder').fill(folderName)
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByText('Folder created!')).toBeVisible()

    // Click the folder's card in the content grid — a real router <Link> to
    // /project/$projectId/folder/$folderId. This is the exact navigation
    // path no earlier test exercised.
    await page.getByRole('link', { name: folderName, exact: true }).click()

    await expect(page).toHaveURL(
      new RegExp(`/project/${IDS.project}/folder/`),
    )

    // The defect: without <Outlet />, this heading would still read
    // "E2E Project" (the parent ProjectPage re-rendering) instead of the
    // folder's own name — FolderPage's H1 is content.currentFolder.name.
    await expect(
      page.getByRole('heading', { name: folderName, exact: true }),
    ).toBeVisible()

    // A second, independent signal: the parent project page's own heading
    // must be gone, not merely coexisting alongside the folder's.
    await expect(
      page.getByRole('heading', { name: 'E2E Project', exact: true }),
    ).toHaveCount(0)
  })
})

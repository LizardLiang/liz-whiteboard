// e2e/share-links.spec.ts
// End-to-end coverage for read-only public share links (GH #109): an ADMIN
// creates a share link from the project's Share panel, an anonymous (logged-
// OUT) visitor opens /share/$token and sees the diagram rendered read-only
// with NO edit affordances, then the ADMIN revokes the link and the same
// public URL now shows the "revoked" state. A bogus token shows "invalid".
//
// Auth + seed data come from global-setup (storageState) — the `page` fixture
// is the authenticated ADMIN. The public visitor is a SEPARATE, cookie-less
// browser context created inline (storageState: empty) so we exercise the
// real no-account path, not a logged-in read.
//
// R1 (no Socket.IO on the public path) is asserted indirectly: the share page
// renders in ReactFlowWhiteboard's `isPublic` mode, which passes
// collaborationEnabled=false so the collaboration hook never opens a socket
// (src/hooks/use-collaboration.ts) and the edit toolbar is never mounted.
import {   expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type {Browser, Page} from '@playwright/test';

const PROJECT_URL = `/project/${IDS.project}`

/** Open the project page and its Share panel (ADMIN-only trigger). */
async function openSharePanel(page: Page) {
  await page.goto(PROJECT_URL)
  await expect(page.getByRole('heading', { name: 'E2E Project' })).toBeVisible()
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByRole('heading', { name: 'Share Project' })).toBeVisible()
}

/**
 * Create a read-only share link for the seeded "E2E ERD" whiteboard and return
 * its full public URL (the one-time token is only ever shown here).
 */
async function createShareLink(page: Page): Promise<string> {
  // Pick the whiteboard explicitly (the panel also defaults to the first one,
  // but selecting is deterministic across re-renders).
  await page.getByRole('combobox', { name: 'Select whiteboard' }).click()
  await page.getByRole('option', { name: 'E2E ERD' }).click()

  const create = page.getByRole('button', { name: 'Create read-only share link' })
  await expect(create).toBeEnabled()
  await create.click()

  // The one-time link surfaces in a readonly input; its value is the full URL.
  const linkInput = page.getByRole('textbox', { name: 'Share link' })
  await expect(linkInput).toBeVisible()
  const url = await linkInput.inputValue()
  expect(url).toContain('/share/')
  return url
}

/** A fresh, cookie-less context — a real logged-out public visitor. */
async function anonPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  return context.newPage()
}

test.describe('Read-only public share links (GH #109)', () => {
  test('create → anonymous read-only view → revoke → link dies', async ({
    page,
    browser,
  }) => {
    await openSharePanel(page)
    const shareUrl = await createShareLink(page)

    // AC — an anonymous visitor (no session cookie) can view the diagram.
    const visitor = await anonPage(browser)
    await visitor.goto(shareUrl)

    // The whiteboard name renders and both seeded tables are on the canvas.
    await expect(
      visitor.getByRole('heading', { name: 'E2E ERD' }),
    ).toBeVisible()
    await expect(
      visitor.locator('.react-flow').getByText('users', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      visitor.locator('.react-flow').getByText('orders', { exact: true }).first(),
    ).toBeVisible()

    // AC — view-only: none of the edit chrome exists on the public path.
    // The whole edit Toolbar (with "Version history") is unmounted in isPublic
    // mode, and there is no project "Share" button on this page.
    await expect(
      visitor.getByRole('button', { name: 'Version history' }),
    ).toHaveCount(0)
    await expect(visitor.getByRole('button', { name: 'Share' })).toHaveCount(0)

    // AC — no per-node edit affordance: hovering a table reveals no delete
    // button (which the authenticated canvas would show).
    const ordersNode = visitor
      .locator('.react-flow__node')
      .filter({ hasText: 'orders' })
      .first()
    await ordersNode.hover()
    await expect(
      visitor.getByRole('button', { name: 'Delete table orders' }),
    ).toHaveCount(0)

    // AC — revoke from the panel kills the link. The outstanding-links list now
    // shows the E2E ERD link; revoke it.
    await page
      .getByRole('button', { name: 'Revoke E2E ERD share link' })
      .click()
    await expect(
      page
        .getByRole('list', { name: 'Outstanding read-only links' })
        .getByText('Revoked'),
    ).toBeVisible()

    // AC — the SAME public URL is now dead for the anonymous visitor.
    await visitor.reload()
    await expect(
      visitor.getByText('Shared link unavailable'),
    ).toBeVisible()
    await expect(
      visitor.getByText('This shared link has been revoked.'),
    ).toBeVisible()
    // The diagram is no longer rendered.
    await expect(
      visitor.getByRole('heading', { name: 'E2E ERD' }),
    ).toHaveCount(0)

    await visitor.context().close()
  })

  test('a bogus token shows the invalid state (no diagram leaked)', async ({
    browser,
  }) => {
    const visitor = await anonPage(browser)
    // A well-formed-looking but non-existent token.
    await visitor.goto('/share/not-a-real-share-token-000000000000')

    await expect(
      visitor.getByText('Shared link unavailable'),
    ).toBeVisible()
    await expect(
      visitor.getByText('This shared link is invalid.'),
    ).toBeVisible()
    // No whiteboard content is rendered for an invalid token.
    await expect(visitor.locator('.react-flow__node')).toHaveCount(0)

    await visitor.context().close()
  })
})

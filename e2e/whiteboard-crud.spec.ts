// e2e/whiteboard-crud.spec.ts
// End-to-end coverage for the core authoring loop that had no e2e before:
// creating a table via the Toolbar and creating a relationship between two
// existing tables — each verified to persist across a reload. Persistence is
// the real contract: the live Socket.IO broadcast no-ops in the dev
// two-process split, and the canvas edge set is built from `initialEdges` at
// load time (a live-created relationship only renders after a reload), so both
// assertions verify state via a fresh load — the same approach the other
// suites use (see playwright.config.ts). Auth + seed data come from
// global-setup (storageState).
//
// Table *deletion* is intentionally not re-tested here — version-history.spec.ts
// already exercises it against the always-visible seeded "orders" node.
//
// Shared-board hygiene: this spec adds a table and a relationship that persist
// for the rest of the run. That is harmless — the only later spec
// (whiteboard-search) is read-only and queries the seeded users/orders names,
// and global-setup re-seeds the whole board from scratch on every suite run.
import { expect, test, type Page } from '@playwright/test'
import { IDS } from './fixtures'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  // Canvas ready: the react-flow pane has rendered the seeded tables.
  await expect(
    page.locator('.react-flow').getByText('users', { exact: true }).first(),
  ).toBeVisible()
}

function nodeByName(page: Page, name: string) {
  return page.locator('.react-flow__node').filter({ hasText: name }).first()
}

test.describe('Whiteboard core CRUD (tables + relationships)', () => {
  test('add a table via the toolbar → it renders and persists', async ({
    page,
  }) => {
    await openWhiteboard(page)

    const tableName = 'e2e_widgets'

    // Create — the Add Table dialog only captures name/description; columns
    // are added later (that flow is exercised via SQL import elsewhere).
    await page.getByRole('button', { name: 'Add Table' }).click()
    await expect(page.getByRole('heading', { name: 'Create Table' })).toBeVisible()
    await page.getByPlaceholder('e.g., Users').fill(tableName)
    await page.getByRole('button', { name: 'Create Table' }).click()

    // The new node appears on the canvas.
    await expect(nodeByName(page, tableName)).toBeVisible()

    // Persistence: reload and confirm it survived (server-side write, not just
    // optimistic local state).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(nodeByName(page, tableName)).toBeVisible()
  })

  test('create a relationship between two tables → a new edge appears and persists', async ({
    page,
  }) => {
    await openWhiteboard(page)

    // Count edges before — the seeded board already has one relationship, and
    // earlier suites may leave the board in different states, so we assert a
    // +1 delta rather than an absolute count. React Flow renders each edge as
    // a `.react-flow__edge` element.
    const edges = page.locator('.react-flow__edge')
    const before = await edges.count()

    // A label unique enough to assert without colliding with the seeded
    // "belongs to" relationship already on the board.
    const relLabel = 'e2e_ref_link'

    await page.getByRole('button', { name: 'Add Relationship' }).click()
    await expect(
      page.getByRole('heading', { name: 'Create Relationship' }),
    ).toBeVisible()

    // Radix Select triggers expose their listbox on click; pick options by
    // their visible text. Reuse the id/user_id columns the seeded relationship
    // already renders edges with (a distinct users.id → orders.user_id edge) —
    // those columns have known-good React Flow handles, so the new edge renders
    // rather than being silently dropped by the handle matcher.
    await page.locator('#source-table').click()
    await page.getByRole('option', { name: 'users' }).click()
    await page.locator('#source-column').click()
    await page.getByRole('option', { name: 'id (UUID)', exact: true }).click()

    await page.locator('#target-table').click()
    await page.getByRole('option', { name: 'orders' }).click()
    await page.locator('#target-column').click()
    await page.getByRole('option', { name: /^user_id/ }).click()

    await page.getByPlaceholder('e.g., has, belongs to').fill(relLabel)
    await page.getByRole('button', { name: 'Create Relationship' }).click()

    // Dialog closes only on success (Toolbar keeps it open on a rejected
    // mutation), so this confirms the server accepted the relationship.
    await expect(
      page.getByRole('heading', { name: 'Create Relationship' }),
    ).toBeHidden()

    // The canvas edge set is derived from initialEdges at load; a live-created
    // relationship shows after a reload. Verify the new edge + its label pill
    // (rendered in the DOM via EdgeLabelRenderer) survive the fresh load.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(edges).toHaveCount(before + 1)
    await expect(
      page.locator('.react-flow').getByText(relLabel).first(),
    ).toBeVisible()
  })
})

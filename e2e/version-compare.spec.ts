// e2e/version-compare.spec.ts
// End-to-end coverage for the version compare view in the history panel's
// Versions tab: "Compare with current", "Compare two versions" (older side
// first), the grouped Added / Removed / Changed list, the layout switch, an
// identical pair and a layout-only pair. Boards come from e2e/seed-compare.ts:
// four saved versions (Baseline, After the billing rewrite, a copy of it,
// Layout pass) and a current board that has moved on from all of them.
//
// The compare result is a read of persisted data, so no Socket.IO broadcast is
// involved and the spec behaves the same on the dev stack and the prod build.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { clickMoreTool } from './fixtures'
import { CMP_IDS, CMP_NAMES, CMP_VERSIONS } from './compare-constants'
import type { Locator, Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-compare.ts'], { stdio: 'inherit' })
})

async function openVersions(page: Page, whiteboardId: string, heading: string) {
  await page.goto(`/whiteboard/${whiteboardId}`)
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  await clickMoreTool(page, 'Version history')
  await expect(
    page.getByRole('heading', { name: 'History', exact: true }),
  ).toBeVisible()
}

const compare = (page: Page) => page.getByTestId('version-compare')
const section = (page: Page, name: 'added' | 'removed' | 'changed') =>
  page.getByTestId(`compare-${name}`)
const entries = (scope: Locator) => scope.getByTestId('compare-entry')

async function pick(
  page: Page,
  picker: 'Older version' | 'Newer version',
  option: string,
) {
  await compare(page).getByRole('combobox', { name: picker }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.describe('Version compare', () => {
  test('a version against the current board', async ({ page }) => {
    await openVersions(page, CMP_IDS.board, 'E2E Compare')
    await page
      .getByRole('button', {
        name: `Compare ${CMP_VERSIONS.v1} with the current board`,
      })
      .click()

    await expect(
      compare(page).getByRole('combobox', { name: 'Older version' }),
    ).toContainText(CMP_VERSIONS.v1)
    await expect(
      compare(page).getByRole('combobox', { name: 'Newer version' }),
    ).toContainText('Current board')

    await expect(section(page, 'added')).toContainText('Added (2)')
    await expect(section(page, 'added')).toContainText(
      'added column created_at to users',
    )
    await expect(section(page, 'added')).toContainText(
      `created table ${CMP_NAMES.longTable}`,
    )
    await expect(section(page, 'removed')).toContainText('Removed (2)')
    await expect(section(page, 'removed')).toContainText(
      `removed column ${CMP_NAMES.cjkColumn} from users`,
    )
    await expect(section(page, 'removed')).toContainText(
      'removed column total from orders',
    )
    await expect(section(page, 'changed')).toContainText('Changed (2)')
    await expect(section(page, 'changed')).toContainText(
      'renamed column mail → email on users',
    )
    await expect(section(page, 'changed')).toContainText(
      'renamed table products → catalog_items',
    )

    // A rename lists old -> new when the row is opened.
    const rename = entries(section(page, 'changed')).filter({
      hasText: 'renamed column',
    })
    await rename.getByRole('button', { name: 'Show details' }).click()
    await expect(rename).toContainText('mail')
    await expect(rename).toContainText('email')
  })

  test('layout differences stay hidden until the switch is on', async ({
    page,
  }) => {
    await openVersions(page, CMP_IDS.board, 'E2E Compare')
    await page
      .getByRole('button', {
        name: `Compare ${CMP_VERSIONS.v1} with the current board`,
      })
      .click()
    await expect(section(page, 'changed')).toContainText('Changed (2)')
    await page.getByRole('switch', { name: 'Show layout changes' }).click()
    // users moved from x=80 to x=120: a layout-only entry appears.
    await expect(section(page, 'changed')).toContainText('Changed (3)')
    await expect(section(page, 'changed')).toContainText(
      'changed table users (positionX)',
    )
  })

  test('two versions, older side first, with a swap when the order is reversed', async ({
    page,
  }) => {
    await openVersions(page, CMP_IDS.board, 'E2E Compare')
    await page.getByRole('button', { name: 'Compare two versions' }).click()
    // Default: the two newest versions, older one on the left.
    await expect(
      compare(page).getByRole('combobox', { name: 'Older version' }),
    ).toContainText(CMP_VERSIONS.v2copy)
    await expect(
      compare(page).getByRole('combobox', { name: 'Newer version' }),
    ).toContainText(CMP_VERSIONS.v3)

    await pick(page, 'Older version', CMP_VERSIONS.v1)
    await pick(page, 'Newer version', CMP_VERSIONS.v2)
    await expect(section(page, 'added')).toContainText('Added (3)')
    await expect(section(page, 'added')).toContainText('created relationship')
    await expect(section(page, 'removed')).toContainText('Removed (1)')
    await expect(section(page, 'changed')).toContainText('Changed (2)')
    await expect(section(page, 'changed')).toContainText(
      'changed the type of total on orders: VARCHAR → DECIMAL',
    )

    // Picking a newer version on the older side swaps the sides.
    await pick(page, 'Older version', CMP_VERSIONS.v3)
    await expect(
      compare(page).getByRole('combobox', { name: 'Older version' }),
    ).toContainText(CMP_VERSIONS.v2)
    await expect(
      compare(page).getByRole('combobox', { name: 'Newer version' }),
    ).toContainText(CMP_VERSIONS.v3)
  })

  test('an identical pair and a layout-only pair', async ({ page }) => {
    await openVersions(page, CMP_IDS.board, 'E2E Compare')
    await page.getByRole('button', { name: 'Compare two versions' }).click()

    await pick(page, 'Older version', CMP_VERSIONS.v2)
    await pick(page, 'Newer version', CMP_VERSIONS.v2copy)
    await expect(compare(page)).toContainText(
      'No differences between these two.',
    )

    await pick(page, 'Older version', CMP_VERSIONS.v2copy)
    await pick(page, 'Newer version', CMP_VERSIONS.v3)
    await expect(compare(page)).toContainText('Only layout differs.')
    await page.getByRole('switch', { name: 'Show layout changes' }).click()
    await expect(section(page, 'changed')).toContainText('Changed (1)')
    await expect(section(page, 'changed')).toContainText('products')
  })

  test('the same version on both sides asks for two different ones', async ({
    page,
  }) => {
    await openVersions(page, CMP_IDS.board, 'E2E Compare')
    await page.getByRole('button', { name: 'Compare two versions' }).click()
    await pick(page, 'Older version', CMP_VERSIONS.v1)
    await pick(page, 'Newer version', CMP_VERSIONS.v1)
    await expect(compare(page)).toContainText(
      'Pick two different versions to compare.',
    )
  })

  test('Back returns to the version list; a board without versions offers no compare', async ({
    page,
  }) => {
    await openVersions(page, CMP_IDS.board, 'E2E Compare')
    await page.getByRole('button', { name: 'Compare two versions' }).click()
    await page.getByRole('button', { name: 'Back to versions' }).click()
    await expect(
      page.getByRole('list', { name: 'Version list' }),
    ).toContainText(CMP_VERSIONS.v1)

    await openVersions(page, CMP_IDS.empty, 'E2E Compare Empty')
    await expect(page.getByText('No versions saved yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Compare/ })).toHaveCount(0)
  })
})

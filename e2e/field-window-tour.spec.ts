// e2e/field-window-tour.spec.ts
// End-to-end coverage for the field window tour: a seven-step spotlight that
// starts on the first field window of a browser, replays from the '?' button,
// pans the canvas on step 4, ends on Esc / Skip / Done / window close, and
// keeps its card inside the viewport on a phone.
// Saved sessions carry `fields-window-tour-seen` (global-setup.ts), so every
// test clears the flag on its FIRST navigation only (sessionStorage guard):
// a reload inside a test must keep the flag the tour just set.
// Socket.IO broadcasts only run in the single-process prod build, so the
// "deleted table" test deletes through the UI and asserts the local result.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS, TOUR_SEEN_KEY } from './fixtures'
import { getViewportScale, tableNode } from './canvas-helpers'
import type { Locator, Page } from '@playwright/test'

const drawer = (page: Page) => page.getByTestId('table-fields-drawer')
const tour = (page: Page) => page.getByTestId('spotlight-tour')
const card = (page: Page) => page.getByTestId('spotlight-card')
const cutout = (page: Page) => page.getByTestId('spotlight-cutout')
const nodeOf = (page: Page, name: string) =>
  page.locator(`.react-flow__node:has([data-table-name="${name}"])`).first()

/** The data-testid each step spotlights inside the window; step 4 is the canvas node. */
const STEP_TARGETS = [
  'table-fields-drawer',
  'table-fields-header',
  'fields-window-pin',
  null,
  'fields-window-mode',
  'fields-window-minimize',
  'fields-window-help',
] as const

async function clearSeenFlagOnce(page: Page) {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('tour-test-cleared')) return
    sessionStorage.setItem('tour-test-cleared', '1')
    localStorage.removeItem(key)
  }, TOUR_SEEN_KEY)
}

async function openComplexBoard(page: Page) {
  await page.goto(`/whiteboard/${IDS.fdWhiteboard}`)
  await expect(
    page.getByRole('heading', { name: 'E2E Fields Drawer' }),
  ).toBeVisible()
  await expect(tableNode(page, 'customer_orders').first()).toBeVisible()
}

async function clickTable(page: Page, name: string) {
  await nodeOf(page, name).click({ position: { x: 20, y: 8 } })
}

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return b
}

type Box = { x: number; y: number; width: number; height: number }
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y

async function expectStep(page: Page, step: number) {
  await expect(card(page)).toContainText(`${step} of 7`)
}

async function next(page: Page) {
  await card(page)
    .getByRole('button', { name: /^(Next|Done)$/ })
    .click()
}

/** Wait until the cutout box surrounds the target box (6 px pad, 8 px slack). */
async function expectCutoutAround(page: Page, target: Locator) {
  await expect
    .poll(
      async () => {
        const c = await cutout(page).boundingBox()
        const t = await target.boundingBox()
        if (!c || !t) return 'missing'
        const slack = 8
        const ok =
          c.x <= t.x + 0.5 &&
          c.x >= t.x - slack &&
          c.y <= t.y + 0.5 &&
          c.y >= t.y - slack &&
          c.x + c.width >= t.x + t.width - 0.5 &&
          c.x + c.width <= t.x + t.width + slack &&
          c.y + c.height >= t.y + t.height - 0.5 &&
          c.y + c.height <= t.y + t.height + slack
        return ok ? 'ok' : JSON.stringify({ c, t })
      },
      { timeout: 5000 },
    )
    .toBe('ok')
}

function stepTarget(page: Page, index: number, table: string): Locator {
  const id = STEP_TARGETS[index]
  return id ? page.getByTestId(id) : nodeOf(page, table)
}

test.describe('Field window tour', () => {
  test.beforeAll(() => {
    execFileSync('bun', ['run', 'e2e/seed-fields-drawer.ts'], {
      stdio: 'inherit',
    })
  })

  test.beforeEach(async ({ page }) => {
    await clearSeenFlagOnce(page)
  })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1600, height: 1000 } })

    test('first open starts the tour and Next walks all seven targets', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await expect(tour(page)).toHaveCount(0)
      await clickTable(page, 'customer_orders')
      await expect(drawer(page)).toBeVisible()
      await expect(tour(page)).toBeVisible()
      await expectStep(page, 1)
      expect(
        await page.evaluate((key) => localStorage.getItem(key), TOUR_SEEN_KEY),
      ).toBe('true')

      for (let i = 0; i < 7; i++) {
        await expectStep(page, i + 1)
        await expect(card(page).getByRole('heading')).toBeVisible()
        await expectCutoutAround(page, stepTarget(page, i, 'customer_orders'))
        const c = await box(card(page))
        const vp = page.viewportSize()!
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x + c.width).toBeLessThanOrEqual(vp.width + 0.5)
        expect(c.y + c.height).toBeLessThanOrEqual(vp.height + 0.5)
        if (i < 6) {
          await expect(
            card(page).getByRole('button', { name: 'Next' }),
          ).toBeFocused()
          await next(page)
        }
      }
      // Last step: Done replaces Next, and ends the tour.
      await expect(
        card(page).getByRole('button', { name: 'Done' }),
      ).toBeVisible()
      await expect(
        card(page).getByRole('button', { name: 'Next' }),
      ).toHaveCount(0)
      await next(page)
      await expect(tour(page)).toHaveCount(0)
      await expect(drawer(page)).toBeVisible()
    })

    test('Back from step 3 shows step 2 with the header spotlighted', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)
      await next(page)
      await next(page)
      await expectStep(page, 3)
      await card(page).getByRole('button', { name: 'Back' }).click()
      await expectStep(page, 2)
      await expectCutoutAround(page, page.getByTestId('table-fields-header'))
    })

    test('step 4 pans a table under the window into view at the same zoom', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)

      // Drag the window over the table, so step 4 has to pan.
      const node = await box(nodeOf(page, 'customer_orders'))
      const header = await box(page.getByTestId('table-fields-header'))
      const win = await box(drawer(page))
      const grabX = header.x + 24
      const grabY = header.y + 10
      const dx = node.x - 150 - win.x
      const dy = node.y - 40 - win.y
      await page.mouse.move(grabX, grabY)
      await page.mouse.down()
      await page.mouse.move(grabX + dx / 2, grabY + dy / 2, { steps: 5 })
      await page.mouse.move(grabX + dx, grabY + dy, { steps: 5 })
      await page.mouse.up()
      const movedWin = await box(drawer(page))
      expect(
        intersects(await box(nodeOf(page, 'customer_orders')), movedWin),
      ).toBe(true)
      const scale = await getViewportScale(page)

      await page.getByTestId('fields-window-help').click()
      await expectStep(page, 1)
      await next(page)
      await next(page)
      await next(page)
      await expectStep(page, 4)

      await expect
        .poll(
          async () => {
            const n = await box(nodeOf(page, 'customer_orders'))
            const w = await box(drawer(page))
            const vp = page.viewportSize()!
            const inView =
              n.x >= 0 &&
              n.y >= 0 &&
              n.x + n.width <= vp.width &&
              n.y + n.height <= vp.height
            return inView && !intersects(n, w)
          },
          { timeout: 5000 },
        )
        .toBe(true)
      await expectCutoutAround(page, nodeOf(page, 'customer_orders'))
      expect(await getViewportScale(page)).toBeCloseTo(scale, 5)
    })

    test('Esc ends an unpinned tour, the window stays; a dim click keeps the step', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)

      // A click on the dim area does nothing.
      await page.mouse.click(30, 500)
      await expectStep(page, 1)
      await expect(drawer(page)).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)
      await expect(drawer(page)).toBeVisible()
      await expect(
        drawer(page).getByRole('heading', {
          name: 'Fields of customer_orders',
        }),
      ).toBeVisible()
    })

    test('Skip ends the tour and the window stays', async ({ page }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)
      await card(page).getByRole('button', { name: 'Skip' }).click()
      await expect(tour(page)).toHaveCount(0)
      await expect(drawer(page)).toBeVisible()
    })

    test('the tour does not start after a reload; the ? button replays it', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)

      await page.reload()
      await expect(tableNode(page, 'customer_orders').first()).toBeVisible()
      await clickTable(page, 'customer_orders')
      await expect(drawer(page)).toBeVisible()
      await expect(tour(page)).toHaveCount(0)

      await page.getByTestId('fields-window-help').click()
      await expect(tour(page)).toBeVisible()
      await expectStep(page, 1)
      // The replay restarts from step 1 even after a partial walk.
      await next(page)
      await expectStep(page, 2)
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)
      await page.getByTestId('fields-window-help').click()
      await expectStep(page, 1)
    })

    test('focus returns to the element focused before the tour started', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)

      const help = page.getByTestId('fields-window-help')
      await help.focus()
      await help.press('Enter')
      await expectStep(page, 1)
      await expect(
        card(page).getByRole('button', { name: 'Next' }),
      ).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)
      await expect(help).toBeFocused()
    })

    test('the tour card does not animate under reduced motion', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)
      const durations = await card(page).evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          property: style.transitionProperty,
          duration: style.transitionDuration,
        }
      })
      expect(
        durations.duration.split(',').every((d) => parseFloat(d) === 0),
      ).toBe(true)
    })

    test('windows mode: ? explains the window it belongs to', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customers')
      await expectStep(page, 1)
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)
      await page.getByTestId('fields-window-pin').click()
      await page.getByTestId('fields-window-mode-windows').click()
      await clickTable(page, 'companies')
      await expect(drawer(page)).toHaveCount(2)

      const second = drawer(page).filter({ hasText: 'Fields of companies' })
      await second.getByTestId('fields-window-help').click()
      await expectStep(page, 1)
      await expectCutoutAround(page, second)
      await next(page)
      await expectCutoutAround(page, second.getByTestId('table-fields-header'))
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)
      await expect(drawer(page)).toHaveCount(2)
    })

    test('blocked storage: no second tour in the same page session', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException('blocked', 'QuotaExceededError')
        }
      })
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expectStep(page, 1)
      await page.keyboard.press('Escape')
      await expect(tour(page)).toHaveCount(0)

      await drawer(page)
        .getByRole('button', { name: 'Close fields drawer' })
        .click()
      await expect(drawer(page)).toBeHidden()
      await clickTable(page, 'customers')
      await expect(drawer(page)).toBeVisible()
      await expect(tour(page)).toHaveCount(0)
    })

    test('deleting the window table ends the tour with the window', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'companies')
      await expectStep(page, 1)

      // The context menu and its confirm dialog sit above the mask (z-50).
      await tableNode(page, 'companies').first().dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      })
      await page.getByRole('menuitem', { name: 'Delete table' }).click()
      await page
        .getByRole('button', { name: 'Delete table', exact: true })
        .click()

      await expect(tableNode(page, 'companies')).toHaveCount(0)
      await expect(drawer(page)).toHaveCount(0)
      await expect(tour(page)).toHaveCount(0)
    })

    test.afterAll(() => {
      execFileSync('bun', ['run', 'e2e/seed-fields-drawer.ts'], {
        stdio: 'inherit',
      })
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the card stays inside the viewport and off the cutout on every step', async ({
      page,
    }) => {
      await openComplexBoard(page)
      await clickTable(page, 'customer_orders')
      await expect(tour(page)).toBeVisible()

      for (let i = 0; i < 7; i++) {
        await expectStep(page, i + 1)
        // Let the card settle at its measured size and placement.
        await page.waitForTimeout(250)
        const c = await box(card(page))
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x + c.width).toBeLessThanOrEqual(390.5)
        expect(c.y + c.height).toBeLessThanOrEqual(844.5)
        if (i === 3) {
          // No free area beside a phone-sized window: centred card, no cutout.
          await expect(cutout(page)).toHaveCount(0)
        } else if (i === 0) {
          // Step 1 spotlights the whole window, which fills a phone screen:
          // no side of the cutout has room, so the card sits over it.
          await expect(cutout(page)).toHaveCount(1)
        } else {
          const cut = await box(cutout(page))
          expect(intersects(c, cut)).toBe(false)
        }
        if (i < 6) await next(page)
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390)
    })
  })
})

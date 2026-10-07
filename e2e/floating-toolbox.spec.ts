// e2e/floating-toolbox.spec.ts
// End-to-end coverage for the board shell: the project navigator hidden behind
// a floating chip (drawer + pin) and the ER whiteboard's floating bottom dock
// with its "More tools" and zoom menus. Auth comes from global-setup
// (storageState); the viewer case logs in through the real /login form.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import {
  E2E_VIEWER_USER,
  IDS,
  clickMoreTool,
  clickZoomMenuItem,
  waitForMenusClosed,
} from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Browser, Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`
const CANVAS_URL = `/canvas/${IDS.canvasBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed-stress creates the VIEWER account + its dedicated whiteboard;
  // seed-canvas creates the FigJam-style board the chip case opens.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

const sidebar = (page: Page) => page.locator('aside')
const drawer = (page: Page) => page.getByTestId('navigator-drawer')
const dock = (page: Page) => page.getByTestId('whiteboard-dock')

async function zoomLabel(page: Page) {
  return (await page.getByTestId('zoom-menu-trigger').innerText()).trim()
}

/** The zoom label once two reads in a row agree, so animations have finished. */
async function settledZoomLabel(
  page: Page,
  differentFrom?: string,
): Promise<string> {
  let previous = ''
  await expect
    .poll(async () => {
      const current = await zoomLabel(page)
      const settled = current === previous && current !== differentFrom
      previous = current
      return settled
    })
    .toBe(true)
  return previous
}

async function loginAsViewer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined })
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
  await expect
    .poll(async () =>
      (await context.cookies()).some(
        (c) => c.name === 'session_token' && c.value.length > 0,
      ),
    )
    .toBe(true)
  // The login success handler does a full-page navigation; let it settle
  // before the caller issues its own goto.
  await page.waitForLoadState('networkidle')
  return page
}

test.describe('Board navigator drawer', () => {
  test('whiteboard shows no sidebar; chip carries the board name', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await expect(sidebar(page)).toHaveCount(0)
    const chip = page.getByTestId('board-chip')
    await expect(chip).toBeVisible()
    await expect(chip.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  })

  test('the [ key and the chip button open the drawer; Esc closes it', async ({
    page,
  }) => {
    await openWhiteboard(page)

    await page.keyboard.press('[')
    await expect(drawer(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()

    await page.getByRole('button', { name: 'Show project navigator' }).click()
    await expect(drawer(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
  })

  test('picking a board navigates and closes the drawer', async ({ page }) => {
    await openWhiteboard(page)
    await page.getByRole('button', { name: 'Show project navigator' }).click()
    await expect(drawer(page)).toBeVisible()

    const target = drawer(page).getByRole('link', { name: 'E2E Multi-Drag' })
    if (!(await target.isVisible())) {
      await drawer(page)
        .getByRole('button', { name: 'Toggle E2E Project tree' })
        .click()
    }
    await target.click()

    await expect(page).toHaveURL(new RegExp(`/whiteboard/${IDS.mdWhiteboard}`))
    await expect(drawer(page)).toBeHidden()
    await expect(
      page.getByRole('heading', { name: 'E2E Multi-Drag' }),
    ).toBeVisible()
  })

  test('pinning docks the sidebar and survives a reload', async ({ page }) => {
    await openWhiteboard(page)
    await page.getByRole('button', { name: 'Show project navigator' }).click()
    await page.getByRole('button', { name: 'Pin navigator' }).click()

    await expect(sidebar(page)).toBeVisible()
    await expect(drawer(page)).toBeHidden()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
    await expect(sidebar(page)).toBeVisible()

    await page.getByRole('button', { name: 'Unpin navigator' }).click()
    await expect(sidebar(page)).toHaveCount(0)
  })

  test('pinning docks the sidebar even when localStorage rejects writes', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'navigator-pinned') {
          throw new DOMException('blocked', 'SecurityError')
        }
        setItem.call(this, key, value)
      }
    })
    await openWhiteboard(page)
    const writeOutcome = await page.evaluate(() => {
      try {
        localStorage.setItem('navigator-pinned', 'true')
        return 'written'
      } catch {
        return 'blocked'
      }
    })
    expect(writeOutcome).toBe('blocked')

    await page.getByRole('button', { name: 'Show project navigator' }).click()
    await page.getByRole('button', { name: 'Pin navigator' }).click()

    await expect(sidebar(page)).toBeVisible()
    await expect(drawer(page)).toBeHidden()
    // The pin must hold after the dock settles, not only on the first render.
    await page.waitForTimeout(300)
    await expect(sidebar(page)).toBeVisible()
  })

  test('the canvas board route shows the chip and no sidebar', async ({
    page,
  }) => {
    await page.goto(CANVAS_URL)
    const chip = page.getByTestId('board-chip')
    await expect(chip).toBeVisible()
    await expect(chip.getByRole('heading', { name: 'E2E Canvas' })).toBeVisible()
    await expect(sidebar(page)).toHaveCount(0)
    await expect(
      chip.getByRole('button', { name: 'Show project navigator' }),
    ).toBeVisible()
  })
})

test.describe('Floating dock', () => {
  test('every dock control is visible and Area toggles aria-pressed', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const bar = dock(page)
    await expect(bar).toBeVisible()

    for (const name of [
      'Add Table',
      'Add Relationship',
      'Reference',
      'Add area',
      'Add comment',
      'Auto Layout',
      'Comments',
      'More tools',
    ]) {
      await expect(bar.getByRole('button', { name })).toBeVisible()
    }
    await expect(bar.getByTitle(/Search tables and columns/)).toBeVisible()
    await expect(bar.getByTitle(/^Zoom Out/)).toBeVisible()
    await expect(bar.getByTitle(/^Zoom In/)).toBeVisible()
    await expect(bar.getByTestId('zoom-menu-trigger')).toBeVisible()

    // The dock floats over the canvas, at the bottom centre.
    const box = await bar.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeGreaterThan(900)
    expect(Math.abs(box!.x + box!.width / 2 - 800)).toBeLessThan(40)

    const area = bar.getByRole('button', { name: 'Add area' })
    await expect(area).toHaveAttribute('aria-pressed', 'false')
    await area.click()
    await expect(area).toHaveAttribute('aria-pressed', 'true')
    await area.click()
    await expect(area).toHaveAttribute('aria-pressed', 'false')
  })

  test('More tools > Keys changes the table display', async ({ page }) => {
    await openWhiteboard(page)
    const users = tableNode(page, 'users').first()
    const before = await users.boundingBox()
    expect(before).not.toBeNull()

    await waitForMenusClosed(page)
    await page.getByRole('button', { name: 'More tools' }).click()
    await page.getByRole('menuitemradio', { name: 'Keys' }).click()
    await waitForMenusClosed(page)

    // KEY_ONLY drops the non-key `email` row, so the table gets shorter.
    await expect
      .poll(async () => (await users.boundingBox())?.height ?? Infinity)
      .toBeLessThan(before!.height)
    expect(
      await page.evaluate(() => localStorage.getItem('whiteboard-display-mode')),
    ).toBe('KEY_ONLY')

    await page.getByRole('button', { name: 'More tools' }).click()
    await expect(
      page.getByRole('menuitemradio', { name: 'Keys' }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await waitForMenusClosed(page)
  })

  test('More tools > Version history opens the panel', async ({ page }) => {
    await openWhiteboard(page)
    await clickMoreTool(page, 'Version history')
    await expect(
      page.getByRole('heading', { name: 'Version History' }),
    ).toBeVisible()
  })

  test('zoom menu > Fit to screen changes the % label', async ({ page }) => {
    await openWhiteboard(page)
    await page.getByTitle(/^Zoom In/).click()
    await page.getByTitle(/^Zoom In/).click()
    await page.getByTitle(/^Zoom In/).click()
    const zoomed = await settledZoomLabel(page)

    await clickZoomMenuItem(page, 'Fit to screen')
    // Fit animates for 200ms: wait for a value that differs and has stopped.
    const fitted = await settledZoomLabel(page, zoomed)
    expect(fitted).not.toBe(zoomed)
  })

  test('Zen mode hides the dock and chip, keeps zoom controls, and exits', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await expect(page.locator('.react-flow__controls')).toHaveCount(0)

    await clickMoreTool(page, 'Zen mode')
    await expect(dock(page)).toHaveCount(0)
    await expect(page.getByTestId('board-chip')).toHaveCount(0)
    // With the dock gone, React Flow's own zoom controls take over.
    await expect(page.locator('.react-flow__controls')).toBeVisible()

    await page.getByRole('button', { name: 'Exit Zen' }).click()
    await expect(dock(page)).toBeVisible()
    await expect(page.getByTestId('board-chip')).toBeVisible()
    await expect(page.locator('.react-flow__controls')).toHaveCount(0)
  })
})

test.describe('Lock canvas', () => {
  async function dragBy(page: Page, from: { x: number; y: number }, dx: number) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx / 2, from.y, { steps: 6 })
    await page.mouse.move(from.x + dx, from.y, { steps: 6 })
    await page.mouse.up()
  }

  test('a locked canvas pins areas and tables; unlocking frees them', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const area = page.locator('.react-flow__node-area').first()
    const table = tableNode(page, 'orders').first()
    await expect(area).toBeVisible()

    const areaBox = async () => (await area.boundingBox())!
    // A point inside the area, clear of its tables and resize handles.
    const areaGrip = async () => {
      const b = await areaBox()
      return { x: b.x + b.width - 40, y: b.y + b.height - 40 }
    }
    const tableGrip = async () => {
      const b = (await table.boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + 12 }
    }

    // A locked drag pans the whole canvas, so judge movement by the gap
    // between the table and the area, which only a node drag changes.
    const gap = async () =>
      (await table.boundingBox())!.x - (await areaBox()).x

    await clickZoomMenuItem(page, 'Lock canvas')
    const lockedGap = await gap()
    await dragBy(page, await areaGrip(), 80)
    expect(await gap()).toBeCloseTo(lockedGap, 0)
    await dragBy(page, await tableGrip(), 80)
    expect(await gap()).toBeCloseTo(lockedGap, 0)

    await clickZoomMenuItem(page, 'Unlock canvas')
    await dragBy(page, await areaGrip(), 80)
    await expect.poll(gap).toBeLessThan(lockedGap - 40)
    const areaMovedGap = await gap()
    await dragBy(page, await tableGrip(), 80)
    await expect.poll(gap).toBeGreaterThan(areaMovedGap + 40)
  })
})

test.describe('Viewer role', () => {
  test('a VIEWER cannot add tables but keeps Search, Comments and More tools', async ({
    browser,
  }) => {
    const page = await loginAsViewer(browser)
    await page.goto(`/whiteboard/${IDS.viewerWhiteboard}`)
    await expect(
      page.getByRole('heading', { name: 'E2E Viewer Whiteboard' }),
    ).toBeVisible()

    const bar = dock(page)
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Add Table' })).toBeDisabled()
    await expect(
      bar.getByRole('button', { name: 'Add Relationship' }),
    ).toBeDisabled()
    await expect(bar.getByTitle(/Search tables and columns/)).toBeEnabled()
    await expect(bar.getByRole('button', { name: 'Comments' })).toBeEnabled()
    await expect(bar.getByRole('button', { name: 'More tools' })).toBeEnabled()

    await page.context().close()
  })
})

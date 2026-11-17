// e2e/canvas-theme-toggle.spec.ts
// The node canvas must repaint with the current theme the moment the header
// theme switch flips, without a reload and without a pan/zoom. Before the fix
// the canvas redrew while <html> still carried the previous theme class, so it
// painted the previous theme's palette (light tables on a dark page, and the
// reverse after toggling back).
//
// The assertion reads one pixel from the table body on the <canvas> and
// compares it with the `--rf-table-bg` colour the page resolves right now, so
// it follows the palette instead of hard-coding it. Auth and seed data come
// from global-setup (storageState).
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const WB_URL = `/whiteboard/${IDS.whiteboard}`

// Canvas draws the table body (rows) only at or above this zoom
// (canvas-helpers.ts LOD_ZOOM_THRESHOLD = 0.35).
const BODY_MIN_ZOOM = 0.4

interface Sample {
  pixel: [number, number, number]
  expected: [number, number, number]
  htmlClass: string
}

/** One canvas pixel inside a table's first column row vs the live table bg. */
async function sampleTableBody(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="canvas-node-layer"]',
    )!
    const table = document.querySelector('[data-table-name="users"]')!
    const zoom = parseFloat(
      /scale\(([-\d.]+)\)/.exec(
        document.querySelector<HTMLElement>('.react-flow__viewport')!.style
          .transform,
      )![1],
    )
    const t = table.getBoundingClientRect()
    const c = canvas.getBoundingClientRect()
    const dpr = canvas.width / c.width
    // 4 px in from the left border, in the first row under the 34 px header.
    const x = Math.round((t.left - c.left + 4 * zoom) * dpr)
    const y = Math.round((t.top - c.top + (34 + 14) * zoom) * dpr)
    const d = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data
    const probe = document.createElement('span')
    probe.style.color = getComputedStyle(canvas.parentElement!)
      .getPropertyValue('--rf-table-bg')
      .trim()
    document.body.appendChild(probe)
    const rgb = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(getComputedStyle(probe).color)!
    probe.remove()
    return {
      pixel: [d[0], d[1], d[2]],
      expected: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      htmlClass: document.documentElement.className,
    }
  })
}

async function expectPalette(page: Page, theme: 'light' | 'dark') {
  // No reload and no pan/zoom between the toggle and this read; allow a frame
  // for the repaint to land.
  await expect
    .poll(async () => (await sampleTableBody(page)).htmlClass, {
      timeout: 5000,
    })
    .toBe(theme)
  await expect
    .poll(
      async () => {
        const s = await sampleTableBody(page)
        return s.pixel.join(',') === s.expected.join(',')
      },
      {
        timeout: 5000,
        message: `canvas table body should use the ${theme} palette`,
      },
    )
    .toBe(true)
  const s = await sampleTableBody(page)
  // Light table bg is brighter than dark table bg.
  const luma = s.pixel[0] + s.pixel[1] + s.pixel[2]
  if (theme === 'dark') expect(luma).toBeLessThan(300)
  else expect(luma).toBeGreaterThan(600)
}

async function zoomTo(page: Page, min: number, max: number) {
  const out = page.getByTitle('Zoom Out (Ctrl/Cmd + -)')
  const inn = page.getByTitle('Zoom In (Ctrl/Cmd + +)')
  for (let i = 0; i < 20; i++) {
    const z = await page.evaluate(() =>
      parseFloat(
        /scale\(([-\d.]+)\)/.exec(
          document.querySelector<HTMLElement>('.react-flow__viewport')!.style
            .transform,
        )![1],
      ),
    )
    if (z >= min && z <= max) return
    await (z > max ? out : inn).click()
    await page.waitForTimeout(250)
  }
  throw new Error(`could not reach zoom ${min}..${max}`)
}

test('canvas tables repaint with the theme on every toggle, with no reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light')
  })
  await page.goto(WB_URL)
  await expect(tableNode(page, 'users').first()).toBeVisible()
  const toggle = page.getByRole('switch', { name: /Switch to (dark|light)/i })

  for (const [min, max] of [
    [0.9, 1.1],
    [BODY_MIN_ZOOM, 0.7],
  ]) {
    await zoomTo(page, min, max)
    await expectPalette(page, 'light')
    await toggle.click()
    await expectPalette(page, 'dark')
    await toggle.click()
    await expectPalette(page, 'light')
  }

  // A reload keeps the stored theme and paints it too.
  await toggle.click()
  await expectPalette(page, 'dark')
  await page.reload()
  await expect(tableNode(page, 'users').first()).toBeVisible()
  await expectPalette(page, 'dark')
})

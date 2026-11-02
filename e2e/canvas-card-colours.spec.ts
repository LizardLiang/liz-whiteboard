// e2e/canvas-card-colours.spec.ts
// End-to-end coverage for the card colour ramps: connectors coloured at rest in
// their target's colour, the 11 presets, the custom colour picker, the lit
// line width and the light-theme mirror.
//
// Canvas content has no DOM, so every case reads pixels from the 2D context.
// Pixel probes are POLLED: React state settles a frame before the canvas
// repaints.
//
// Board: the diagram-style seed (ellipse start -> A -> B -> C, default styles,
// no board settings, so the board opens in the `card` style).
//
// SEEDING ORDER — seed-canvas.ts creates the project this board lives in, and
// its ProjectMember insert needs the viewer user from seed-stress.ts.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasStyleBoard}`
const RECT_A = { x: 560, y: 290, width: 200, height: 120 }
const RECT_B = { x: 860, y: 290, width: 200, height: 120 }
/** Midpoint of the A -> B connector (both shapes' centres sit at y = 350). */
const CONN_AB = { x: 810, y: 350 }

// Dark slate ramp: line #696e77, body #484e54. Cyan: line #00a2c7, dark body
// #0b6a82, light body #caf1f6.
const SLATE_LINE = [105, 110, 119]
const SLATE_BODY = [72, 78, 84]
const CYAN_LINE = [0, 162, 199]
const CYAN_DARK_BODY = [11, 106, 130]
const CYAN_LIGHT_BODY = [202, 241, 246]
const TOLERANCE = 10

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(async ({ page }) => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
  execFileSync('bun', ['run', 'e2e/seed-diagram-style.ts'], {
    stdio: 'inherit',
  })
  await page.addInitScript(() => {
    localStorage.setItem('theme', localStorage.getItem('e2eTheme') ?? 'dark')
  })
})

async function engine(page: Page) {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as {
    elements: Array<{ id: string; style: Record<string, unknown> }>
    camera: { x: number; y: number; zoom: number }
  }
}

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function pixelAtWorld(page: Page, world: { x: number; y: number }) {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return null
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const x = Math.round((target.x - view.x) * view.zoom * ratio)
      const y = Math.round((target.y - view.y) * view.zoom * ratio)
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null
      const d = ctx.getImageData(x, y, 1, 1).data
      return [d[0], d[1], d[2], d[3]]
    },
    { target: world, view: camera },
  )
}

/** The fully opaque pixel closest to `world`, scanning 4 device pixels sideways. */
async function opaquePixelAcross(page: Page, world: { x: number; y: number }) {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return null
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const cx = Math.round((target.x - view.x) * view.zoom * ratio)
      const cy = Math.round((target.y - view.y) * view.zoom * ratio)
      for (let dx = 0; dx <= 4; dx += 1) {
        for (const sign of [1, -1]) {
          const d = ctx.getImageData(cx + sign * dx, cy, 1, 1).data
          if (d[3] === 255) return [d[0], d[1], d[2], d[3]]
        }
      }
      return null
    },
    { target: world, view: camera },
  )
}

/**
 * Largest per-channel distance between `colour` and the closest opaque pixel
 * within 4 device pixels of `world`. A thin line is anti-aliased, so one exact
 * pixel may miss the line's core.
 */
async function lineDistance(
  page: Page,
  world: { x: number; y: number },
  colour: Array<number>,
) {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view, want }) => {
      const c = document.querySelector('canvas')
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return 999
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const cx = Math.round((target.x - view.x) * view.zoom * ratio)
      const cy = Math.round((target.y - view.y) * view.zoom * ratio)
      let best = 999
      for (let dy = -4; dy <= 4; dy += 1) {
        const d = ctx.getImageData(cx, cy + dy, 1, 1).data
        if (d[3] < 240) continue
        const gap = Math.max(
          Math.abs(d[0] - want[0]),
          Math.abs(d[1] - want[1]),
          Math.abs(d[2] - want[2]),
        )
        best = Math.min(best, gap)
      }
      return best
    },
    { target: world, view: camera, want: colour },
  )
}

/** Summed alpha (in CSS pixels) of a vertical strip through `world`. */
async function strokeThickness(page: Page, world: { x: number; y: number }) {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return 0
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const cx = Math.round((target.x - view.x) * view.zoom * ratio)
      const cy = Math.round((target.y - view.y) * view.zoom * ratio)
      const half = Math.round(10 * ratio)
      const strip = ctx.getImageData(cx, cy - half, 1, half * 2 + 1).data
      let sum = 0
      for (let i = 3; i < strip.length; i += 4) sum += strip[i] / 255
      return sum / ratio
    },
    { target: world, view: camera },
  )
}

function near(px: Array<number> | null, want: Array<number>) {
  if (!px || px[3] !== 255) return false
  return want.every((v, i) => Math.abs(px[i] - v) <= TOLERANCE)
}

/** A point inside a card but clear of its centred text and the round corners. */
const insideCorner = (r: { x: number; y: number; height: number }) => ({
  x: r.x + 24,
  y: r.y + r.height - 20,
})

/** Select a card, then open the Fill popover of the selection toolbar. */
async function openFill(page: Page, card: typeof RECT_A) {
  const click = await worldToPage(page, insideCorner(card))
  await page.mouse.click(click.x, click.y)
  const bar = page.getByRole('toolbar', { name: 'Selection' })
  await bar.getByRole('button', { name: 'Fill', exact: true }).click()
}

async function pointerAway(page: Page) {
  const away = await worldToPage(page, { x: 100, y: 800 })
  await page.mouse.move(away.x, away.y)
}

async function reloadUntilFill(page: Page, id: string, fill: string) {
  await expect(async () => {
    await page.reload()
    await page.waitForFunction(() => window.__canvasEngine !== undefined)
    const element = (await engine(page)).elements.find((e) => e.id === id)!
    expect(element.style.fill).toBe(fill)
  }).toPass({ timeout: 15_000 })
}

test('an unstyled card and its connector are slate at rest, without hover', async ({
  page,
}) => {
  await openBoard(page)
  await pointerAway(page)

  await expect
    .poll(async () =>
      near(await pixelAtWorld(page, insideCorner(RECT_A)), SLATE_BODY),
    )
    .toBe(true)
  await expect
    .poll(async () => lineDistance(page, CONN_AB, SLATE_LINE))
    .toBeLessThanOrEqual(TOLERANCE)
})

test('a Cyan fill colours the card and the line pointing at it, and survives reload and the light theme', async ({
  page,
}) => {
  await openBoard(page)
  await openFill(page, RECT_B)
  await page.getByRole('button', { name: 'Fill Cyan' }).click()
  await page.keyboard.press('Escape')
  await reloadUntilFill(page, IDS.canvasStyleRectB, '#00a2c7')
  await pointerAway(page)

  await expect
    .poll(async () =>
      near(await pixelAtWorld(page, insideCorner(RECT_B)), CYAN_DARK_BODY),
    )
    .toBe(true)
  await expect
    .poll(async () => lineDistance(page, CONN_AB, CYAN_LINE))
    .toBeLessThanOrEqual(TOLERANCE)

  await openFill(page, RECT_B)
  await expect(page.getByRole('button', { name: 'Fill Cyan' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Escape')

  // Light theme mirrors the hue with the Radix light step 4 body.
  await page.evaluate(() => localStorage.setItem('e2eTheme', 'light'))
  await page.reload()
  await page.waitForFunction(() => window.__canvasEngine !== undefined)
  await pointerAway(page)
  await expect
    .poll(async () =>
      near(await pixelAtWorld(page, insideCorner(RECT_B)), CYAN_LIGHT_BODY),
    )
    .toBe(true)
})

test('a custom fill at 60% opacity paints a see-through card with an opaque border', async ({
  page,
}) => {
  await openBoard(page)
  await openFill(page, RECT_A)
  await page.getByRole('button', { name: 'Custom fill colour' }).click()
  await page.getByRole('textbox', { name: 'Custom fill hex' }).fill('#12ab34')
  const slider = page.getByRole('slider')
  await slider.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('PageUp')
  await expect(page.getByText('40%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.keyboard.press('Escape')
  await reloadUntilFill(page, IDS.canvasStyleRectA, 'rgba(18, 171, 52, 0.60)')
  await pointerAway(page)

  // Body: green-led and see-through (alpha about 0.6 of 255).
  await expect
    .poll(async () => {
      const px = await pixelAtWorld(page, insideCorner(RECT_A))
      return px ? px[3] > 120 && px[3] < 190 && px[1] > px[0] : false
    })
    .toBe(true)
  // Border: a fully opaque green-led pixel sits on the left edge.
  await expect
    .poll(async () => {
      const edge = { x: RECT_A.x, y: RECT_A.y + RECT_A.height / 2 }
      const px = await opaquePixelAcross(page, edge)
      return px ? px[1] > px[0] && px[1] > px[2] : false
    })
    .toBe(true)

  await openFill(page, RECT_A)
  await expect(
    page.getByRole('button', { name: 'Custom fill colour' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('hovering a card thickens the lines on its flow path', async ({
  page,
}) => {
  await openBoard(page)
  await pointerAway(page)
  const probes = [
    { x: 780, y: 350 },
    { x: 840, y: 350 },
  ]
  await expect
    .poll(async () => lineDistance(page, CONN_AB, SLATE_LINE))
    .toBeLessThanOrEqual(TOLERANCE)
  const rest = Math.min(
    ...(await Promise.all(probes.map((p) => strokeThickness(page, p)))),
  )

  const over = await worldToPage(page, insideCorner(RECT_B))
  await page.mouse.move(over.x, over.y, { steps: 5 })
  await expect
    .poll(async () =>
      Math.min(
        ...(await Promise.all(probes.map((p) => strokeThickness(page, p)))),
      ),
    )
    .toBeGreaterThan(rest * 1.15)
})

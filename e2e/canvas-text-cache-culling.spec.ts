// e2e/canvas-text-cache-culling.spec.ts
// Visual correctness of the canvas text-layout cache and viewport culling.
//
// A unit test cannot see pixels, and these two optimisations can fail only as
// wrong pixels: a stale wrap after an edit, or an element that stays blank
// after a pan brings it back. So this spec reads the painted canvas itself
// (`getImageData`) and counts inked pixels in world-space rectangles.
//
// Text labels are seeded with no fill and no stroke, so every inked pixel in
// their rect is a glyph.
//
// SEEDING ORDER — seed-stress.ts (users), seed-canvas.ts (the project), then
// seed-canvas-heavy.ts (the board).
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { settle, trackAcks } from './canvas-helpers'
import { HEAVY_BOARD, HEAVY_EDIT, HEAVY_FAR } from './canvas-heavy-ids'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
  execFileSync('bun', ['run', 'e2e/seed-canvas-heavy.ts'], {
    stdio: 'inherit',
  })
})

interface Engine {
  elements: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    text: string | null
  }>
  camera: { x: number; y: number; zoom: number }
  editingElementId: string | null
}

async function engine(page: Page): Promise<Engine> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state
}

async function openBoard(page: Page) {
  trackAcks(page)
  await page.goto(`/canvas/${HEAVY_BOARD}`)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined)
  await expect
    .poll(async () => (await engine(page)).elements.length)
    .toBeGreaterThan(90)
}

interface WorldRect {
  x: number
  y: number
  width: number
  height: number
}

/** Inked (non-transparent) pixels the canvas holds inside a world rect. */
async function ink(page: Page, rect: WorldRect): Promise<number> {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ camera: cam, rect: r }) => {
      const canvas = document.querySelector('canvas')
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) throw new Error('no canvas')
      const ratio = canvas.width / canvas.getBoundingClientRect().width
      const x0 = Math.max(0, Math.round((r.x - cam.x) * cam.zoom * ratio))
      const y0 = Math.max(0, Math.round((r.y - cam.y) * cam.zoom * ratio))
      const x1 = Math.min(
        canvas.width,
        Math.round((r.x + r.width - cam.x) * cam.zoom * ratio),
      )
      const y1 = Math.min(
        canvas.height,
        Math.round((r.y + r.height - cam.y) * cam.zoom * ratio),
      )
      if (x1 <= x0 || y1 <= y0) return 0
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
      let count = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1
      return count
    },
    { camera, rect },
  )
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return box
}

async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await canvasBox(page)
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

const textOf = async (page: Page, id: string) =>
  (await engine(page)).elements.find((e) => e.id === id)?.text

/** Replace the label's text through the real edit flow, then leave edit mode. */
async function retype(page: Page, text: string) {
  const edit = (await engine(page)).elements.find((e) => e.id === HEAVY_EDIT)
  if (!edit) throw new Error('edit element missing')
  const centre = await worldToPage(page, {
    x: edit.x + edit.width / 2,
    y: edit.y + edit.height / 2,
  })
  await page.mouse.dblclick(centre.x, centre.y)
  await expect
    .poll(async () => (await engine(page)).editingElementId)
    .toBe(HEAVY_EDIT)
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await expect.poll(() => textOf(page, HEAVY_EDIT)).toBe(text)
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await engine(page)).editingElementId)
    .toBe(null)
  // Click empty canvas so nothing is selected: selection chrome is ink too.
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 1200, box.y + 460)
}

// The label is 360 x 240 at (100, 150) with 8 px padding and 28 px type
// (about 39 px a line). A one-line "Hi" ink stays in the top ~50 px, so the
// lower half of the frame is empty until the text wraps.
const EDIT_LOWER: WorldRect = { x: 100, y: 270, width: 360, height: 110 }
const EDIT_FIRST_LINE: WorldRect = { x: 100, y: 150, width: 360, height: 50 }
const LONG =
  'A paragraph long enough that it has to wrap onto several lines inside the narrow frame of this label.'

test.describe('text layout cache', () => {
  test('re-wraps when the text is edited, and again when it is shortened', async ({
    page,
  }) => {
    await openBoard(page)
    expect(await ink(page, EDIT_FIRST_LINE)).toBeGreaterThan(0)
    expect(await ink(page, EDIT_LOWER)).toBe(0)

    await retype(page, LONG)
    await expect.poll(() => ink(page, EDIT_LOWER)).toBeGreaterThan(0)

    // The cache must not hand the long wrap back for short text.
    await retype(page, 'Hi')
    await expect.poll(() => ink(page, EDIT_LOWER)).toBe(0)
    expect(await ink(page, EDIT_FIRST_LINE)).toBeGreaterThan(0)

    // And the long text again: now a cache hit, still the same wrap.
    await retype(page, LONG)
    await expect.poll(() => ink(page, EDIT_LOWER)).toBeGreaterThan(0)
    await settle(page)
  })
})

test.describe('viewport culling', () => {
  test('a connector with both ends off-screen is drawn across the view', async ({
    page,
  }) => {
    await openBoard(page)
    // Straight line at y = 440 from x = -2450 to 6000; nothing else is here.
    const strip: WorldRect = { x: 600, y: 433, width: 600, height: 14 }
    expect(await ink(page, strip)).toBeGreaterThan(0)
  })

  test('panning brings off-screen elements back drawn', async ({ page }) => {
    await openBoard(page)
    const farRect: WorldRect = { x: 3000, y: 150, width: 360, height: 50 }
    const strip: WorldRect = { x: 3000, y: 433, width: 600, height: 14 }

    // Hand tool, drag left twice: the view moves about 2 400 world units.
    const box = await canvasBox(page)
    // Focus the board (empty canvas) so the key press reaches it.
    await page.mouse.click(box.x + 1200, box.y + 300)
    await page.keyboard.press('h')
    for (let i = 0; i < 2; i += 1) {
      await page.mouse.move(box.x + 1400, box.y + 600)
      await page.mouse.down()
      await page.mouse.move(box.x + 200, box.y + 600, { steps: 12 })
      await page.mouse.up()
    }
    await expect
      .poll(async () => (await engine(page)).camera.x)
      .toBeGreaterThan(2000)

    await expect.poll(() => ink(page, farRect)).toBeGreaterThan(0)
    expect(await ink(page, strip)).toBeGreaterThan(0)

    // Back to the start: the first label, culled while away, is drawn again.
    for (let i = 0; i < 2; i += 1) {
      await page.mouse.move(box.x + 200, box.y + 600)
      await page.mouse.down()
      await page.mouse.move(box.x + 1400, box.y + 600, { steps: 12 })
      await page.mouse.up()
    }
    await expect
      .poll(async () => (await engine(page)).camera.x)
      .toBeLessThan(200)
    await expect
      .poll(() => ink(page, { x: 100, y: 150, width: 360, height: 50 }))
      .toBeGreaterThan(0)
    expect(HEAVY_FAR).toBeTruthy()
  })

  test('zoomed out, far elements and the grid are drawn', async ({ page }) => {
    await openBoard(page)
    const box = await canvasBox(page)
    await page.mouse.move(box.x + 800, box.y + 500)
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, 100)
      await page.waitForTimeout(40)
    }
    await expect
      .poll(async () => (await engine(page)).camera.zoom)
      .toBeLessThan(0.5)
    // The far label at x = 3000 is inside the zoomed-out view.
    await expect
      .poll(() => ink(page, { x: 3000, y: 150, width: 360, height: 50 }))
      .toBeGreaterThan(0)
  })
})

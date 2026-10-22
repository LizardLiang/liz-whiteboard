// e2e/canvas-text-range-style.spec.ts
// End-to-end coverage for per-range text styling while a canvas label is being
// edited: Ctrl+B on a word, a colour from the text bar, a larger size that
// makes a taller line (and a click that still lands on the right caret), a
// pending style that applies to the next typed characters, deleting across a
// styled run, and a whole-label pick that clears a range override.
//
// Mechanics mirror e2e/canvas-text-selection.spec.ts (the engine is read
// through `window.__canvasEngine`, world points go through the engine's OWN
// camera, seeding shells out to `bun run e2e/seed-*.ts`, viewport >= 1600px).
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so each persisted result is asserted after
// a reload; that proves real persistence, not a dev-only broadcast. The dev
// server must be restarted after a schema change (`bun run dev:server`),
// because the running process holds the old `style` schema.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`
const TEXT = IDS.canvasText

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

interface Run {
  start: number
  end: number
  fontWeight?: string
  fontStyle?: string
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number
  color?: string
}

interface EngineElement {
  id: string
  x: number
  y: number
  width: number
  height: number
  text: string | null
  style: { fontWeight: string; textRuns: Array<Run> }
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  editingElementId: string | null
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

async function elementById(page: Page, id: string): Promise<EngineElement> {
  const found = (await engine(page)).elements.find((e) => e.id === id)
  if (!found) throw new Error(`element ${id} is not in the scene`)
  return found
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

const runsOf = async (page: Page) =>
  (await elementById(page, TEXT)).style.textRuns
const textOf = async (page: Page) => (await elementById(page, TEXT)).text
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Text styling' })

/** Open the seeded label for typing and replace its text. */
async function editWith(page: Page, text: string) {
  const element = await elementById(page, TEXT)
  const centre = await worldToPage(page, {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  })
  await page.mouse.dblclick(centre.x, centre.y)
  await expect
    .poll(async () => (await engine(page)).editingElementId)
    .toBe(TEXT)
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await expect.poll(() => textOf(page)).toBe(text)
}

/** Put the caret at `from`, then select through `to` (single-line or by arrows). */
async function select(page: Page, from: number, to: number) {
  // Walk far enough left to reach offset 0, then right to `from`.
  for (let i = 0; i < 200; i += 1) await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < from; i += 1) await page.keyboard.press('ArrowRight')
  for (let i = from; i < to; i += 1)
    await page.keyboard.press('Shift+ArrowRight')
}

async function commitAndReload(page: Page) {
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await engine(page)).editingElementId)
    .toBeNull()
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForFunction(() => window.__canvasEngine !== undefined)
}

test.describe('per-range text styling', () => {
  test('Ctrl+B bolds one word and it persists', async ({ page }) => {
    await openBoard(page)
    await editWith(page, 'one two three')
    await select(page, 4, 7)
    await page.keyboard.press('Control+b')
    await expect
      .poll(() => runsOf(page))
      .toEqual([{ start: 4, end: 7, fontWeight: 'bold' }])
    expect(await textOf(page)).toBe('one two three')

    await commitAndReload(page)
    expect(await runsOf(page)).toEqual([
      { start: 4, end: 7, fontWeight: 'bold' },
    ])
    expect(await textOf(page)).toBe('one two three')
  })

  test('the bar colours a range, stays above the label, and persists', async ({
    page,
  }) => {
    await openBoard(page)
    await editWith(page, 'one two three')
    await expect(bar(page)).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Selection' })).toHaveCount(
      0,
    )

    // The bar sits entirely above the element, so it cannot cover the label.
    const element = await elementById(page, TEXT)
    const top = await worldToPage(page, { x: element.x, y: element.y })
    const barBox = await bar(page).boundingBox()
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(top.y)

    await select(page, 4, 7)
    await bar(page).getByRole('button', { name: 'Text color Red' }).click()
    await expect
      .poll(() => runsOf(page))
      .toEqual([{ start: 4, end: 7, color: '#ef4444' }])
    // Focus stayed in the text: the edit is still open and typing still lands.
    expect((await engine(page)).editingElementId).toBe(TEXT)

    await commitAndReload(page)
    expect(await runsOf(page)).toEqual([{ start: 4, end: 7, color: '#ef4444' }])
  })

  test('XL on one word makes a taller line and a click still lands on the right caret', async ({
    page,
  }) => {
    await openBoard(page)
    await editWith(page, 'one two three\nsecond')
    await select(page, 4, 7)
    await bar(page).getByRole('button', { name: 'Text size XL' }).click()
    await expect
      .poll(() => runsOf(page))
      .toEqual([{ start: 4, end: 7, fontSize: 36 }])

    // The box grew to hold the taller line while editing: line 0 is 50.4,
    // line 1 is 22.4, plus 8 padding top and bottom.
    const laidOutHeight = 36 * 1.4 + 16 * 1.4 + 16
    await expect
      .poll(async () => (await elementById(page, TEXT)).height)
      .toBeGreaterThanOrEqual(laidOutHeight - 0.5)

    // The label block is taller than its box, so it starts at the box top plus
    // padding (8). Line 0 is now 36 * 1.4 = 50.4 tall, so 35 units down is
    // still line 0; at the old 22.4 it would be line 1.
    const element = await elementById(page, TEXT)
    const point = await worldToPage(page, {
      x: element.x + element.width - 12,
      y: element.y + 8 + 35,
    })
    await page.mouse.click(point.x, point.y)
    await page.keyboard.type('#')
    await expect.poll(() => textOf(page)).toBe('one two three#\nsecond')

    await commitAndReload(page)
    expect(await runsOf(page)).toEqual([{ start: 4, end: 7, fontSize: 36 }])
    expect((await elementById(page, TEXT)).height).toBeGreaterThanOrEqual(
      laidOutHeight - 0.5,
    )
  })

  test('a pending bold applies to the next typed characters only', async ({
    page,
  }) => {
    await openBoard(page)
    await editWith(page, 'ab')
    await page.keyboard.press('Control+b')
    // Nothing is written until text arrives.
    expect(await runsOf(page)).toEqual([])
    await page.keyboard.type('cd')
    await expect.poll(() => textOf(page)).toBe('abcd')
    await expect
      .poll(() => runsOf(page))
      .toEqual([{ start: 2, end: 4, fontWeight: 'bold' }])

    await commitAndReload(page)
    expect(await runsOf(page)).toEqual([
      { start: 2, end: 4, fontWeight: 'bold' },
    ])
  })

  test('deleting across a styled run shrinks it and keeps the rest aligned', async ({
    page,
  }) => {
    await openBoard(page)
    await editWith(page, 'abcdef')
    await select(page, 1, 3)
    await page.keyboard.press('Control+b')
    await select(page, 2, 5)
    await page.keyboard.press('Backspace')
    await expect.poll(() => textOf(page)).toBe('abf')
    await expect
      .poll(() => runsOf(page))
      .toEqual([{ start: 1, end: 2, fontWeight: 'bold' }])

    await commitAndReload(page)
    expect(await textOf(page)).toBe('abf')
    expect(await runsOf(page)).toEqual([
      { start: 1, end: 2, fontWeight: 'bold' },
    ])
  })

  test('a whole-label Bold clears a range override', async ({ page }) => {
    await openBoard(page)
    await editWith(page, 'one two')
    await select(page, 0, 3)
    await page.keyboard.press('Control+b')
    await expect.poll(() => runsOf(page)).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .toBeNull()
    await page.waitForTimeout(1500)

    // Back on the board with the label selected, Ctrl+B styles the whole label.
    const element = await elementById(page, TEXT)
    const centre = await worldToPage(page, {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    })
    await page.mouse.click(centre.x, centre.y)
    await page.keyboard.press('Control+b')
    await expect
      .poll(async () => (await elementById(page, TEXT)).style.fontWeight)
      .toBe('bold')
    expect(await runsOf(page)).toEqual([])

    await page.waitForTimeout(1500)
    await page.reload()
    await page.waitForFunction(() => window.__canvasEngine !== undefined)
    expect((await elementById(page, TEXT)).style.fontWeight).toBe('bold')
    expect(await runsOf(page)).toEqual([])
  })
})

// e2e/canvas-text-todo.spec.ts
// End-to-end coverage for todo lines in canvas text: the "[] " / "[x] "
// shortcuts, Enter continuing a list and ending it on an empty todo, a click on
// a box ticking it outside edit mode (and only placing the caret while
// editing), and the checklist buttons of both toolbars.
//
// Mechanics mirror e2e/canvas-text-range-style.spec.ts (the engine is read
// through `window.__canvasEngine`, world points go through the engine's OWN
// camera, seeding shells out to `bun run e2e/seed-*.ts`, viewport >= 1600px).
//
// DEV/PROD - canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so each persisted result is asserted after
// a reload; that proves real persistence, not a dev-only broadcast.
//
// Box geometry: the seeded label is a left/top aligned text element with a
// 16px font. Its first line starts 8 units (TEXT_PADDING) below the element
// top, line height is 22.4, and the box is 14.4 square starting 1.6 below the
// line top and 8 units in from the left edge. The click lands at the box centre.
//
// Read-only boards cannot toggle: that gate is the same `readOnly` early
// return every canvas write uses, covered by the unit test in
// src/components/canvas/use-canvas-input.test.ts.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`
const TEXT = IDS.canvasText

const LINE_HEIGHT = 22.4
const BOX_CENTRE_X = 8 + 7.2
const BOX_CENTRE_Y = 8 + 1.6 + 7.2

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

interface EngineElement {
  id: string
  x: number
  y: number
  width: number
  height: number
  text: string | null
  style: { textRuns: Array<unknown> }
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
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

const textOf = async (page: Page) => (await elementById(page, TEXT)).text
const editingId = async (page: Page) => (await engine(page)).editingElementId
const selectionBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Selection' })
const editBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Text styling' })

/** Open the seeded label for typing and replace its text. */
async function editWith(page: Page, typed: string, text = typed) {
  const element = await elementById(page, TEXT)
  const centre = await worldToPage(page, {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  })
  await page.mouse.dblclick(centre.x, centre.y)
  await expect.poll(() => editingId(page)).toBe(TEXT)
  await page.keyboard.press('Control+a')
  if (typed.length > 0) await page.keyboard.type(typed)
  else await page.keyboard.press('Delete')
  await expect.poll(() => textOf(page)).toBe(text)
}

/** Click the centre of the todo box on line `line` (0-based). */
async function boxPoint(page: Page, line: number) {
  const element = await elementById(page, TEXT)
  return worldToPage(page, {
    x: element.x + BOX_CENTRE_X,
    y: element.y + BOX_CENTRE_Y + line * LINE_HEIGHT,
  })
}

async function commit(page: Page) {
  await page.keyboard.press('Escape')
  await expect.poll(() => editingId(page)).toBeNull()
}

async function reload(page: Page) {
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForFunction(() => window.__canvasEngine !== undefined)
}

/** Select the seeded label with a click far from its first-line box. */
async function selectLabel(page: Page) {
  const element = await elementById(page, TEXT)
  const point = await worldToPage(page, {
    x: element.x + element.width / 2,
    y: element.y + element.height - 6,
  })
  await page.mouse.click(point.x, point.y)
  await expect
    .poll(async () => (await engine(page)).selectedIds)
    .toEqual([TEXT])
}

test.describe('todo lines in canvas text', () => {
  test('shortcuts and Enter build a list that persists', async ({ page }) => {
    await openBoard(page)
    await editWith(page, '')
    await page.keyboard.type('[] buy milk')
    await page.keyboard.press('Enter')
    // A new line after a todo starts open.
    await expect.poll(() => textOf(page)).toBe('☐ buy milk\n☐ ')
    // Clear the continued marker, then the shortcut makes a done line.
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('[x] done')
    await expect.poll(() => textOf(page)).toBe('☐ buy milk\n☑ done')

    await commit(page)
    await reload(page)
    expect(await textOf(page)).toBe('☐ buy milk\n☑ done')
  })

  test('Enter on an empty todo line ends the list', async ({ page }) => {
    await openBoard(page)
    await editWith(page, '')
    await page.keyboard.type('[] one')
    await page.keyboard.press('Enter')
    await expect.poll(() => textOf(page)).toBe('☐ one\n☐ ')
    await page.keyboard.press('Enter')
    await expect.poll(() => textOf(page)).toBe('☐ one\n')
    await page.keyboard.type('plain')
    await expect.poll(() => textOf(page)).toBe('☐ one\nplain')
  })

  test('a text element grows to fit a list as it is typed', async ({
    page,
  }) => {
    await openBoard(page)
    const before = (await elementById(page, TEXT)).height
    await editWith(page, '')
    await page.keyboard.type('[] one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.type('three')
    // Three lines at a 22.4 line height plus padding outgrow the seeded box.
    await expect
      .poll(async () => (await elementById(page, TEXT)).height)
      .toBeGreaterThanOrEqual(3 * LINE_HEIGHT)
    expect((await elementById(page, TEXT)).height).toBeGreaterThan(before)

    await commit(page)
    await reload(page)
    expect((await elementById(page, TEXT)).height).toBeGreaterThanOrEqual(
      3 * LINE_HEIGHT,
    )
  })

  test('a box click outside edit mode ticks it and persists', async ({
    page,
  }) => {
    await openBoard(page)
    await editWith(page, '[] one', '☐ one')
    await commit(page)
    await expect.poll(() => textOf(page)).toBe('☐ one')

    const point = await boxPoint(page, 0)
    await page.mouse.click(point.x, point.y)
    await expect.poll(() => textOf(page)).toBe('☑ one')
    // The press is consumed: nothing got selected and no editor opened.
    expect((await engine(page)).selectedIds).toEqual([])
    expect(await editingId(page)).toBeNull()

    await reload(page)
    expect(await textOf(page)).toBe('☑ one')

    const again = await boxPoint(page, 0)
    await page.mouse.click(again.x, again.y)
    await expect.poll(() => textOf(page)).toBe('☐ one')
  })

  test('a double-click on a box does not open the editor', async ({ page }) => {
    await openBoard(page)
    await editWith(page, '[] one', '☐ one')
    await commit(page)

    const point = await boxPoint(page, 0)
    await page.mouse.dblclick(point.x, point.y)
    await page.waitForTimeout(300)
    expect(await editingId(page)).toBeNull()
  })

  test('a box click while editing only places the caret', async ({ page }) => {
    await openBoard(page)
    await editWith(page, '[] one', '☐ one')
    const point = await boxPoint(page, 0)
    await page.mouse.click(point.x, point.y)
    expect(await editingId(page)).toBe(TEXT)
    expect(await textOf(page)).toBe('☐ one')
    await page.keyboard.type('x')
    // The press placed a caret: the typed character lands inside the text and
    // no marker flipped.
    await expect.poll(() => textOf(page)).toMatch(/^(x☐ one|☐x one)$/)
  })

  test('the selection toolbar button adds and removes boxes', async ({
    page,
  }) => {
    await openBoard(page)
    await selectLabel(page)
    await selectionBar(page)
      .getByRole('button', { name: 'Text', exact: true })
      .click()
    const checklist = page
      .getByRole('group', { name: 'Style', exact: true })
      .getByRole('button', { name: 'Checklist', exact: true })
    await checklist.click()
    await expect.poll(() => textOf(page)).toBe('☐ seeded label')
    await expect(checklist).toHaveAttribute('aria-pressed', 'true')

    await reload(page)
    expect(await textOf(page)).toBe('☐ seeded label')

    await selectLabel(page)
    await selectionBar(page)
      .getByRole('button', { name: 'Text', exact: true })
      .click()
    await page
      .getByRole('group', { name: 'Style', exact: true })
      .getByRole('button', { name: 'Checklist', exact: true })
      .click()
    await expect.poll(() => textOf(page)).toBe('seeded label')
  })

  test('the edit bar button toggles the line under the caret', async ({
    page,
  }) => {
    await openBoard(page)
    await editWith(page, 'one')
    await editBar(page).getByRole('button', { name: 'Checklist' }).click()
    await expect.poll(() => textOf(page)).toBe('☐ one')
    expect(await editingId(page)).toBe(TEXT)
    await editBar(page).getByRole('button', { name: 'Checklist' }).click()
    await expect.poll(() => textOf(page)).toBe('one')
  })

  test('draws a box in place of the marker', async ({ page }) => {
    await openBoard(page)
    await editWith(page, '[] one', '☐ one')
    await commit(page)
    const point = await boxPoint(page, 0)
    // Move the pointer away, then read the canvas pixels around the box edge:
    // an open box is a stroked square, so its left edge is darker than the
    // inside of the box.
    await page.mouse.move(point.x + 400, point.y + 400)
    const element = await elementById(page, TEXT)
    const edge = await worldToPage(page, {
      x: element.x + 8,
      y: element.y + BOX_CENTRE_Y,
    })
    const dark = await page.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector('canvas')!
        const rect = canvas.getBoundingClientRect()
        const scale = canvas.width / rect.width
        const ctx = canvas.getContext('2d')!
        const read = (px: number) => {
          const [r, g, b, a] = ctx.getImageData(
            Math.round((px - rect.left) * scale),
            Math.round((y - rect.top) * scale),
            1,
            1,
          ).data
          return a === 0 ? 255 * 3 : r + g + b
        }
        let min = Infinity
        for (let dx = -2; dx <= 2; dx += 1) min = Math.min(min, read(x + dx))
        return { edge: min, inside: read(x + 7) }
      },
      { x: edge.x, y: edge.y },
    )
    expect(dark.edge).toBeLessThan(dark.inside)
  })
})

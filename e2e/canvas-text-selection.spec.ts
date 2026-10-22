// e2e/canvas-text-selection.spec.ts
// End-to-end coverage for selecting text while editing a canvas element's
// label: mouse drag, Shift+click / Shift+arrows, double-click a word, Ctrl+A,
// replace-on-type, and copy / cut through the clipboard events.
//
// Mechanics mirror e2e/canvas-text-align.spec.ts (the engine is read through
// `window.__canvasEngine`, world points go through the engine's OWN camera,
// seeding shells out to `bun run e2e/seed-*.ts`, viewport >= 1600px).
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so the persisted text is asserted after a
// reload; that proves real persistence, not a dev-only broadcast.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

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

/** Page point at (dx, dy) world units from an element's top-left corner. */
async function pointIn(page: Page, id: string, dx: number, dy: number) {
  const element = await elementById(page, id)
  return worldToPage(page, { x: element.x + dx, y: element.y + dy })
}

async function textOf(page: Page, id: string) {
  return (await elementById(page, id)).text
}

/** Double-click the element's centre, wait for the edit, return the text. */
async function startEditing(page: Page, id: string) {
  const element = await elementById(page, id)
  const centre = await pointIn(page, id, element.width / 2, element.height / 2)
  await page.mouse.dblclick(centre.x, centre.y)
  await expect.poll(async () => (await engine(page)).editingElementId).toBe(id)
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

test.describe('selecting text while editing', () => {
  test('Shift+Left selects, typing replaces, and the result persists', async ({
    page,
  }) => {
    await openBoard(page)
    await startEditing(page, IDS.canvasRect)
    await page.keyboard.type('hello world')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.type('there')
    await expect.poll(() => textOf(page, IDS.canvasRect)).toBe('hello there')

    await commitAndReload(page)
    expect(await textOf(page, IDS.canvasRect)).toBe('hello there')
  })

  test('a plain arrow collapses the selection instead of replacing it', async ({
    page,
  }) => {
    await openBoard(page)
    await startEditing(page, IDS.canvasRect)
    await page.keyboard.type('abcdef')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('-')
    await expect.poll(() => textOf(page, IDS.canvasRect)).toBe('abcd-ef')
  })

  test('dragging across the label selects it and Backspace removes it', async ({
    page,
  }) => {
    await openBoard(page)
    const element = await elementById(page, IDS.canvasText)
    expect(element.text).toBe('seeded label')

    // Enter the edit with a double-click, then drag from the left edge of the
    // box to well past the end of the single line.
    await startEditing(page, IDS.canvasText)
    const from = await pointIn(page, IDS.canvasText, 4, 14)
    const to = await pointIn(page, IDS.canvasText, element.width - 4, 14)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 6 })
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()

    // The press stayed inside the edited element, so the edit is still open.
    expect((await engine(page)).editingElementId).toBe(IDS.canvasText)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('fresh')
    await expect.poll(() => textOf(page, IDS.canvasText)).toBe('fresh')

    await commitAndReload(page)
    expect(await textOf(page, IDS.canvasText)).toBe('fresh')
  })

  test('double-clicking a word while editing selects just that word', async ({
    page,
  }) => {
    await openBoard(page)
    const element = await elementById(page, IDS.canvasText)
    await startEditing(page, IDS.canvasText)

    // Past the end of the line the caret lands at the end, which sits beside
    // the last word — so this double-click picks "label".
    const farRight = await pointIn(page, IDS.canvasText, element.width - 4, 14)
    await page.mouse.dblclick(farRight.x, farRight.y)
    expect((await engine(page)).editingElementId).toBe(IDS.canvasText)
    await page.keyboard.type('thing')
    await expect.poll(() => textOf(page, IDS.canvasText)).toBe('seeded thing')
  })

  test('Ctrl+A selects everything; Shift+click extends from the caret', async ({
    page,
  }) => {
    await openBoard(page)
    const element = await elementById(page, IDS.canvasText)
    await startEditing(page, IDS.canvasText)

    await page.keyboard.press('Control+A')
    await page.keyboard.type('new')
    await expect.poll(() => textOf(page, IDS.canvasText)).toBe('new')

    await page.keyboard.press('Control+A')
    await page.keyboard.type('abcdef')
    // Caret sits at the end; Shift+click at the box's left edge selects back
    // to the start of the line.
    const left = await pointIn(page, IDS.canvasText, 4, 14)
    await page.keyboard.down('Shift')
    await page.mouse.click(left.x, left.y)
    await page.keyboard.up('Shift')
    await page.keyboard.type('Q')
    await expect.poll(() => textOf(page, IDS.canvasText)).toBe('Q')
    expect(element.width).toBeGreaterThan(0)
  })

  test('copy puts the selection on the clipboard, cut also removes it', async ({
    page,
  }) => {
    await openBoard(page)
    // Record what the app puts on the clipboard. Registered on `document` so
    // it runs after the app's own handler on the text proxy.
    await page.evaluate(() => {
      const log: Array<{ type: string; data: string; prevented: boolean }> = []
      ;(window as unknown as { __clip: typeof log }).__clip = log
      for (const type of ['copy', 'cut'] as const) {
        document.addEventListener(type, (event) => {
          log.push({
            type,
            data: event.clipboardData?.getData('text/plain') ?? '',
            prevented: event.defaultPrevented,
          })
        })
      }
    })

    await startEditing(page, IDS.canvasRect)
    await page.keyboard.type('alpha beta')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')

    await page.keyboard.press('Control+C')
    await expect.poll(() => textOf(page, IDS.canvasRect)).toBe('alpha beta')
    await page.keyboard.press('Control+X')
    await expect.poll(() => textOf(page, IDS.canvasRect)).toBe('alpha ')

    const log = await page.evaluate(
      () => (window as unknown as { __clip: Array<unknown> }).__clip,
    )
    expect(log).toEqual([
      { type: 'copy', data: 'beta', prevented: true },
      { type: 'cut', data: 'beta', prevented: true },
    ])
    // Element copy/paste did not fire: still exactly the seeded elements.
    expect(
      await page.evaluate(() => window.__canvasEngine?.elements.length),
    ).toBe((await engine(page)).elements.length)
  })

  test('paints a highlight over the selected glyphs only while selected', async ({
    page,
  }) => {
    await openBoard(page)
    const element = await elementById(page, IDS.canvasText)
    await startEditing(page, IDS.canvasText)
    const origin = await pointIn(page, IDS.canvasText, 0, 0)
    // Caret blink would add noise to a pixel compare, so park it off-screen
    // of the clip by clipping to the first line's left half.
    const clip = {
      x: origin.x + 4,
      y: origin.y + 4,
      width: Math.min(40, element.width),
      height: 20,
    }
    await page.keyboard.press('Control+A')
    await page.waitForTimeout(100)
    const selected = await page.screenshot({ clip })
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(100)
    const collapsed = await page.screenshot({ clip })
    expect(selected.equals(collapsed)).toBe(false)
  })
})

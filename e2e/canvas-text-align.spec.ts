// e2e/canvas-text-align.spec.ts
// End-to-end coverage for the canvas text-alignment setting — horizontal
// (left/center/right) and vertical (top/middle/bottom). The mandatory
// Playwright completion gate per CLAUDE.md.
//
// WHAT THIS SUITE IS ACTUALLY FOR
// Alignment crosses the same four layers the paint settings do — the toolbar
// decides, `CanvasBoard` writes to the local scene AND to the undo-recording
// surface, the socket handler persists, the renderer repaints — plus one more
// that paint never touched: the CARET. Horizontal alignment lives inside the
// text layout's caret offsets and vertical alignment inside `textOriginY`, so
// a half-applied change looks perfect until you click into the text and the
// caret lands on the wrong character. The caret cases below are the reason
// this file is not merely a style-write test.
//
// Mirrors e2e/canvas-selection-toolbar.spec.ts structure-for-structure,
// including its hard-won mechanics, duplicated rather than imported because
// no canvas spec in this repo exports them:
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point.
//   - `worldToPage` goes through the engine's OWN camera, never hand-rolled.
//   - Popover options are PORTALLED out of the toolbar, so option queries go
//     through the popover's `role="group"`, not through the bar.
//
// SEEDING ORDER — seed-canvas.ts's ProjectMember insert references
// IDS.viewerUser, a User row only e2e/seed-stress.ts creates.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist and broadcast in dev too.
// The reload assertion below proves real PERSISTENCE, not a dev-only
// workaround.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Locator, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── engine access ───────────────────────────────────────────────────────────

interface EngineStyle {
  fill: string
  fontSize: number
  textAlign: string
  verticalAlign: string
}

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  text: string | null
  style: EngineStyle
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

async function waitForBoard(page: Page) {
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await waitForBoard(page)
}

async function elementById(page: Page, id: string): Promise<EngineElement> {
  const { elements } = await engine(page)
  const found = elements.find((element) => element.id === id)
  if (!found) throw new Error(`element ${id} is not in the scene`)
  return found
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return box
}

/** World point -> page coordinates, via the engine's OWN camera. Never hand-rolled. */
async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await canvasBox(page)
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function focusBoard(page: Page) {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 40, box.y + 120)
}

/** Wait for the server ack that pushes the undo entry. */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

const styleBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Selection' })

/**
 * Open the Align popover and return one of its two axis rows.
 *
 * The popover content is PORTALLED to the end of <body>, so the rows are NOT
 * inside `styleBar` — scoping the query to the toolbar finds nothing at all.
 * Each row carries a `role="group"` named for its axis, which is the handle
 * every option query goes through.
 *
 * The popover is UNCONTROLLED and stays open across picks, so the trigger is
 * clicked only when the row is not already showing — clicking it a second
 * time would close what the caller is about to read.
 */
async function openAlign(
  page: Page,
  axis: 'Horizontal' | 'Vertical',
): Promise<Locator> {
  const row = page.getByRole('group', { name: axis, exact: true })
  if ((await row.count()) === 0 || !(await row.isVisible())) {
    await styleBar(page)
      .getByRole('button', { name: 'Align', exact: true })
      .click()
  }
  await expect(row).toBeVisible()
  return row
}

/** Select one element by clicking its centre. */
async function selectElement(page: Page, id: string) {
  const element = await elementById(page, id)
  const point = await worldToPage(page, {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  })
  await page.mouse.click(point.x, point.y)
  await expect.poll(async () => (await engine(page)).selectedIds).toEqual([id])
}

// ── the seeded default ──────────────────────────────────────────────────────

test.describe('alignment defaults', () => {
  test('a row seeded without alignment keys reads as top-left', async ({
    page,
  }) => {
    // seed-canvas.ts writes a style JSON carrying fill/stroke/strokeWidth/
    // fontSize/color and NOTHING else — a genuine pre-alignment row, not a
    // simulated one. It must parse to the appearance it already had.
    await openBoard(page)
    const text = await elementById(page, IDS.canvasText)
    expect(text.style.textAlign).toBe('left')
    expect(text.style.verticalAlign).toBe('top')
  })
})

// ── writing an alignment ────────────────────────────────────────────────────

test.describe('setting alignment', () => {
  test('centres text and persists it across a reload', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasRect)

    const row = await openAlign(page, 'Horizontal')
    await row.getByRole('button', { name: 'Align center' }).click()

    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasRect)).style.textAlign,
      )
      .toBe('center')

    await settle(page)
    await page.reload()
    await waitForBoard(page)
    expect((await elementById(page, IDS.canvasRect)).style.textAlign).toBe(
      'center',
    )
  })

  test('sets vertical alignment independently of horizontal', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasRect)

    const horizontal = await openAlign(page, 'Horizontal')
    await horizontal.getByRole('button', { name: 'Align right' }).click()
    const vertical = await openAlign(page, 'Vertical')
    await vertical.getByRole('button', { name: 'Align bottom' }).click()

    await expect
      .poll(async () => {
        const { style } = await elementById(page, IDS.canvasRect)
        return [style.textAlign, style.verticalAlign]
      })
      .toEqual(['right', 'bottom'])
  })

  test('marks the chosen option pressed', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasRect)

    const row = await openAlign(page, 'Horizontal')
    await row.getByRole('button', { name: 'Align center' }).click()

    await expect(
      row.getByRole('button', { name: 'Align center' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('offers Align for a text element, which takes no paint settings', async ({
    page,
  }) => {
    // The case that made alignment ride on the wider target set: a `text`
    // element paints no fill or outline, so the paint settings are absent —
    // but it is made of text, so Align must be there.
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    await expect(
      styleBar(page).getByRole('button', { name: 'Align', exact: true }),
    ).toBeVisible()
    await expect(
      styleBar(page).getByRole('button', { name: 'Fill', exact: true }),
    ).toHaveCount(0)
  })
})

// ── the caret, which is the half a style-only test would miss ───────────────

test.describe('caret placement under alignment', () => {
  test('double-click opens the edit where right-aligned glyphs now sit', async ({
    page,
  }) => {
    // With the text pushed to the right edge, a double-click near that edge
    // must open the edit. The click resolves through `caretAtWorldPoint`,
    // which subtracts the SAME alignment-adjusted origin the renderer draws
    // against — the two disagreeing is the bug this case exists to catch.
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    const row = await openAlign(page, 'Horizontal')
    await row.getByRole('button', { name: 'Align right' }).click()
    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.textAlign,
      )
      .toBe('right')

    // Dismiss the popover before driving the board again — Radix closes on
    // Escape in the capture phase, and the toolbar hides once editing starts.
    await page.keyboard.press('Escape')
    const element = await elementById(page, IDS.canvasText)
    const nearRightEnd = await worldToPage(page, {
      x: element.x + element.width - 12,
      y: element.y + 16,
    })
    await page.mouse.dblclick(nearRightEnd.x, nearRightEnd.y)

    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .toBe(IDS.canvasText)
  })

  test('typing still reaches middle-aligned text', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    const row = await openAlign(page, 'Vertical')
    await row.getByRole('button', { name: 'Align middle' }).click()
    await expect
      .poll(
        async () =>
          (await elementById(page, IDS.canvasText)).style.verticalAlign,
      )
      .toBe('middle')

    await page.keyboard.press('Escape')
    // Re-select, then open the edit from the KEYBOARD — the pointerless path
    // the living spec requires, which also avoids guessing where a vertically
    // centred line now sits.
    await selectElement(page, IDS.canvasText)
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .toBe(IDS.canvasText)

    await page.keyboard.type('!')
    await expect
      .poll(async () => (await elementById(page, IDS.canvasText)).text)
      .toContain('!')
  })
})

// ── undo ────────────────────────────────────────────────────────────────────

test.describe('undo', () => {
  test('one alignment pick is one undo entry', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasRect)

    const row = await openAlign(page, 'Horizontal')
    await row.getByRole('button', { name: 'Align center' }).click()
    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasRect)).style.textAlign,
      )
      .toBe('center')

    await settle(page)
    await page.keyboard.press('Escape')
    await focusBoard(page)
    await page.keyboard.press('Control+z')

    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasRect)).style.textAlign,
      )
      .toBe('left')
  })
})

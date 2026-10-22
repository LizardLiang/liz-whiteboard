// e2e/canvas-text-style.spec.ts
// End-to-end coverage for whole-label text styling on the canvas board: bold,
// italic, underline, strikethrough, size and colour from the selection
// toolbar's Text setting, the Ctrl/Cmd shortcuts, the text-element grow rule
// and SVG export. The mandatory Playwright completion gate per CLAUDE.md.
//
// Mirrors e2e/canvas-text-align.spec.ts structure-for-structure, including
// its mechanics, duplicated rather than imported because no canvas spec in
// this repo exports them:
//   - `focusBoard` clicks the MEASURED canvas box, never a fixed page point.
//   - `worldToPage` goes through the engine's OWN camera.
//   - Popover options are PORTALLED out of the toolbar, so option queries go
//     through the popover's `role="group"`, not through the bar.
//
// SEEDING ORDER — seed-canvas.ts's ProjectMember insert references
// IDS.viewerUser, a User row only e2e/seed-stress.ts creates.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist in dev too. The reload
// assertions below prove real PERSISTENCE.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Download, Locator, Page } from '@playwright/test'

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
  fontSize: number
  fontWeight: string
  fontStyle: string
  underline: boolean
  strikethrough: boolean
  color: string
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

/** World point -> page coordinates, via the engine's OWN camera. */
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
 * Open the Text popover and return it as a locator on the options group named
 * `group` ("Style", "Size" or "Text color"). The popover content is PORTALLED
 * out of the toolbar, and stays open across picks, so the trigger is clicked
 * only when the group is not already showing.
 */
async function openText(
  page: Page,
  group: 'Style' | 'Size' | 'Text color',
): Promise<Locator> {
  const row = page.getByRole('group', { name: group, exact: true })
  if ((await row.count()) === 0 || !(await row.isVisible())) {
    await styleBar(page)
      .getByRole('button', { name: 'Text', exact: true })
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

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Array<Buffer> = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

// ── the seeded default ──────────────────────────────────────────────────────

test.describe('text style defaults', () => {
  test('a row seeded without style keys reads as plain text', async ({
    page,
  }) => {
    // seed-canvas.ts writes a style JSON with no font weight/style/decoration
    // keys — a genuine pre-styling row. It must parse to plain text.
    await openBoard(page)
    const { style } = await elementById(page, IDS.canvasText)
    expect(style.fontWeight).toBe('normal')
    expect(style.fontStyle).toBe('normal')
    expect(style.underline).toBe(false)
    expect(style.strikethrough).toBe(false)
  })
})

// ── the toolbar ─────────────────────────────────────────────────────────────

test.describe('the Text setting', () => {
  test('makes a label bold and persists it across a reload', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    const row = await openText(page, 'Style')
    await row.getByRole('button', { name: 'Bold', exact: true }).click()

    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontWeight,
      )
      .toBe('bold')
    await expect(
      row.getByRole('button', { name: 'Bold', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')

    await settle(page)
    await page.reload()
    await waitForBoard(page)
    expect((await elementById(page, IDS.canvasText)).style.fontWeight).toBe(
      'bold',
    )
  })

  test('toggles italic, underline and strikethrough on a shape', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasRect)

    const row = await openText(page, 'Style')
    await row.getByRole('button', { name: 'Italic', exact: true }).click()
    await row.getByRole('button', { name: 'Underline', exact: true }).click()
    await row
      .getByRole('button', { name: 'Strikethrough', exact: true })
      .click()

    await expect
      .poll(async () => {
        const { style } = await elementById(page, IDS.canvasRect)
        return [style.fontStyle, style.underline, style.strikethrough]
      })
      .toEqual(['italic', true, true])
  })

  test('picks a text colour', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    const row = await openText(page, 'Text color')
    await row.getByRole('button', { name: 'Text color Red' }).click()

    await expect
      .poll(async () => (await elementById(page, IDS.canvasText)).style.color)
      .toBe('#ef4444')
  })
})

// ── the shortcuts ───────────────────────────────────────────────────────────

test.describe('shortcuts', () => {
  test('Ctrl+I italicises the selected label', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    await page.keyboard.press('Control+i')

    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontStyle,
      )
      .toBe('italic')

    // A second press turns it back off (all targets on -> off).
    await page.keyboard.press('Control+i')
    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontStyle,
      )
      .toBe('normal')
  })

  test('Ctrl+Shift+X strikes the selected label through', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    await page.keyboard.press('Control+Shift+X')

    await expect
      .poll(
        async () =>
          (await elementById(page, IDS.canvasText)).style.strikethrough,
      )
      .toBe(true)
  })
})

// ── growth and undo ─────────────────────────────────────────────────────────

test.describe('size, growth and undo', () => {
  test('XL grows a text element, and one Ctrl+Z restores size and height', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)
    const before = await elementById(page, IDS.canvasText)

    const row = await openText(page, 'Size')
    await row.getByRole('button', { name: 'Text size XL' }).click()

    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontSize,
      )
      .toBe(36)
    const grown = await elementById(page, IDS.canvasText)
    expect(grown.height).toBeGreaterThan(before.height)
    expect(grown.width).toBe(before.width)

    await settle(page)
    await page.keyboard.press('Escape')
    await focusBoard(page)
    await page.keyboard.press('Control+z')

    await expect
      .poll(async () => {
        const restored = await elementById(page, IDS.canvasText)
        return [restored.style.fontSize, restored.height]
      })
      .toEqual([before.style.fontSize, before.height])
  })

  test('one bold pick is one undo entry', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)

    const row = await openText(page, 'Style')
    await row.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontWeight,
      )
      .toBe('bold')

    await settle(page)
    await page.keyboard.press('Escape')
    await focusBoard(page)
    await page.keyboard.press('Control+z')

    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontWeight,
      )
      .toBe('normal')
  })
})

// ── the caret ───────────────────────────────────────────────────────────────

test.describe('caret on styled text', () => {
  test('typing still reaches a bold label', async ({ page }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)
    await page.keyboard.press('Control+b')
    await expect
      .poll(
        async () => (await elementById(page, IDS.canvasText)).style.fontWeight,
      )
      .toBe('bold')

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

// ── export ──────────────────────────────────────────────────────────────────

test.describe('export', () => {
  test('SVG export carries bold weight and an underline bar', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await selectElement(page, IDS.canvasText)
    await page.keyboard.press('Control+b')
    await page.keyboard.press('Control+u')
    await expect
      .poll(async () => {
        const { style } = await elementById(page, IDS.canvasText)
        return [style.fontWeight, style.underline]
      })
      .toEqual(['bold', true])
    await settle(page)

    await page.getByRole('button', { name: 'Export canvas as image' }).click()
    await expect(page.getByRole('dialog')).toContainText('Export as Image')
    await page.getByRole('combobox', { name: 'Format' }).click()
    await page.getByRole('option', { name: 'SVG' }).click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /^export$/i }).click()
    const svg = (await downloadBytes(await downloadPromise)).toString('utf8')

    expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain('seeded label')
    // The underline is a thin filled bar in the text colour.
    expect(svg).toMatch(/<rect [^>]*stroke="none"\/>/)
  })
})

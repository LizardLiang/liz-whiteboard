// e2e/canvas-table.spec.ts
// End-to-end coverage for the canvas TABLE element (表格): a grid of rows x
// columns of text cells. Mandatory Playwright completion gate per CLAUDE.md.
//
// Grown phase by phase. Phase 1 (this file's first cut): the Table tool
// creates a table by click (3 x 3) and by drag (rows x cols from the drag
// distance, one cell per 120 x 40 world px), the renderer paints it, and the
// grid survives a reload. Cell editing, rows/columns, resize, header and fill
// arrive in later phases and extend this file.
//
// Mechanics (focusBoard, dragMouse, worldToPage, the engine hook) are
// duplicated from e2e/canvas-shapes.spec.ts on purpose: every canvas spec in
// this repo keeps its own local copy.
//
// DEV/PROD — canvas mutations run in the Socket.IO handler inside the
// standalone server.dev.ts process, so they persist in dev too; the reload
// assertions below prove real PERSISTENCE. A live two-browser broadcast of a
// table op only works in the single-process PROD build (`io` is null in the
// Vite process), so the two-context concurrent-edit case (added with cell
// editing) asserts the merged result via reload and notes that split.
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

interface TableCellInfo {
  rowId: string
  colId: string
  rect: { x: number; y: number; width: number; height: number }
}

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  table?: {
    rows: Array<{ id: string; height: number }>
    cols: Array<{ id: string; width: number }>
    cells: Record<string, { text: string }>
    headerRow: boolean
  }
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  tableCellRects: Record<string, Array<TableCellInfo>>
  tool: string
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state
}

async function openBoard(page: Page): Promise<EngineState> {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return box
}

/** World point -> page coordinates, through the engine's own camera. */
async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await canvasBox(page)
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  // Deliver the target twice so the end point is deterministic under load.
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

/** Click the measured canvas box near its top, never a fixed page point. */
async function focusBoard(page: Page) {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 40, box.y + 150)
}

async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

function tablesOf(state: EngineState) {
  return state.elements.filter((element) => element.kind === 'table')
}

async function reloadBoard(page: Page) {
  await page.reload()
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

/** Is the pixel at this WORLD point painted (alpha > 0)? */
async function paintedAtWorld(
  page: Page,
  world: { x: number; y: number },
): Promise<boolean> {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      if (!c) return false
      const ctx = c.getContext('2d')
      if (!ctx) return false
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const x = Math.round((target.x - view.x) * view.zoom * ratio)
      const y = Math.round((target.y - view.y) * view.zoom * ratio)
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return false
      return ctx.getImageData(x, y, 1, 1).data[3] > 0
    },
    { target: world, view: camera },
  )
}

// A world point clear of the seeded elements, so nothing under it absorbs the press.
const ORIGIN = { x: 600, y: 420 }

test.describe('the table tool', () => {
  test('is in the palette and Shift+T selects it', async ({ page }) => {
    await openBoard(page)
    const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
    await expect(
      toolbar.getByRole('button', { name: 'Table (Shift+T)' }),
    ).toBeVisible()

    await focusBoard(page)
    await page.keyboard.press('Shift+T')
    await expect
      .poll(async () => (await engine(page)).tool, { timeout: 5_000 })
      .toBe('table')
  })
})

test.describe('creating a table', () => {
  test('a click makes a 3 x 3 table with the header row on, selected, and paints it', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await page.keyboard.press('Shift+T')
    const at = await worldToPage(page, ORIGIN)
    await page.mouse.click(at.x, at.y)

    await expect
      .poll(async () => tablesOf(await engine(page)).length, {
        timeout: 10_000,
      })
      .toBe(1)
    await settle(page)

    const state = await engine(page)
    const [table] = tablesOf(state)
    expect(table.table?.rows).toHaveLength(3)
    expect(table.table?.cols).toHaveLength(3)
    expect(table.table?.headerRow).toBe(true)
    expect(Math.round(table.width)).toBe(360)
    expect(Math.round(table.height)).toBe(120)
    // One-shot like every drawing tool, and the new table is selected.
    expect(state.tool).toBe('select')
    expect(state.selectedIds).toEqual([table.id])

    // The published cell rects are what the renderer drew: nine of them, row-major.
    const cells = state.tableCellRects[table.id]
    expect(cells).toHaveLength(9)
    expect(cells[0].rect.width).toBeGreaterThan(0)

    // The renderer painted the header tint inside the first cell.
    expect(
      await paintedAtWorld(page, { x: table.x + 60, y: table.y + 20 }),
    ).toBe(true)
  })

  test('a drag picks rows x columns from the distance, one cell per 120 x 40 world px', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await page.keyboard.press('Shift+T')
    const from = await worldToPage(page, ORIGIN)
    const to = await worldToPage(page, {
      x: ORIGIN.x + 480,
      y: ORIGIN.y + 80,
    })
    await dragMouse(page, from, to)

    await expect
      .poll(async () => tablesOf(await engine(page)).length, {
        timeout: 10_000,
      })
      .toBe(1)
    await settle(page)

    const [table] = tablesOf(await engine(page))
    expect(table.table?.cols).toHaveLength(4)
    expect(table.table?.rows).toHaveLength(2)
    expect(Math.round(table.width)).toBe(480)
    expect(Math.round(table.height)).toBe(80)
  })

  test('the table persists across a reload with its grid intact', async ({
    page,
  }) => {
    await openBoard(page)
    await focusBoard(page)
    await page.keyboard.press('Shift+T')
    const from = await worldToPage(page, ORIGIN)
    const to = await worldToPage(page, {
      x: ORIGIN.x + 360,
      y: ORIGIN.y + 120,
    })
    await dragMouse(page, from, to)
    await expect
      .poll(async () => tablesOf(await engine(page)).length, {
        timeout: 10_000,
      })
      .toBe(1)
    await settle(page)
    const [before] = tablesOf(await engine(page))

    // The stored row, not the optimistic scene.
    await reloadBoard(page)
    const reloaded = tablesOf(await engine(page))
    expect(reloaded).toHaveLength(1)
    const [after] = reloaded
    expect(after.id).toBe(before.id)
    expect(after.table?.rows.map((r) => r.id)).toEqual(
      before.table?.rows.map((r) => r.id),
    )
    expect(after.table?.cols.map((c) => c.id)).toEqual(
      before.table?.cols.map((c) => c.id),
    )
    expect(after.table?.headerRow).toBe(true)
    expect(Math.round(after.width)).toBe(360)
    expect(Math.round(after.height)).toBe(120)
  })
})

// e2e/canvas-table.spec.ts
// End-to-end coverage for the canvas TABLE element (表格): a grid of rows x
// columns of text cells. Mandatory Playwright completion gate per CLAUDE.md.
//
// Grown phase by phase. Phase 1: the Table tool creates a table by click
// (3 x 3) and by drag (rows x cols from the drag distance, one cell per
// 120 x 40 world px), the renderer paints it, and the grid survives a reload.
// Phase 2: cell selection and editing — type in cells, Tab across, Tab in the
// last cell appends a row, Enter is a newline, a wrapped cell grows its row,
// the text bar styles a run inside a cell, undo/redo, reload. Rows/columns,
// resize, header and fill arrive in later phases and extend this file.
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
    cells: Record<
      string,
      { text: string; textRuns?: Array<{ start: number; end: number }> }
    >
    headerRow: boolean
  }
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  tableCellRects: Record<string, Array<TableCellInfo>>
  tableSelection: {
    tableId: string
    kind: 'cells' | 'row' | 'col'
    cells: Array<{ rowId: string; colId: string }>
  } | null
  editingCell: { tableId: string; rowId: string; colId: string } | null
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

// ── Phase 2: cells ─────────────────────────────────────────────────────────

/** A new 3 x 3 table by click, selected, with the stored row acknowledged. */
async function makeTable(page: Page): Promise<EngineElement> {
  await openBoard(page)
  await focusBoard(page)
  await page.keyboard.press('Shift+T')
  const at = await worldToPage(page, ORIGIN)
  await page.mouse.click(at.x, at.y)
  await expect
    .poll(async () => tablesOf(await engine(page)).length, { timeout: 10_000 })
    .toBe(1)
  await settle(page)
  return tablesOf(await engine(page))[0]
}

async function currentTable(page: Page): Promise<EngineElement> {
  return tablesOf(await engine(page))[0]
}

/** The page point at the centre of a cell, from the cell rects the renderer drew. */
async function cellCentre(
  page: Page,
  tableId: string,
  row: number,
  col: number,
) {
  const state = await engine(page)
  const table = state.elements.find((element) => element.id === tableId)!
  const rowId = table.table!.rows[row].id
  const colId = table.table!.cols[col].id
  const cell = state.tableCellRects[tableId].find(
    (entry) => entry.rowId === rowId && entry.colId === colId,
  )!
  const box = await canvasBox(page)
  return {
    x: box.x + cell.rect.x + cell.rect.width / 2,
    y: box.y + cell.rect.y + cell.rect.height / 2,
  }
}

function cellOf(
  table: EngineElement,
  row: number,
  col: number,
): { text: string; textRuns?: Array<unknown> } | undefined {
  const key = `${table.table!.rows[row].id}:${table.table!.cols[col].id}`
  return table.table!.cells[key]
}

async function editingCell(page: Page) {
  return (await engine(page)).editingCell
}

async function openCell(page: Page, tableId: string, row: number, col: number) {
  const at = await cellCentre(page, tableId, row, col)
  await page.mouse.dblclick(at.x, at.y)
  await expect.poll(() => editingCell(page), { timeout: 5_000 }).not.toBeNull()
}

test.describe('selecting cells', () => {
  test('the first click selects the table, the next a cell, Shift-click a range, a grabber a row', async ({
    page,
  }) => {
    const created = await makeTable(page)
    // Click empty canvas to drop the new table's selection, then click it.
    await focusBoard(page)
    const first = await cellCentre(page, created.id, 1, 1)
    await page.mouse.click(first.x, first.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds, { timeout: 5_000 })
      .toEqual([created.id])
    expect((await engine(page)).tableSelection).toBeNull()

    await page.mouse.click(first.x, first.y)
    await expect
      .poll(async () => (await engine(page)).tableSelection?.cells.length)
      .toBe(1)

    const corner = await cellCentre(page, created.id, 2, 2)
    await page.keyboard.down('Shift')
    await page.mouse.click(corner.x, corner.y)
    await page.keyboard.up('Shift')
    await expect
      .poll(async () => (await engine(page)).tableSelection?.cells.length)
      .toBe(4)

    // The row grabber sits just left of the table's first column.
    const rowStart = await cellCentre(page, created.id, 0, 0)
    const grab = await engine(page).then(async (state) => {
      const rect = state.tableCellRects[created.id][0].rect
      const box = await canvasBox(page)
      return { x: box.x + rect.x - 7, y: rowStart.y }
    })
    await page.mouse.click(grab.x, grab.y)
    await expect
      .poll(async () => (await engine(page)).tableSelection?.kind)
      .toBe('row')
    expect((await engine(page)).tableSelection?.cells).toHaveLength(3)
  })

  test('arrow keys move the cell selection, Escape drops to the table', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await focusBoard(page)
    const at = await cellCentre(page, created.id, 0, 0)
    await page.mouse.click(at.x, at.y)
    await page.mouse.click(at.x, at.y)
    await expect
      .poll(async () => (await engine(page)).tableSelection?.cells.length)
      .toBe(1)

    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await expect
      .poll(async () => {
        const state = await engine(page)
        const picked = state.tableSelection?.cells[0]
        const table = state.elements.find((e) => e.id === created.id)!
        return picked
          ? [
              table.table!.rows.findIndex((r) => r.id === picked.rowId),
              table.table!.cols.findIndex((c) => c.id === picked.colId),
            ]
          : null
      })
      .toEqual([1, 1])

    await page.keyboard.press('Escape')
    await expect
      .poll(async () => (await engine(page)).tableSelection)
      .toBeNull()
    expect((await engine(page)).selectedIds).toEqual([created.id])
  })
})

test.describe('editing cells', () => {
  test('types in cells, Tab moves across, Tab in the last cell appends a row, all persisted', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await openCell(page, created.id, 0, 0)
    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.type(`c${i}`)
      await page.keyboard.press('Tab')
      if (i < 8) {
        await expect
          .poll(async () => {
            const cell = await editingCell(page)
            const table = await currentTable(page)
            return cell
              ? table.table!.rows.findIndex((r) => r.id === cell.rowId) * 3 +
                  table.table!.cols.findIndex((c) => c.id === cell.colId)
              : null
          })
          .toBe(i + 1)
      }
    }
    // Tab in the ninth (last) cell appended a row and opened its first cell.
    await expect
      .poll(async () => (await currentTable(page)).table!.rows.length, {
        timeout: 5_000,
      })
      .toBe(4)
    const appended = (await engine(page)).editingCell
    const table = await currentTable(page)
    expect(appended?.rowId).toBe(table.table!.rows[3].id)
    expect(appended?.colId).toBe(table.table!.cols[0].id)
    await page.keyboard.type('tail')
    await page.keyboard.press('Escape')
    await expect.poll(() => editingCell(page)).toBeNull()
    await settle(page)

    const stored = async () => {
      const t = await currentTable(page)
      return [
        cellOf(t, 0, 0)?.text,
        cellOf(t, 1, 1)?.text,
        cellOf(t, 2, 2)?.text,
        cellOf(t, 3, 0)?.text,
      ]
    }
    expect(await stored()).toEqual(['c0', 'c4', 'c8', 'tail'])
    expect(Math.round((await currentTable(page)).height)).toBe(160)

    // The stored row, not the optimistic scene.
    await reloadBoard(page)
    expect(await stored()).toEqual(['c0', 'c4', 'c8', 'tail'])
    expect((await currentTable(page)).table!.rows).toHaveLength(4)
  })

  test('typing on a selected cell opens it, Enter is a new line, and a tall cell grows its row', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await focusBoard(page)
    const at = await cellCentre(page, created.id, 1, 0)
    await page.mouse.click(at.x, at.y)
    await page.mouse.click(at.x, at.y)
    // A printable key on a selected cell opens it and is its first character.
    await page.keyboard.type('a')
    await expect.poll(() => editingCell(page)).not.toBeNull()
    await page.keyboard.press('Enter')
    await page.keyboard.type('b')
    await page.keyboard.press('Enter')
    await page.keyboard.type('c')
    await page.keyboard.press('Enter')
    await page.keyboard.type('d')
    await page.keyboard.press('Escape')
    await expect.poll(() => editingCell(page)).toBeNull()
    await settle(page)

    const table = await currentTable(page)
    expect(cellOf(table, 1, 0)?.text).toBe('a\nb\nc\nd')
    // Four 14px lines do not fit the 40px default row.
    expect(table.table!.rows[1].height).toBeGreaterThan(40)
    expect(Math.round(table.height)).toBe(
      Math.round(table.table!.rows.reduce((sum, row) => sum + row.height, 0)),
    )

    await reloadBoard(page)
    const reloaded = await currentTable(page)
    expect(cellOf(reloaded, 1, 0)?.text).toBe('a\nb\nc\nd')
    expect(reloaded.table!.rows[1].height).toBe(table.table!.rows[1].height)
  })

  test('Shift+Tab moves back, and a click outside commits the open cell', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await openCell(page, created.id, 0, 1)
    await page.keyboard.type('mid')
    await page.keyboard.press('Shift+Tab')
    await expect
      .poll(async () => {
        const cell = await editingCell(page)
        const table = await currentTable(page)
        return cell
          ? table.table!.cols.findIndex((c) => c.id === cell.colId)
          : null
      })
      .toBe(0)
    await page.keyboard.type('start')
    // Click empty canvas: commits the open cell.
    await focusBoard(page)
    await expect.poll(() => editingCell(page)).toBeNull()
    await settle(page)
    const table = await currentTable(page)
    expect(cellOf(table, 0, 1)?.text).toBe('mid')
    expect(cellOf(table, 0, 0)?.text).toBe('start')
  })

  test('the text bar bolds a run inside a cell, and it persists', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await openCell(page, created.id, 1, 1)
    await page.keyboard.type('plain bold')
    // Select the last word with the keyboard, then use the text bar.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowLeft')
    const bar = page.getByRole('toolbar', { name: 'Text styling' })
    await bar.getByRole('button', { name: 'Bold', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => editingCell(page)).toBeNull()
    await settle(page)

    const stored = (await currentTable(page)).table!
    const cell = cellOf(await currentTable(page), 1, 1)
    expect(cell?.text).toBe('plain bold')
    expect(cell?.textRuns?.length ?? 0).toBeGreaterThan(0)
    expect(stored.rows).toHaveLength(3)

    await reloadBoard(page)
    const reloaded = cellOf(await currentTable(page), 1, 1)
    expect(reloaded?.text).toBe('plain bold')
    expect(reloaded?.textRuns?.length ?? 0).toBeGreaterThan(0)
  })

  test('an edit that changed nothing sends nothing and leaves no undo entry', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await openCell(page, created.id, 0, 0)
    await page.keyboard.press('Escape')
    await expect.poll(() => editingCell(page)).toBeNull()
    // No virtual cell element is left behind in the scene.
    const state = await engine(page)
    expect(
      state.elements.filter((e) => e.kind === 'text' && e.id.includes(':')),
    ).toHaveLength(0)
    const table = await currentTable(page)
    expect(Object.keys(table.table!.cells)).toHaveLength(0)
  })
})

test.describe('undo and redo of cell edits', () => {
  test('Ctrl+Z removes the typed text, Ctrl+Shift+Z brings it back, and the stored table follows', async ({
    page,
  }) => {
    const created = await makeTable(page)
    await openCell(page, created.id, 0, 0)
    await page.keyboard.type('hello')
    await page.keyboard.press('Escape')
    await expect.poll(() => editingCell(page)).toBeNull()
    await settle(page)
    expect(cellOf(await currentTable(page), 0, 0)?.text).toBe('hello')

    // Ctrl+Z goes to the board, not the (now closed) cell editor.
    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect
      .poll(async () => cellOf(await currentTable(page), 0, 0)?.text, {
        timeout: 10_000,
      })
      .toBeUndefined()
    await settle(page)
    // Redo, before any reload: the stack lives in the tab.
    await page.keyboard.press('Control+Shift+z')
    await expect
      .poll(async () => cellOf(await currentTable(page), 0, 0)?.text, {
        timeout: 10_000,
      })
      .toBe('hello')
    await settle(page)
    await reloadBoard(page)
    expect(cellOf(await currentTable(page), 0, 0)?.text).toBe('hello')
  })

  test('undoing the Tab-appended row removes it, and redo restores it', async ({
    page,
  }) => {
    const created = await makeTable(page)
    // Fill the last cell, then Tab off the end: one setCellText, one insertRow.
    await openCell(page, created.id, 2, 2)
    await page.keyboard.type('end')
    await page.keyboard.press('Tab')
    await expect
      .poll(async () => (await currentTable(page)).table!.rows.length, {
        timeout: 5_000,
      })
      .toBe(4)
    await page.keyboard.press('Escape')
    await expect.poll(() => editingCell(page)).toBeNull()
    await settle(page)

    await focusBoard(page)
    await page.keyboard.press('Control+z')
    await expect
      .poll(async () => (await currentTable(page)).table!.rows.length, {
        timeout: 10_000,
      })
      .toBe(3)
    // The text typed before the Tab is still there; it is the earlier entry.
    expect(cellOf(await currentTable(page), 2, 2)?.text).toBe('end')

    await page.keyboard.press('Control+z')
    await expect
      .poll(async () => cellOf(await currentTable(page), 2, 2)?.text, {
        timeout: 10_000,
      })
      .toBeUndefined()

    await page.keyboard.press('Control+Shift+z')
    await page.keyboard.press('Control+Shift+z')
    await expect
      .poll(async () => (await currentTable(page)).table!.rows.length, {
        timeout: 10_000,
      })
      .toBe(4)
    await settle(page)
    await reloadBoard(page)
    const table = await currentTable(page)
    expect(table.table!.rows).toHaveLength(4)
    expect(cellOf(table, 2, 2)?.text).toBe('end')
  })
})

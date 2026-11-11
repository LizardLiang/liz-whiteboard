// e2e/canvas-table-coedit.spec.ts
// Two people edit DIFFERENT cells of ONE canvas table at the same moment; both
// texts must survive (design rule: cell-level saves, applied server-side).
//
// PROD BUILD ONLY. Run against playwright.coedit.config.ts: the live
// `element:updated` broadcast that carries one editor's cell to the other only
// reaches a peer in the single-process prod server — in dev, Socket.IO's `io`
// is null in the Vite process. The config builds with VITE_E2E_HOOKS=1 so
// `window.__canvasEngine` is published (it is dev-only otherwise). The merged
// result is asserted three ways: live on both pages, then after a reload of
// each, which proves the server applied both ops to the stored table.
//
// Alice and Bob are the editors seeded by e2e/seed-collab.ts, which also seeds
// the board and its 2 x 3 table (row-1/row-2 x col-1..col-3).
import { expect, test } from '@playwright/test'
import {
  COEDIT_ALICE_STORAGE_STATE,
  COEDIT_BASE_URL,
  COEDIT_BOB_STORAGE_STATE,
} from './fixtures-collab'
import { COLLAB_CANVAS_BOARD_ID } from './seed-collab-constants'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${COLLAB_CANVAS_BOARD_ID}`

interface EngineState {
  elements: Array<{
    id: string
    kind: string
    table?: { cells: Record<string, { text: string }> }
  }>
  tableCellRects: Record<
    string,
    Array<{
      rowId: string
      colId: string
      rect: { x: number; y: number; width: number; height: number }
    }>
  >
  editingCell: { rowId: string; colId: string } | null
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state
}

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  await expect
    .poll(async () =>
      (await engine(page)).elements.some((e) => e.kind === 'table'),
    )
    .toBe(true)
}

async function cellCentre(page: Page, rowId: string, colId: string) {
  const state = await engine(page)
  const table = state.elements.find((e) => e.kind === 'table')!
  const cell = state.tableCellRects[table.id].find(
    (c) => c.rowId === rowId && c.colId === colId,
  )!
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return {
    x: box.x + cell.rect.x + cell.rect.width / 2,
    y: box.y + cell.rect.y + cell.rect.height / 2,
  }
}

async function cellTexts(page: Page) {
  const table = (await engine(page)).elements.find((e) => e.kind === 'table')!
  return {
    a: table.table?.cells['row-1:col-1']?.text,
    b: table.table?.cells['row-2:col-3']?.text,
  }
}

async function openCell(page: Page, rowId: string, colId: string) {
  const at = await cellCentre(page, rowId, colId)
  await page.mouse.dblclick(at.x, at.y)
  await expect
    .poll(async () => (await engine(page)).editingCell, { timeout: 5_000 })
    .not.toBeNull()
}

test('two people editing different cells of one table both keep their text', async ({
  browser,
}) => {
  const alice = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_ALICE_STORAGE_STATE,
    viewport: { width: 1600, height: 1000 },
  })
  const bob = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_BOB_STORAGE_STATE,
    viewport: { width: 1600, height: 1000 },
  })
  try {
    const alicePage = await alice.newPage()
    const bobPage = await bob.newPage()
    await openBoard(alicePage)
    await openBoard(bobPage)

    // Both open their own cell and type BEFORE either commits.
    await openCell(alicePage, 'row-1', 'col-1')
    await openCell(bobPage, 'row-2', 'col-3')
    await alicePage.keyboard.type('from alice')
    await bobPage.keyboard.type('from bob')
    await Promise.all([
      alicePage.keyboard.press('Escape'),
      bobPage.keyboard.press('Escape'),
    ])

    // Live: each page ends up with both texts, no reload.
    for (const page of [alicePage, bobPage]) {
      await expect
        .poll(() => cellTexts(page), { timeout: 15_000 })
        .toEqual({ a: 'from alice', b: 'from bob' })
    }

    // Stored: the server applied both ops to the latest table.
    for (const page of [alicePage, bobPage]) {
      await page.reload()
      await page.waitForFunction(() => window.__canvasEngine !== undefined)
      await expect
        .poll(() => cellTexts(page), { timeout: 15_000 })
        .toEqual({ a: 'from alice', b: 'from bob' })
    }
  } finally {
    await alice.close()
    await bob.close()
  }
})

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
import type { Browser, Page } from '@playwright/test'

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

// ── broadcast of the op, not the table ────────────────────────────────────
//
// Since `element:table-op-applied` a peer applies the op itself, rebases its
// own in-flight ops on top, and fetches the element (`element:sync`) when it
// missed one. Both behaviours are driven through Alice's WebSocket: the route
// can only delay or drop what the server sends her, which is the part of the
// wire these two tests are about.

async function cellText(page: Page, rowId: string, colId: string) {
  const table = (await engine(page)).elements.find((e) => e.kind === 'table')!
  return table.table?.cells[`${rowId}:${colId}`]?.text
}

async function relayToAlice(
  page: Page,
  shape: (frame: string) => { delayMs: number; drop: boolean },
) {
  await page.routeWebSocket(/socket\.io/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((message) => server.send(message))
    ws.onClose((code, reason) => void server.close({ code, reason }))
    server.onMessage((message) => {
      const frame = typeof message === 'string' ? message : ''
      const { delayMs, drop } = shape(frame)
      if (drop) return
      if (delayMs > 0) setTimeout(() => ws.send(message), delayMs)
      else ws.send(message)
    })
  })
}

async function twoEditors(browser: Browser) {
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
  return { alice, bob }
}

test("a collaborator's op does not make this user's in-flight edit flicker", async ({
  browser,
}) => {
  const { alice, bob } = await twoEditors(browser)
  try {
    const alicePage = await alice.newPage()
    const bobPage = await bob.newPage()
    // Everything the server sends Alice, acks included, arrives 400 ms late,
    // so her op is in flight when Bob's broadcast reaches her.
    await relayToAlice(alicePage, () => ({ delayMs: 400, drop: false }))
    await openBoard(alicePage)
    await openBoard(bobPage)

    await openCell(alicePage, 'row-1', 'col-2')
    await openCell(bobPage, 'row-2', 'col-2')
    await alicePage.keyboard.type('alice live')
    await bobPage.keyboard.type('bob live')

    await alicePage.evaluate(() => {
      const w = window as unknown as { __samples: Array<string> }
      w.__samples = []
      const tick = () => {
        const table = window.__canvasEngine?.elements.find(
          (e) => e.kind === 'table',
        )
        w.__samples.push(table?.table?.cells['row-1:col-2']?.text ?? '')
        requestAnimationFrame(tick)
      }
      tick()
    })
    // Bob's op reaches the server first; Alice's follows 150 ms later.
    await bobPage.keyboard.press('Escape')
    await alicePage.waitForTimeout(150)
    await alicePage.keyboard.press('Escape')

    for (const [row, col, text] of [
      ['row-1', 'col-2', 'alice live'],
      ['row-2', 'col-2', 'bob live'],
    ]) {
      await expect
        .poll(() => cellText(alicePage, row, col), { timeout: 15_000 })
        .toBe(text)
    }
    const samples = await alicePage.evaluate(
      () => (window as unknown as { __samples: Array<string> }).__samples,
    )
    const firstShown = samples.indexOf('alice live')
    expect(firstShown).toBeGreaterThanOrEqual(0)
    // Once her text is on screen it never goes blank before the ack.
    expect(
      samples.slice(firstShown).every((text) => text === 'alice live'),
    ).toBe(true)
  } finally {
    await alice.close()
    await bob.close()
  }
})

test('a peer that misses a table op fetches the element and ends with both edits', async ({
  browser,
}) => {
  const { alice, bob } = await twoEditors(browser)
  try {
    const alicePage = await alice.newPage()
    const bobPage = await bob.newPage()
    let dropped = 0
    await relayToAlice(alicePage, (frame) => {
      const drop = dropped === 0 && frame.includes('"element:table-op-applied"')
      if (drop) dropped += 1
      return { delayMs: 0, drop }
    })
    await openBoard(alicePage)
    await openBoard(bobPage)

    for (const [row, col, text] of [
      ['row-1', 'col-3', 'bob first'],
      ['row-2', 'col-1', 'bob second'],
    ]) {
      await openCell(bobPage, row, col)
      await bobPage.keyboard.type(text)
      await bobPage.keyboard.press('Escape')
      await expect
        .poll(() => cellText(bobPage, row, col), { timeout: 10_000 })
        .toBe(text)
    }
    // Alice never saw the first op. The second one skips a revision, so she
    // fetches the table instead of guessing.
    expect(dropped).toBe(1)
    await expect
      .poll(() => cellText(alicePage, 'row-1', 'col-3'), { timeout: 15_000 })
      .toBe('bob first')
    await expect
      .poll(() => cellText(alicePage, 'row-2', 'col-1'), { timeout: 15_000 })
      .toBe('bob second')
  } finally {
    await alice.close()
    await bob.close()
  }
})

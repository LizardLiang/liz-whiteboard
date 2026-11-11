import { describe, expect, it } from 'vitest'
import {
  TABLE_MAX_CELLS,
  TABLE_MIN_COL_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
  TableOpError,
  applyTableOp,
  cellAtPoint,
  cellElementId,
  cellKey,
  cellRect,
  cellTextElement,
  createTable,
  expectAfterOp,
  gripAtPoint,
  normalizeTable,
  pruneSelection,
  selectionCells,
  stepCell,
  tabCell,
  tableCellRects,
  tableDimsForDrag,
  tableMatchesExpect,
  tableSearchText,
  tableSize,
} from './table'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import type { CanvasTable, TableOp } from './table'

let counter = 0
const makeId = () => `id-${++counter}`

function fresh(rows = 3, cols = 3): CanvasTable {
  counter = 0
  return createTable(rows, cols, makeId)
}

/** Apply `op`, then its inverse, and expect the table to be back as it was. */
function roundTrip(table: CanvasTable, op: TableOp): CanvasTable {
  const applied = applyTableOp(table, op)
  const undone = applyTableOp(applied.table, applied.inverse)
  expect(undone.table).toEqual(table)
  return applied.table
}

describe('createTable / tableSize', () => {
  it('builds rows x cols default cells with the header on', () => {
    const table = fresh(2, 4)
    expect(table.rows).toHaveLength(2)
    expect(table.cols).toHaveLength(4)
    expect(table.headerRow).toBe(true)
    expect(tableSize(table)).toEqual({ width: 480, height: 80 })
  })
})

describe('applyTableOp round-trips', () => {
  it('setCellText', () => {
    const table = fresh()
    const [r0] = table.rows
    const [c0] = table.cols
    const next = roundTrip(table, {
      type: 'setCellText',
      rowId: r0.id,
      colId: c0.id,
      text: 'hello',
    })
    expect(next.cells[cellKey(r0.id, c0.id)].text).toBe('hello')
  })

  it('setCellText restores the previous runs and row height', () => {
    const table = fresh()
    const [r0] = table.rows
    const [c0] = table.cols
    const first = applyTableOp(table, {
      type: 'setCellText',
      rowId: r0.id,
      colId: c0.id,
      text: 'abc',
      textRuns: [{ start: 0, end: 1, fontWeight: 'bold' }],
      rowHeight: 80,
    })
    expect(first.table.rows[0].height).toBe(80)
    const undone = applyTableOp(first.table, first.inverse)
    expect(undone.table).toEqual(table)
  })

  it('setCellText floors a grown row at the minimum', () => {
    const table = fresh()
    const next = applyTableOp(table, {
      type: 'setCellText',
      rowId: table.rows[0].id,
      colId: table.cols[0].id,
      text: 'x',
      rowHeight: 1,
    }).table
    expect(next.rows[0].height).toBe(TABLE_MIN_ROW_HEIGHT)
  })

  it('setCellFill over several cells, including a cell that did not exist', () => {
    const table = fresh()
    const cells = [
      { rowId: table.rows[0].id, colId: table.cols[0].id },
      { rowId: table.rows[1].id, colId: table.cols[1].id },
    ]
    const withText = applyTableOp(table, {
      type: 'setCellText',
      rowId: cells[0].rowId,
      colId: cells[0].colId,
      text: 'keep',
    }).table
    const next = roundTrip(withText, {
      type: 'setCellFill',
      cells,
      fill: '#ff0000',
    })
    expect(next.cells[cellKey(cells[0].rowId, cells[0].colId)]).toEqual({
      text: 'keep',
      fill: '#ff0000',
    })
    expect(next.cells[cellKey(cells[1].rowId, cells[1].colId)].fill).toBe(
      '#ff0000',
    )
  })

  it('setCellFill null clears the fill and drops a blank cell', () => {
    const table = fresh()
    const ref = { rowId: table.rows[0].id, colId: table.cols[0].id }
    const filled = applyTableOp(table, {
      type: 'setCellFill',
      cells: [ref],
      fill: '#00f',
    }).table
    const cleared = applyTableOp(filled, {
      type: 'setCellFill',
      cells: [ref],
      fill: null,
    }).table
    expect(cleared.cells).toEqual({})
  })

  it('setCellAlign', () => {
    const table = fresh()
    const ref = { rowId: table.rows[1].id, colId: table.cols[2].id }
    const next = roundTrip(table, {
      type: 'setCellAlign',
      cells: [ref],
      align: 'center',
    })
    expect(next.cells[cellKey(ref.rowId, ref.colId)].textAlign).toBe('center')
  })

  it('insertRow after a row, at the top, and its inverse', () => {
    const table = fresh()
    const after = roundTrip(table, {
      type: 'insertRow',
      afterRowId: table.rows[0].id,
      row: { id: 'new', height: 40 },
    })
    expect(after.rows.map((r) => r.id)).toEqual([
      table.rows[0].id,
      'new',
      table.rows[1].id,
      table.rows[2].id,
    ])
    const top = roundTrip(table, {
      type: 'insertRow',
      afterRowId: null,
      row: { id: 'top', height: 40 },
    })
    expect(top.rows[0].id).toBe('top')
  })

  it('removeRow restores the row and its cells', () => {
    let table = fresh()
    const ref = { rowId: table.rows[1].id, colId: table.cols[1].id }
    table = applyTableOp(table, {
      type: 'setCellText',
      ...ref,
      text: 'gone and back',
    }).table
    const removed = applyTableOp(table, { type: 'removeRow', rowId: ref.rowId })
    expect(removed.table.rows).toHaveLength(2)
    expect(removed.table.cells[cellKey(ref.rowId, ref.colId)]).toBeUndefined()
    const restored = applyTableOp(removed.table, removed.inverse).table
    expect(restored).toEqual(table)
  })

  it('insertCol / removeCol round-trip with cells', () => {
    let table = fresh()
    const ref = { rowId: table.rows[0].id, colId: table.cols[1].id }
    table = applyTableOp(table, {
      type: 'setCellText',
      ...ref,
      text: 'c',
    }).table
    roundTrip(table, {
      type: 'insertCol',
      afterColId: table.cols[0].id,
      col: { id: 'nc', width: 100 },
    })
    const removed = applyTableOp(table, { type: 'removeCol', colId: ref.colId })
    expect(applyTableOp(removed.table, removed.inverse).table).toEqual(table)
  })

  it('resizeRow / resizeCol clamp to the minimum and invert', () => {
    const table = fresh()
    const row = roundTrip(table, {
      type: 'resizeRow',
      rowId: table.rows[0].id,
      height: 100,
    })
    expect(row.rows[0].height).toBe(100)
    const tiny = applyTableOp(table, {
      type: 'resizeCol',
      colId: table.cols[0].id,
      width: 1,
    }).table
    expect(tiny.cols[0].width).toBe(TABLE_MIN_COL_WIDTH)
    roundTrip(table, {
      type: 'resizeCol',
      colId: table.cols[1].id,
      width: 200,
    })
  })

  it('scaleTable and its setSizes inverse', () => {
    const table = fresh()
    const scaled = roundTrip(table, { type: 'scaleTable', sx: 2, sy: 1.5 })
    expect(tableSize(scaled)).toEqual({ width: 720, height: 180 })
  })

  it('setHeaderRow', () => {
    const table = fresh()
    const next = roundTrip(table, { type: 'setHeaderRow', on: false })
    expect(next.headerRow).toBe(false)
  })
})

describe('applyTableOp refusals', () => {
  it('throws TableOpError for a missing id', () => {
    const table = fresh()
    expect(() =>
      applyTableOp(table, { type: 'removeRow', rowId: 'nope' }),
    ).toThrow(TableOpError)
    expect(() =>
      applyTableOp(table, {
        type: 'setCellText',
        rowId: table.rows[0].id,
        colId: 'nope',
        text: 'x',
      }),
    ).toThrow(TableOpError)
    expect(() =>
      applyTableOp(table, {
        type: 'insertRow',
        afterRowId: 'nope',
        row: { id: 'r', height: 40 },
      }),
    ).toThrow(TableOpError)
  })

  it('refuses to remove the last row or column', () => {
    const table = fresh(1, 1)
    expect(() =>
      applyTableOp(table, { type: 'removeRow', rowId: table.rows[0].id }),
    ).toThrow(/at least one row/)
    expect(() =>
      applyTableOp(table, { type: 'removeCol', colId: table.cols[0].id }),
    ).toThrow(/at least one column/)
  })

  it('refuses to grow past the cell cap', () => {
    const table = fresh(TABLE_MAX_CELLS, 1)
    expect(() =>
      applyTableOp(table, {
        type: 'insertCol',
        afterColId: null,
        col: { id: 'extra', width: 100 },
      }),
    ).toThrow(TableOpError)
    expect(() =>
      applyTableOp(table, {
        type: 'insertRow',
        afterRowId: null,
        row: { id: 'extra', height: 40 },
      }),
    ).toThrow(TableOpError)
  })

  it('refuses a duplicate or malformed id', () => {
    const table = fresh()
    expect(() =>
      applyTableOp(table, {
        type: 'insertRow',
        afterRowId: null,
        row: { id: table.rows[0].id, height: 40 },
      }),
    ).toThrow(TableOpError)
    expect(() =>
      applyTableOp(table, {
        type: 'insertRow',
        afterRowId: null,
        row: { id: 'a:b', height: 40 },
      }),
    ).toThrow(TableOpError)
  })

  it('does not mutate its input', () => {
    const table = fresh()
    const snapshot = JSON.stringify(table)
    applyTableOp(table, {
      type: 'setCellText',
      rowId: table.rows[0].id,
      colId: table.cols[0].id,
      text: 'x',
    })
    expect(JSON.stringify(table)).toBe(snapshot)
  })
})

describe('concurrent ops on different cells both survive', () => {
  it('applies two setCellText ops in either order', () => {
    const table = fresh()
    const a: TableOp = {
      type: 'setCellText',
      rowId: table.rows[0].id,
      colId: table.cols[0].id,
      text: 'alice',
    }
    const b: TableOp = {
      type: 'setCellText',
      rowId: table.rows[2].id,
      colId: table.cols[2].id,
      text: 'bob',
    }
    const ab = applyTableOp(applyTableOp(table, a).table, b).table
    const ba = applyTableOp(applyTableOp(table, b).table, a).table
    expect(ab).toEqual(ba)
    expect(
      Object.values(ab.cells)
        .map((c) => c.text)
        .sort(),
    ).toEqual(['alice', 'bob'])
  })

  it('an op stays valid after another user inserts a row first', () => {
    const table = fresh()
    const edit: TableOp = {
      type: 'setCellText',
      rowId: table.rows[1].id,
      colId: table.cols[0].id,
      text: 'still lands',
    }
    const inserted = applyTableOp(table, {
      type: 'insertRow',
      afterRowId: null,
      row: { id: 'top', height: 40 },
    }).table
    const result = applyTableOp(inserted, edit).table
    expect(result.cells[cellKey(table.rows[1].id, table.cols[0].id)].text).toBe(
      'still lands',
    )
  })
})

describe('normalizeTable', () => {
  it('survives partial and garbage props', () => {
    for (const raw of [undefined, null, 5, {}, { rows: 'x' }, { cols: [1] }]) {
      const table = normalizeTable(raw)
      expect(table.rows.length).toBeGreaterThan(0)
      expect(table.cols.length).toBeGreaterThan(0)
      expect(table.headerRow).toBe(true)
    }
  })

  it('keeps valid pieces and drops invalid ones', () => {
    const table = normalizeTable({
      rows: [{ id: 'r', height: 50 }, { id: 3 }],
      cols: [{ id: 'c', width: -4 }],
      cells: { 'r:c': { text: 'hi', textAlign: 'right' }, bad: 7 },
      headerRow: false,
    })
    expect(table.rows).toEqual([{ id: 'r', height: 50 }])
    expect(table.cols[0].width).toBe(120)
    expect(table.cells).toEqual({ 'r:c': { text: 'hi', textAlign: 'right' } })
    expect(table.headerRow).toBe(false)
  })
})

describe('geometry', () => {
  it('cellRect is table-relative and tableCellRects is world-space', () => {
    const table = fresh(2, 2)
    expect(cellRect(table, table.rows[1].id, table.cols[1].id)).toEqual({
      x: 120,
      y: 40,
      width: 120,
      height: 40,
    })
    expect(cellRect(table, 'x', table.cols[0].id)).toBeNull()
    const rects = tableCellRects({ x: 100, y: 200, table })
    expect(rects).toHaveLength(4)
    expect(rects[3].rect).toEqual({ x: 220, y: 240, width: 120, height: 40 })
  })

  it('tableDimsForDrag is one cell per 120 x 40, min 1x1, capped', () => {
    expect(tableDimsForDrag(0, 0)).toEqual({ rows: 1, cols: 1 })
    expect(tableDimsForDrag(360, 120)).toEqual({ rows: 3, cols: 3 })
    expect(tableDimsForDrag(-240, 80)).toEqual({ rows: 2, cols: 2 })
    const big = tableDimsForDrag(100_000, 100_000)
    expect(big.rows * big.cols).toBeLessThanOrEqual(TABLE_MAX_CELLS)
  })

  it('cellTextElement frames the cell and bolds the header', () => {
    const table = fresh(2, 2)
    const element = {
      id: 'T',
      x: 10,
      y: 20,
      zIndex: 3,
      style: { ...DEFAULT_ELEMENT_STYLE },
      table,
    }
    const header = cellTextElement(element, table.rows[0].id, table.cols[1].id)
    expect(header).toMatchObject({
      kind: 'text',
      x: 130,
      y: 20,
      width: 120,
      height: 40,
    })
    expect(header?.style.fontWeight).toBe('bold')
    const body = cellTextElement(element, table.rows[1].id, table.cols[0].id)
    expect(body?.style.fontWeight).toBe('normal')
    expect(cellTextElement(element, 'x', 'y')).toBeNull()
  })

  it('tableSearchText joins non-empty cells row-major', () => {
    let table = fresh(2, 2)
    table = applyTableOp(table, {
      type: 'setCellText',
      rowId: table.rows[1].id,
      colId: table.cols[0].id,
      text: 'second',
    }).table
    table = applyTableOp(table, {
      type: 'setCellText',
      rowId: table.rows[0].id,
      colId: table.cols[1].id,
      text: 'first',
    }).table
    expect(tableSearchText(table)).toBe('first second')
  })
})

describe('cellAtPoint', () => {
  function placed() {
    const table = fresh(2, 3)
    return { x: 100, y: 50, ...tableSize(table), table }
  }

  it('finds the cell under a world point', () => {
    const el = placed()
    expect(cellAtPoint(el, { x: 110, y: 60 })).toEqual({
      rowId: 'id-1',
      colId: 'id-3',
    })
    expect(cellAtPoint(el, { x: 100 + 250, y: 50 + 50 })).toEqual({
      rowId: 'id-2',
      colId: 'id-5',
    })
  })

  it('puts a border point in the cell right/below it, and the table edge outside', () => {
    const el = placed()
    expect(cellAtPoint(el, { x: 220, y: 90 })).toEqual({
      rowId: 'id-2',
      colId: 'id-4',
    })
    expect(cellAtPoint(el, { x: 100 + 360, y: 60 })).toBeNull()
    expect(cellAtPoint(el, { x: 99, y: 60 })).toBeNull()
  })

  it('follows uneven row heights and column widths', () => {
    const table = applyTableOp(fresh(2, 2), {
      type: 'resizeRow',
      rowId: 'id-1',
      height: 100,
    }).table
    const el = { x: 0, y: 0, ...tableSize(table), table }
    expect(cellAtPoint(el, { x: 10, y: 90 })?.rowId).toBe('id-1')
    expect(cellAtPoint(el, { x: 10, y: 110 })?.rowId).toBe('id-2')
  })
})

describe('gripAtPoint', () => {
  const table = fresh(2, 2)
  const el = { x: 100, y: 100, ...tableSize(table), table }

  it('hits a row grabber left of the table and a column grabber above it', () => {
    expect(gripAtPoint(el, { x: 93, y: 150 }, 14)).toEqual({
      kind: 'row',
      rowId: 'id-2',
    })
    expect(gripAtPoint(el, { x: 250, y: 93 }, 14)).toEqual({
      kind: 'col',
      colId: 'id-4',
    })
  })

  it('misses inside the table, past the strip, and on the outer corner', () => {
    expect(gripAtPoint(el, { x: 110, y: 110 }, 14)).toBeNull()
    expect(gripAtPoint(el, { x: 80, y: 120 }, 14)).toBeNull()
    expect(gripAtPoint(el, { x: 93, y: 93 }, 14)).toBeNull()
  })

  it('scales the strip with the zoom: a fixed screen size is more world px when zoomed out', () => {
    expect(gripAtPoint(el, { x: 70, y: 120 }, 14 / 0.25)).not.toBeNull()
    expect(gripAtPoint(el, { x: 70, y: 120 }, 14 / 2)).toBeNull()
  })
})

describe('cell selection helpers', () => {
  const table = fresh(3, 3)
  // rows id-1..3, cols id-4..6
  it('covers the rectangle between two corners, whichever way round', () => {
    const cells = selectionCells(table, {
      tableId: 't',
      kind: 'cells',
      anchor: { rowId: 'id-3', colId: 'id-5' },
      focus: { rowId: 'id-2', colId: 'id-4' },
    })
    expect(cells.map((c) => `${c.rowId}:${c.colId}`)).toEqual([
      'id-2:id-4',
      'id-2:id-5',
      'id-3:id-4',
      'id-3:id-5',
    ])
  })

  it('covers a whole row or column, and nothing for a removed one', () => {
    expect(
      selectionCells(table, { tableId: 't', kind: 'row', rowId: 'id-2' }),
    ).toHaveLength(3)
    expect(
      selectionCells(table, { tableId: 't', kind: 'col', colId: 'id-6' }),
    ).toHaveLength(3)
    expect(
      selectionCells(table, { tableId: 't', kind: 'row', rowId: 'gone' }),
    ).toEqual([])
  })

  it('drops a selection whose row was removed by a remote op', () => {
    const selection = {
      tableId: 't',
      kind: 'row' as const,
      rowId: 'id-2',
    }
    expect(pruneSelection(table, selection)).toBe(selection)
    const after = applyTableOp(table, { type: 'removeRow', rowId: 'id-2' })
    expect(pruneSelection(after.table, selection)).toBeNull()
  })

  it('clamps arrow steps at the edges', () => {
    expect(stepCell(table, { rowId: 'id-1', colId: 'id-4' }, -1, -1)).toEqual({
      rowId: 'id-1',
      colId: 'id-4',
    })
    expect(stepCell(table, { rowId: 'id-3', colId: 'id-6' }, 1, 1)).toEqual({
      rowId: 'id-3',
      colId: 'id-6',
    })
    expect(stepCell(table, { rowId: 'id-1', colId: 'id-4' }, 1, 1)).toEqual({
      rowId: 'id-2',
      colId: 'id-5',
    })
  })

  it('Tab reads left to right, wraps to the next row, and ends at the last cell', () => {
    expect(tabCell(table, { rowId: 'id-1', colId: 'id-6' }, 1)).toEqual({
      rowId: 'id-2',
      colId: 'id-4',
    })
    expect(tabCell(table, { rowId: 'id-2', colId: 'id-4' }, -1)).toEqual({
      rowId: 'id-1',
      colId: 'id-6',
    })
    expect(tabCell(table, { rowId: 'id-3', colId: 'id-6' }, 1)).toBeNull()
    expect(tabCell(table, { rowId: 'id-1', colId: 'id-4' }, -1)).toBeNull()
  })

  it('names a cell virtual element by table, row and column', () => {
    expect(cellElementId('t', 'r', 'c')).toBe('t:r:c')
  })
})

describe('undo expectations', () => {
  it('matches a cell on text and runs, and treats a missing cell as empty', () => {
    const table = fresh(1, 2)
    const typed = applyTableOp(table, {
      type: 'setCellText',
      rowId: 'id-1',
      colId: 'id-2',
      text: 'hi',
      textRuns: [{ start: 0, end: 2, fontWeight: 'bold' } as never],
    }).table
    expect(
      tableMatchesExpect(typed, [
        {
          rowId: 'id-1',
          colId: 'id-2',
          text: 'hi',
          textRuns: [{ start: 0, end: 2, fontWeight: 'bold' } as never],
        },
      ]),
    ).toBe(true)
    expect(
      tableMatchesExpect(typed, [{ rowId: 'id-1', colId: 'id-2', text: 'hi' }]),
    ).toBe(false)
    expect(
      tableMatchesExpect(typed, [{ rowId: 'id-1', colId: 'id-3', text: '' }]),
    ).toBe(true)
    expect(
      tableMatchesExpect(typed, [{ rowId: 'id-1', colId: 'id-3', text: 'x' }]),
    ).toBe(false)
  })

  it('expects a text op to leave its own text behind, and a row removal a blank row', () => {
    const table = fresh(2, 2)
    expect(
      expectAfterOp(table, {
        type: 'setCellText',
        rowId: 'id-1',
        colId: 'id-3',
        text: 'a',
      }),
    ).toEqual([{ rowId: 'id-1', colId: 'id-3', text: 'a' }])
    expect(expectAfterOp(table, { type: 'removeRow', rowId: 'id-2' })).toEqual([
      { rowId: 'id-2', colId: 'id-3', text: '' },
      { rowId: 'id-2', colId: 'id-4', text: '' },
    ])
    expect(
      expectAfterOp(table, { type: 'setHeaderRow', on: false }),
    ).toBeUndefined()
  })
})

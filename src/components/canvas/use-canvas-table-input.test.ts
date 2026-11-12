// src/components/canvas/use-canvas-table-input.test.ts
// Direct tests of the table interaction hook and its pure helpers. The
// gesture-level table behaviour (press, drag, keys) is exercised through
// `useCanvasInput` in use-canvas-input.test.ts.

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  tableInsertLimits,
  useCanvasTableInput,
  withRowHeight,
} from './use-canvas-table-input'
import type { TableInputLatest } from './use-canvas-table-input'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import { DEFAULT_CAMERA } from '@/lib/canvas-engine/camera'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'
import {
  TABLE_CELL_HEIGHT,
  TABLE_MAX_CELLS,
  createTable,
  tableSize,
} from '@/lib/canvas-engine/table'

const TABLE_ID = '77777777-7777-4777-8777-777777777777'

function makeGrid(rows = 2, cols = 2) {
  let n = 0
  return createTable(rows, cols, () => `id${(n += 1)}`)
}

function tableElement(table = makeGrid()): CanvasElement {
  return {
    id: TABLE_ID,
    kind: 'table',
    x: 0,
    y: 0,
    ...tableSize(table),
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    table,
  }
}

function setup(readOnly = false, selected: Array<string> = [], rows = 2) {
  const element = tableElement(makeGrid(rows, 2))
  const scene: Scene = sceneFrom([element])
  const onTableOp = vi.fn()
  const latest = {
    current: {
      scene,
      camera: DEFAULT_CAMERA,
      tool: 'select',
      readOnly,
      selectedIds: new Set(selected),
      editing: null,
    } satisfies TableInputLatest,
  }
  const editingRef = { current: null }
  const hook = renderHook(() =>
    useCanvasTableInput({
      latest,
      scene,
      setScene: vi.fn(),
      writeScene: vi.fn(),
      selectedIds: latest.current.selectedIds,
      setSelectedIds: vi.fn(),
      setGesture: vi.fn(),
      editingRef,
      setEditing: vi.fn(),
      setCaretVisible: vi.fn(),
      pendingTextEditsRef: { current: [] },
      getMeasurer: () => null,
      callbacks: { onTableOp },
      replaceEdit: vi.fn(),
    }),
  )
  return { hook, element, onTableOp }
}

describe('tableInsertLimits', () => {
  it('allows one more row and column below the cell cap', () => {
    expect(tableInsertLimits(makeGrid(2, 2))).toEqual({
      canInsertRow: true,
      canInsertCol: true,
    })
  })

  it('refuses a row or column that would pass the cell cap', () => {
    const wide = makeGrid(1, TABLE_MAX_CELLS)
    expect(tableInsertLimits(wide)).toEqual({
      canInsertRow: false,
      canInsertCol: false,
    })
  })
})

describe('withRowHeight', () => {
  it('sets the height of the named row only', () => {
    const grid = makeGrid(2, 1)
    const next = withRowHeight(grid, grid.rows[1].id, 99)
    expect(next.rows.map((row) => row.height)).toEqual([TABLE_CELL_HEIGHT, 99])
    expect(grid.rows[1].height).toBe(TABLE_CELL_HEIGHT)
  })
})

describe('useCanvasTableInput', () => {
  it('sends a table op with the table as it stood', () => {
    const { hook, element, onTableOp } = setup()
    act(() => {
      hook.result.current.issueTableOp(TABLE_ID, {
        type: 'removeRow',
        rowId: element.table!.rows[0].id,
      })
    })
    expect(onTableOp).toHaveBeenCalledWith(
      TABLE_ID,
      { type: 'removeRow', rowId: element.table!.rows[0].id },
      element.table,
    )
  })

  it('sends nothing on a read-only board', () => {
    const { hook, element, onTableOp } = setup(true)
    act(() => {
      hook.result.current.issueTableOp(TABLE_ID, {
        type: 'removeRow',
        rowId: element.table!.rows[0].id,
      })
    })
    expect(onTableOp).not.toHaveBeenCalled()
  })

  it('handles Delete on a picked row but never removes the last row', () => {
    const { hook, element, onTableOp } = setup(false, [TABLE_ID], 1)
    act(() => {
      hook.result.current.setTableSelection({
        tableId: TABLE_ID,
        kind: 'row',
        rowId: element.table!.rows[0].id,
      })
    })
    let handled = false
    act(() => {
      handled = hook.result.current.deleteTableSelection()
    })
    expect(handled).toBe(true)
    expect(onTableOp).not.toHaveBeenCalled()
  })

  it('leaves Delete alone when no part of a table is picked', () => {
    const { hook } = setup(false, [TABLE_ID])
    expect(hook.result.current.deleteTableSelection()).toBe(false)
  })

  it('offers the menu items of the cell a right-click landed on', () => {
    const { hook, element } = setup()
    const table = element.table!
    act(() => {
      hook.result.current.pressTableMenu({ x: 5, y: 5 })
    })
    expect(hook.result.current.tableMenu).toMatchObject({
      tableId: TABLE_ID,
      rowId: table.rows[0].id,
      colId: table.cols[0].id,
      canInsertRow: true,
      canDeleteRow: true,
    })
  })
})

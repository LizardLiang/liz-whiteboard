// src/lib/canvas-engine/table-row-fit.test.ts
import { describe, expect, it } from 'vitest'
import { clampTextOpRowHeight, rowTextMinHeight } from './table-row-fit'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import { cellKey } from './table'
import type { CanvasElement } from './scene'
import type { CanvasTable, TableOp } from './table'

// One character is 10 units wide; a cell is 100 wide, so 5 characters fit a line.
const measure = (text: string) => text.length * 10

function tableElement(cells: CanvasTable['cells']): CanvasElement {
  return {
    id: 't',
    kind: 'table',
    x: 0,
    y: 0,
    width: 300,
    height: 40,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 14 },
    table: {
      rows: [{ id: 'r1', height: 40 }],
      cols: [
        { id: 'c1', width: 100 },
        { id: 'c2', width: 100 },
        { id: 'c3', width: 100 },
      ],
      cells,
      headerRow: false,
    },
  }
}

const getMeasurer = () => measure

describe('row height clamp for undo and redo', () => {
  const tall = 'aaaaa bbbbb ccccc ddddd eeeee fffff'
  const cells = {
    [cellKey('r1', 'c2')]: { text: tall },
    [cellKey('r1', 'c3')]: { text: '' },
  }

  it('measures the tallest other cell of the row and leaves the edited cell out', () => {
    const element = tableElement({
      ...cells,
      [cellKey('r1', 'c1')]: { text: tall },
    })
    const others = rowTextMinHeight(element, 'r1', 'c1', getMeasurer)
    expect(others).toBeGreaterThan(24)
    expect(rowTextMinHeight(element, 'r1', 'c2', getMeasurer)).toBe(others)
    expect(rowTextMinHeight(tableElement({}), 'r1', 'c1', getMeasurer)).toBe(24)
  })

  it("raises an undo row height that would shrink the row below a collaborator's text", () => {
    const element = tableElement(cells)
    const needed = rowTextMinHeight(element, 'r1', 'c1', getMeasurer)
    const inverse: TableOp = {
      type: 'setCellText',
      rowId: 'r1',
      colId: 'c1',
      text: '',
      rowHeight: 24,
      ifRowHeight: 60,
    }
    expect(clampTextOpRowHeight(element, inverse, getMeasurer)).toEqual({
      ...inverse,
      rowHeight: needed,
    })
  })

  it('keeps a row height that is already tall enough, and ops without a row height', () => {
    const element = tableElement(cells)
    const keep: TableOp = {
      type: 'setCellText',
      rowId: 'r1',
      colId: 'c1',
      text: '',
      rowHeight: 500,
    }
    expect(clampTextOpRowHeight(element, keep, getMeasurer)).toBe(keep)
    const plain: TableOp = { ...keep, rowHeight: undefined }
    expect(clampTextOpRowHeight(element, plain, getMeasurer)).toBe(plain)
    const other: TableOp = { type: 'resizeRow', rowId: 'r1', height: 10 }
    expect(clampTextOpRowHeight(element, other, getMeasurer)).toBe(other)
    expect(clampTextOpRowHeight(undefined, keep, getMeasurer)).toBe(keep)
  })
})

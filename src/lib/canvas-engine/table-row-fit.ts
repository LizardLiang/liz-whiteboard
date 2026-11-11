// src/lib/canvas-engine/table-row-fit.ts
// The row height a table cell edit must not shrink a row below. The server
// cannot measure text, so the client measures the other cells of the row, with
// the same measurer the row auto-grow uses, before it sends an undo or redo.

import { fittedTextHeight, fontSpecOf } from './render'
import {
  TABLE_MIN_ROW_HEIGHT,
  cellKey,
  cellTextElement,
  lookupCell,
} from './table'
import type { CanvasElement } from './scene'
import type { TableOp } from './table'
import type { TextMeasurer } from './text-layout'
import type { CanvasFontSpec } from './render-target'

/** The tallest text of the cells in a row, the edited cell left out. */
export function rowTextMinHeight(
  element: CanvasElement,
  rowId: string,
  exceptColId: string,
  getMeasurer: (spec: CanvasFontSpec) => TextMeasurer | null,
): number {
  const grid = element.table
  let height = TABLE_MIN_ROW_HEIGHT
  if (!grid) return height
  for (const col of grid.cols) {
    if (col.id === exceptColId) continue
    const cell = lookupCell(grid.cells, cellKey(rowId, col.id))
    if (!cell || cell.text === '') continue
    const virtual = cellTextElement(element, rowId, col.id)
    const measure = virtual && getMeasurer(fontSpecOf(virtual.style))
    if (!virtual || !measure) continue
    height = Math.max(height, Math.ceil(fittedTextHeight(virtual, measure)))
  }
  return height
}

/**
 * A `setCellText` op that sets a row height is raised to the height the row's
 * other cells need, so an undo cannot shrink a row below a collaborator's text.
 * Any other op comes back unchanged.
 */
export function clampTextOpRowHeight(
  element: CanvasElement | undefined,
  op: TableOp,
  getMeasurer: (spec: CanvasFontSpec) => TextMeasurer | null,
): TableOp {
  if (op.type !== 'setCellText' || op.rowHeight === undefined) return op
  if (!element?.table) return op
  const needed = rowTextMinHeight(element, op.rowId, op.colId, getMeasurer)
  return needed > op.rowHeight ? { ...op, rowHeight: needed } : op
}

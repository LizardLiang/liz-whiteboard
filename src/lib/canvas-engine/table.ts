// src/lib/canvas-engine/table.ts
// The canvas table element: a grid of rows x columns of text cells.
//
// Pure module: no React, no DOM, no database. The server applies the SAME
// `applyTableOp` to the stored table, so two people who edit different cells
// of one table both keep their text — an op changes one cell or one row, never
// the whole table. Every op names rows and columns by stable id, never by
// index, so an op stays valid when another user inserts a row first.

import { DEFAULT_ELEMENT_STYLE } from './scene'
import type {
  CanvasElement,
  CanvasElementStyle,
  CanvasTextAlign,
  CanvasTextRun,
} from './scene'
import type { WorldRect } from './hit-test'

export interface TableRow {
  id: string
  height: number
}

export interface TableCol {
  id: string
  width: number
}

export interface TableCell {
  text: string
  textRuns?: Array<CanvasTextRun>
  textAlign?: CanvasTextAlign
  /** A fill colour; absent means no fill. */
  fill?: string
}

export interface CanvasTable {
  rows: Array<TableRow>
  cols: Array<TableCol>
  /** Keyed `"rowId:colId"`. A missing cell is an empty cell. */
  cells: Record<string, TableCell>
  headerRow: boolean
}

export interface CellRef {
  rowId: string
  colId: string
}

/** Default cell size in world px; also the drag-to-size step of the Table tool. */
export const TABLE_CELL_WIDTH = 120
export const TABLE_CELL_HEIGHT = 40
export const TABLE_MIN_COL_WIDTH = 40
export const TABLE_MIN_ROW_HEIGHT = 24
/** FigJam's documented cap. */
export const TABLE_MAX_CELLS = 500
export const TABLE_MAX_TEXT_LENGTH = 5000

/** A new table's style: no fill (cells carry their own), a slate grid, compact text. */
export const TABLE_DEFAULT_STYLE: Partial<CanvasElementStyle> = {
  fill: 'none',
  stroke: '#94a3b8',
  strokeWidth: 1,
  fontSize: 14,
}

export type TableOp =
  | {
      type: 'setCellText'
      rowId: string
      colId: string
      text: string
      textRuns?: Array<CanvasTextRun>
      /** The row height the client measured for this text; the server stores max(it, 24). */
      rowHeight?: number
    }
  | { type: 'setCellFill'; cells: Array<CellRef>; fill: string | null }
  | { type: 'setCellAlign'; cells: Array<CellRef>; align: CanvasTextAlign }
  | {
      type: 'insertRow'
      afterRowId: string | null
      row: TableRow
      /** Cells restored with the row, keyed by column id (an undone row delete). */
      cells?: Record<string, TableCell>
    }
  | { type: 'removeRow'; rowId: string }
  | {
      type: 'insertCol'
      afterColId: string | null
      col: TableCol
      /** Cells restored with the column, keyed by row id (an undone column delete). */
      cells?: Record<string, TableCell>
    }
  | { type: 'removeCol'; colId: string }
  | { type: 'resizeRow'; rowId: string; height: number }
  | { type: 'resizeCol'; colId: string; width: number }
  | { type: 'scaleTable'; sx: number; sy: number }
  | { type: 'setHeaderRow'; on: boolean }
  /** The inverse of `scaleTable`: puts every named row height and column width back. */
  | {
      type: 'setSizes'
      rows: Array<TableRow>
      cols: Array<TableCol>
    }
  /** The inverse of a fill or align op: puts each cell back as it was (null = no cell). */
  | {
      type: 'restoreCells'
      cells: Array<{ rowId: string; colId: string; cell: TableCell | null }>
    }

export type TableOpType = TableOp['type']

export class TableOpError extends Error {
  readonly code: 'MISSING_ID' | 'LAST_ROW_OR_COL' | 'TOO_LARGE' | 'INVALID'
  constructor(code: TableOpError['code'], message: string) {
    super(message)
    this.name = 'TableOpError'
    this.code = code
  }
}

export function cellKey(rowId: string, colId: string): string {
  return `${rowId}:${colId}`
}

/** The cell stored under `key`, or undefined — a missing cell is an empty cell. */
export function lookupCell(
  cells: Record<string, TableCell>,
  key: string,
): TableCell | undefined {
  return cells[key]
}

/** A table of `rows` x `cols` default cells, header row on. Ids come from `makeId`. */
export function createTable(
  rows: number,
  cols: number,
  makeId: () => string,
): CanvasTable {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  return {
    rows: Array.from({ length: r }, () => ({
      id: makeId(),
      height: TABLE_CELL_HEIGHT,
    })),
    cols: Array.from({ length: c }, () => ({
      id: makeId(),
      width: TABLE_CELL_WIDTH,
    })),
    cells: {},
    headerRow: true,
  }
}

export function tableSize(table: CanvasTable): {
  width: number
  height: number
} {
  return {
    width: table.cols.reduce((sum, col) => sum + col.width, 0),
    height: table.rows.reduce((sum, row) => sum + row.height, 0),
  }
}

/** The rows x columns a drag of `dx` x `dy` world px picks: one cell per 120 x 40, min 1x1, <= 500 cells. */
export function tableDimsForDrag(
  dx: number,
  dy: number,
): { rows: number; cols: number } {
  let cols = Math.max(1, Math.round(Math.abs(dx) / TABLE_CELL_WIDTH))
  let rows = Math.max(1, Math.round(Math.abs(dy) / TABLE_CELL_HEIGHT))
  while (rows * cols > TABLE_MAX_CELLS) {
    if (cols >= rows) cols -= 1
    else rows -= 1
  }
  return { rows, cols }
}

/** A cell's rect in TABLE-relative world px (origin = the table's top-left). */
export function cellRect(
  table: CanvasTable,
  rowId: string,
  colId: string,
): WorldRect | null {
  let y = 0
  let rowHeight = -1
  for (const row of table.rows) {
    if (row.id === rowId) {
      rowHeight = row.height
      break
    }
    y += row.height
  }
  if (rowHeight < 0) return null
  let x = 0
  for (const col of table.cols) {
    if (col.id === colId) return { x, y, width: col.width, height: rowHeight }
    x += col.width
  }
  return null
}

/** Every cell rect in WORLD px, row-major. */
export function tableCellRects(
  element: Pick<CanvasElement, 'x' | 'y' | 'table'>,
): Array<{ rowId: string; colId: string; rect: WorldRect }> {
  const table = element.table
  if (!table) return []
  const out: Array<{ rowId: string; colId: string; rect: WorldRect }> = []
  let y = element.y
  for (const row of table.rows) {
    let x = element.x
    for (const col of table.cols) {
      out.push({
        rowId: row.id,
        colId: col.id,
        rect: { x, y, width: col.width, height: row.height },
      })
      x += col.width
    }
    y += row.height
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function normalizeCell(raw: unknown): TableCell | null {
  if (!isRecord(raw)) return null
  const cell: TableCell = { text: typeof raw.text === 'string' ? raw.text : '' }
  if (Array.isArray(raw.textRuns) && raw.textRuns.length > 0) {
    cell.textRuns = raw.textRuns as Array<CanvasTextRun>
  }
  if (
    raw.textAlign === 'left' ||
    raw.textAlign === 'center' ||
    raw.textAlign === 'right'
  ) {
    cell.textAlign = raw.textAlign
  }
  if (typeof raw.fill === 'string' && raw.fill.length > 0) cell.fill = raw.fill
  return cell
}

/**
 * A usable table from whatever a row holds. Tolerates missing fields — rows
 * written before this module are never migrated, and a hand-edited row must
 * not take the board load down. Always at least one row and one column.
 */
export function normalizeTable(raw: unknown): CanvasTable {
  const source = isRecord(raw) ? raw : {}
  const rows: Array<TableRow> = []
  if (Array.isArray(source.rows)) {
    for (const entry of source.rows) {
      if (isRecord(entry) && typeof entry.id === 'string') {
        rows.push({
          id: entry.id,
          height: finitePositive(entry.height, TABLE_CELL_HEIGHT),
        })
      }
    }
  }
  const cols: Array<TableCol> = []
  if (Array.isArray(source.cols)) {
    for (const entry of source.cols) {
      if (isRecord(entry) && typeof entry.id === 'string') {
        cols.push({
          id: entry.id,
          width: finitePositive(entry.width, TABLE_CELL_WIDTH),
        })
      }
    }
  }
  if (rows.length === 0) rows.push({ id: 'row-0', height: TABLE_CELL_HEIGHT })
  if (cols.length === 0) cols.push({ id: 'col-0', width: TABLE_CELL_WIDTH })
  const cells: Record<string, TableCell> = {}
  if (isRecord(source.cells)) {
    for (const [key, value] of Object.entries(source.cells)) {
      const cell = normalizeCell(value)
      if (cell) cells[key] = cell
    }
  }
  return {
    rows,
    cols,
    cells,
    headerRow: typeof source.headerRow === 'boolean' ? source.headerRow : true,
  }
}

/** The joined text of every cell, row-major, for search. */
export function tableSearchText(table: CanvasTable): string {
  const parts: Array<string> = []
  for (const row of table.rows) {
    for (const col of table.cols) {
      const text = lookupCell(table.cells, cellKey(row.id, col.id))?.text.trim()
      if (text) parts.push(text)
    }
  }
  return parts.join(' ')
}

/**
 * A virtual `text` element for one cell: the frame is the cell rect and the
 * style is the table's with the cell's alignment and runs. The existing text
 * layout, caret and drawing code run on it unchanged.
 */
export function cellTextElement(
  element: Pick<CanvasElement, 'id' | 'x' | 'y' | 'zIndex' | 'style' | 'table'>,
  rowId: string,
  colId: string,
): CanvasElement | null {
  const table = element.table
  if (!table) return null
  const rect = cellRect(table, rowId, colId)
  if (!rect) return null
  const cell = lookupCell(table.cells, cellKey(rowId, colId))
  const header = table.headerRow && table.rows[0]?.id === rowId
  const style: CanvasElementStyle = {
    ...DEFAULT_ELEMENT_STYLE,
    fontSize: element.style.fontSize,
    color: element.style.color,
    fontWeight: header ? 'bold' : element.style.fontWeight,
    fontStyle: element.style.fontStyle,
    underline: element.style.underline,
    strikethrough: element.style.strikethrough,
    textAlign: cell?.textAlign ?? 'left',
    verticalAlign: 'middle',
    fill: 'none',
    strokeWidth: 0,
    textRuns: cell?.textRuns ?? [],
  }
  return {
    id: `${element.id}:${rowId}:${colId}`,
    kind: 'text',
    x: element.x + rect.x,
    y: element.y + rect.y,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    zIndex: element.zIndex,
    text: cell?.text ?? '',
    style,
  }
}

// ── ops ─────────────────────────────────────────────────────────────────────

function requireRow(table: CanvasTable, rowId: string): number {
  const index = table.rows.findIndex((row) => row.id === rowId)
  if (index < 0) throw new TableOpError('MISSING_ID', `No row ${rowId}`)
  return index
}

function requireCol(table: CanvasTable, colId: string): number {
  const index = table.cols.findIndex((col) => col.id === colId)
  if (index < 0) throw new TableOpError('MISSING_ID', `No column ${colId}`)
  return index
}

function requireCell(table: CanvasTable, ref: CellRef): void {
  requireRow(table, ref.rowId)
  requireCol(table, ref.colId)
}

/** A cell with no content at all is dropped, so the stored table stays small. */
function isBlank(cell: TableCell): boolean {
  return (
    cell.text === '' &&
    (!cell.textRuns || cell.textRuns.length === 0) &&
    cell.textAlign === undefined &&
    cell.fill === undefined
  )
}

function withCell(
  cells: Record<string, TableCell>,
  key: string,
  cell: TableCell | null,
): Record<string, TableCell> {
  const next = { ...cells }
  if (cell === null || isBlank(cell)) delete next[key]
  else next[key] = cell
  return next
}

function checkSize(rows: number, cols: number): void {
  if (rows * cols > TABLE_MAX_CELLS) {
    throw new TableOpError(
      'TOO_LARGE',
      `A table holds at most ${TABLE_MAX_CELLS} cells`,
    )
  }
}

function checkId(id: string): void {
  if (id.length === 0 || id.length > 64 || id.includes(':')) {
    throw new TableOpError('INVALID', 'Invalid row or column id')
  }
}

/**
 * Apply one op and return the new table plus the op that undoes it. Never
 * mutates its input. Throws `TableOpError` for a missing id, for removing the
 * last row or column, and for growing past `TABLE_MAX_CELLS`.
 */
export function applyTableOp(
  table: CanvasTable,
  op: TableOp,
): { table: CanvasTable; inverse: TableOp } {
  switch (op.type) {
    case 'setCellText': {
      const rowIndex = requireRow(table, op.rowId)
      requireCol(table, op.colId)
      if (op.text.length > TABLE_MAX_TEXT_LENGTH) {
        throw new TableOpError('INVALID', 'Cell text is too long')
      }
      const key = cellKey(op.rowId, op.colId)
      const prior = lookupCell(table.cells, key)
      const next: TableCell = { ...(prior ?? { text: '' }), text: op.text }
      if (op.textRuns && op.textRuns.length > 0) next.textRuns = op.textRuns
      else delete next.textRuns
      const priorHeight = table.rows[rowIndex].height
      const grownHeight = op.rowHeight
      const rows =
        grownHeight === undefined
          ? table.rows
          : table.rows.map((row, i) =>
              i === rowIndex
                ? {
                    ...row,
                    height: Math.max(grownHeight, TABLE_MIN_ROW_HEIGHT),
                  }
                : row,
            )
      return {
        table: { ...table, rows, cells: withCell(table.cells, key, next) },
        inverse: {
          type: 'setCellText',
          rowId: op.rowId,
          colId: op.colId,
          text: prior?.text ?? '',
          ...(prior?.textRuns && prior.textRuns.length > 0
            ? { textRuns: prior.textRuns }
            : {}),
          ...(op.rowHeight === undefined ? {} : { rowHeight: priorHeight }),
        },
      }
    }
    case 'setCellFill':
    case 'setCellAlign': {
      for (const ref of op.cells) requireCell(table, ref)
      let cells = table.cells
      const before: Array<{
        rowId: string
        colId: string
        cell: TableCell | null
      }> = []
      for (const ref of op.cells) {
        const key = cellKey(ref.rowId, ref.colId)
        const prior = lookupCell(cells, key) ?? null
        before.push({ rowId: ref.rowId, colId: ref.colId, cell: prior })
        const next: TableCell = { ...(prior ?? { text: '' }) }
        if (op.type === 'setCellFill') {
          if (op.fill === null) delete next.fill
          else next.fill = op.fill
        } else {
          next.textAlign = op.align
        }
        cells = withCell(cells, key, next)
      }
      return {
        table: { ...table, cells },
        inverse: { type: 'restoreCells', cells: before },
      }
    }
    case 'restoreCells': {
      for (const entry of op.cells) requireCell(table, entry)
      let cells = table.cells
      const before: Array<{
        rowId: string
        colId: string
        cell: TableCell | null
      }> = []
      for (const entry of op.cells) {
        const key = cellKey(entry.rowId, entry.colId)
        before.push({
          rowId: entry.rowId,
          colId: entry.colId,
          cell: lookupCell(cells, key) ?? null,
        })
        cells = withCell(cells, key, entry.cell)
      }
      return {
        table: { ...table, cells },
        inverse: { type: 'restoreCells', cells: before.reverse() },
      }
    }
    case 'insertRow': {
      checkId(op.row.id)
      if (table.rows.some((row) => row.id === op.row.id)) {
        throw new TableOpError('INVALID', 'Row id already exists')
      }
      checkSize(table.rows.length + 1, table.cols.length)
      const at =
        op.afterRowId === null ? 0 : requireRow(table, op.afterRowId) + 1
      const rows = [...table.rows]
      rows.splice(at, 0, {
        id: op.row.id,
        height: Math.max(op.row.height, TABLE_MIN_ROW_HEIGHT),
      })
      let cells = table.cells
      for (const [colId, cell] of Object.entries(op.cells ?? {})) {
        requireCol(table, colId)
        cells = withCell(cells, cellKey(op.row.id, colId), cell)
      }
      return {
        table: { ...table, rows, cells },
        inverse: { type: 'removeRow', rowId: op.row.id },
      }
    }
    case 'removeRow': {
      const index = requireRow(table, op.rowId)
      if (table.rows.length <= 1) {
        throw new TableOpError(
          'LAST_ROW_OR_COL',
          'A table keeps at least one row',
        )
      }
      const removed = table.rows[index]
      const restored: Record<string, TableCell> = {}
      const cells = { ...table.cells }
      for (const col of table.cols) {
        const key = cellKey(op.rowId, col.id)
        if (key in cells) {
          restored[col.id] = cells[key]
          delete cells[key]
        }
      }
      return {
        table: {
          ...table,
          rows: table.rows.filter((row) => row.id !== op.rowId),
          cells,
        },
        inverse: {
          type: 'insertRow',
          afterRowId: index === 0 ? null : table.rows[index - 1].id,
          row: { id: removed.id, height: removed.height },
          ...(Object.keys(restored).length > 0 ? { cells: restored } : {}),
        },
      }
    }
    case 'insertCol': {
      checkId(op.col.id)
      if (table.cols.some((col) => col.id === op.col.id)) {
        throw new TableOpError('INVALID', 'Column id already exists')
      }
      checkSize(table.rows.length, table.cols.length + 1)
      const at =
        op.afterColId === null ? 0 : requireCol(table, op.afterColId) + 1
      const cols = [...table.cols]
      cols.splice(at, 0, {
        id: op.col.id,
        width: Math.max(op.col.width, TABLE_MIN_COL_WIDTH),
      })
      let cells = table.cells
      for (const [rowId, cell] of Object.entries(op.cells ?? {})) {
        requireRow(table, rowId)
        cells = withCell(cells, cellKey(rowId, op.col.id), cell)
      }
      return {
        table: { ...table, cols, cells },
        inverse: { type: 'removeCol', colId: op.col.id },
      }
    }
    case 'removeCol': {
      const index = requireCol(table, op.colId)
      if (table.cols.length <= 1) {
        throw new TableOpError(
          'LAST_ROW_OR_COL',
          'A table keeps at least one column',
        )
      }
      const removed = table.cols[index]
      const restored: Record<string, TableCell> = {}
      const cells = { ...table.cells }
      for (const row of table.rows) {
        const key = cellKey(row.id, op.colId)
        if (key in cells) {
          restored[row.id] = cells[key]
          delete cells[key]
        }
      }
      return {
        table: {
          ...table,
          cols: table.cols.filter((col) => col.id !== op.colId),
          cells,
        },
        inverse: {
          type: 'insertCol',
          afterColId: index === 0 ? null : table.cols[index - 1].id,
          col: { id: removed.id, width: removed.width },
          ...(Object.keys(restored).length > 0 ? { cells: restored } : {}),
        },
      }
    }
    case 'resizeRow': {
      const index = requireRow(table, op.rowId)
      const height = Math.max(op.height, TABLE_MIN_ROW_HEIGHT)
      return {
        table: {
          ...table,
          rows: table.rows.map((row, i) =>
            i === index ? { ...row, height } : row,
          ),
        },
        inverse: {
          type: 'resizeRow',
          rowId: op.rowId,
          height: table.rows[index].height,
        },
      }
    }
    case 'resizeCol': {
      const index = requireCol(table, op.colId)
      const width = Math.max(op.width, TABLE_MIN_COL_WIDTH)
      return {
        table: {
          ...table,
          cols: table.cols.map((col, i) =>
            i === index ? { ...col, width } : col,
          ),
        },
        inverse: {
          type: 'resizeCol',
          colId: op.colId,
          width: table.cols[index].width,
        },
      }
    }
    case 'scaleTable': {
      if (!(op.sx > 0) || !(op.sy > 0)) {
        throw new TableOpError('INVALID', 'Scale factors must be positive')
      }
      return {
        table: {
          ...table,
          rows: table.rows.map((row) => ({
            ...row,
            height: Math.max(row.height * op.sy, TABLE_MIN_ROW_HEIGHT),
          })),
          cols: table.cols.map((col) => ({
            ...col,
            width: Math.max(col.width * op.sx, TABLE_MIN_COL_WIDTH),
          })),
        },
        inverse: {
          type: 'setSizes',
          rows: table.rows.map((row) => ({ ...row })),
          cols: table.cols.map((col) => ({ ...col })),
        },
      }
    }
    case 'setSizes': {
      for (const row of op.rows) requireRow(table, row.id)
      for (const col of op.cols) requireCol(table, col.id)
      const heights = new Map(op.rows.map((row) => [row.id, row.height]))
      const widths = new Map(op.cols.map((col) => [col.id, col.width]))
      return {
        table: {
          ...table,
          rows: table.rows.map((row) => ({
            ...row,
            height: Math.max(
              heights.get(row.id) ?? row.height,
              TABLE_MIN_ROW_HEIGHT,
            ),
          })),
          cols: table.cols.map((col) => ({
            ...col,
            width: Math.max(
              widths.get(col.id) ?? col.width,
              TABLE_MIN_COL_WIDTH,
            ),
          })),
        },
        inverse: {
          type: 'setSizes',
          rows: table.rows.map((row) => ({ ...row })),
          cols: table.cols.map((col) => ({ ...col })),
        },
      }
    }
    case 'setHeaderRow':
      return {
        table: { ...table, headerRow: op.on },
        inverse: { type: 'setHeaderRow', on: table.headerRow },
      }
  }
}

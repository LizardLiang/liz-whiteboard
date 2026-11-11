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
  | {
      type: 'scaleTable'
      sx: number
      sy: number
      /** How far the table's top-left moves: a resize from a left or top handle keeps the opposite side still. */
      dx?: number
      dy?: number
    }
  | { type: 'setHeaderRow'; on: boolean }
  /** The inverse of `scaleTable`: puts every named row height and column width back. */
  | {
      type: 'setSizes'
      rows: Array<TableRow>
      cols: Array<TableCol>
      dx?: number
      dy?: number
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

/**
 * What a cell must hold for a table op to apply: the contested check of an
 * undo or redo. Text and runs only — fill and alignment are not edited by the
 * ops an expectation guards.
 */
export interface CellExpect {
  rowId: string
  colId: string
  text: string
  textRuns?: Array<CanvasTextRun>
}

function sameRunList(
  a: ReadonlyArray<CanvasTextRun> | undefined,
  b: ReadonlyArray<CanvasTextRun> | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  return JSON.stringify(left) === JSON.stringify(right)
}

/** True when every expected cell holds exactly the expected text and runs. */
export function tableMatchesExpect(
  table: CanvasTable,
  expect: ReadonlyArray<CellExpect>,
): boolean {
  return expect.every((entry) => {
    const cell = lookupCell(table.cells, cellKey(entry.rowId, entry.colId))
    return (
      (cell?.text ?? '') === entry.text &&
      sameRunList(cell?.textRuns, entry.textRuns)
    )
  })
}

/** What `op` leaves in the cells it writes — the expectation its undo is guarded by. */
export function expectAfterOp(
  table: CanvasTable,
  op: TableOp,
): Array<CellExpect> | undefined {
  if (op.type === 'setCellText') {
    return [
      {
        rowId: op.rowId,
        colId: op.colId,
        text: op.text,
        ...(op.textRuns && op.textRuns.length > 0
          ? { textRuns: op.textRuns }
          : {}),
      },
    ]
  }
  if (op.type === 'removeRow') {
    // Undoing a row insert removes the row: it must still be blank.
    return table.cols.map((col) => ({
      rowId: op.rowId,
      colId: col.id,
      text: '',
    }))
  }
  return undefined
}

function expectOf(
  table: CanvasTable,
  refs: ReadonlyArray<CellRef>,
): Array<CellExpect> {
  return refs.map((ref) => {
    const cell = lookupCell(table.cells, cellKey(ref.rowId, ref.colId))
    return {
      rowId: ref.rowId,
      colId: ref.colId,
      text: cell?.text ?? '',
      ...(cell?.textRuns && cell.textRuns.length > 0
        ? { textRuns: cell.textRuns }
        : {}),
    }
  })
}

/**
 * What the cells must hold for the UNDO of a user op to apply: the text the
 * op itself left behind. `table` is the table as it stood before the op.
 * A structural op that removes cells has nothing left to contest.
 */
export function undoExpectFor(
  table: CanvasTable,
  op: TableOp,
  inverse: TableOp,
): Array<CellExpect> | undefined {
  switch (op.type) {
    case 'setCellText':
      return expectAfterOp(table, op)
    case 'insertRow':
      // An undo removes the row: it must still be blank.
      return expectAfterOp(table, inverse)
    case 'insertCol':
      return table.rows.map((row) => ({
        rowId: row.id,
        colId: op.col.id,
        text: '',
      }))
    case 'restoreCells':
      return op.cells.map((entry) => ({
        rowId: entry.rowId,
        colId: entry.colId,
        text: entry.cell?.text ?? '',
        ...(entry.cell?.textRuns && entry.cell.textRuns.length > 0
          ? { textRuns: entry.cell.textRuns }
          : {}),
      }))
    default:
      return undefined
  }
}

/**
 * What the cells must hold for the REDO of a user op to apply: the content
 * the op replaced or removed. Without it, a redo of a row delete would discard
 * text a collaborator typed into the restored row.
 */
export function redoExpectFor(
  table: CanvasTable,
  op: TableOp,
  inverse: TableOp,
): Array<CellExpect> | undefined {
  switch (op.type) {
    case 'setCellText':
      return expectAfterOp(table, inverse)
    case 'removeRow':
      return expectOf(
        table,
        table.cols.map((col) => ({ rowId: op.rowId, colId: col.id })),
      )
    case 'removeCol':
      return expectOf(
        table,
        table.rows.map((row) => ({ rowId: row.id, colId: op.colId })),
      )
    case 'restoreCells':
      return expectOf(table, op.cells)
    default:
      return undefined
  }
}

// ── selection ───────────────────────────────────────────────────────────────

/** The cells, row or column a user picked inside one table. Client-only state. */
export type TableSelection =
  | { tableId: string; kind: 'cells'; anchor: CellRef; focus: CellRef }
  | { tableId: string; kind: 'row'; rowId: string }
  | { tableId: string; kind: 'col'; colId: string }

/** The cell at a world point, or null outside the table. */
export function cellAtPoint(
  element: Pick<CanvasElement, 'x' | 'y' | 'table'>,
  world: { x: number; y: number },
): CellRef | null {
  const table = element.table
  if (!table) return null
  let y = element.y
  let rowId: string | null = null
  for (const row of table.rows) {
    if (world.y >= y && world.y < y + row.height) {
      rowId = row.id
      break
    }
    y += row.height
  }
  let x = element.x
  let colId: string | null = null
  for (const col of table.cols) {
    if (world.x >= x && world.x < x + col.width) {
      colId = col.id
      break
    }
    x += col.width
  }
  return rowId !== null && colId !== null ? { rowId, colId } : null
}

/** A grabber strip's size on screen, in px. */
export const TABLE_GRIP_PX = 14

export type TableGrip =
  { kind: 'row'; rowId: string } | { kind: 'col'; colId: string }

/**
 * The row or column grabber at a world point. A row grabber is a strip just
 * left of the table, a column grabber a strip just above it; `padWorld` is the
 * strip's width in world units (screen px divided by the zoom).
 */
export function gripAtPoint(
  element: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height' | 'table'>,
  world: { x: number; y: number },
  padWorld: number,
): TableGrip | null {
  const table = element.table
  if (!table) return null
  if (
    world.x >= element.x - padWorld &&
    world.x < element.x &&
    world.y >= element.y &&
    world.y < element.y + element.height
  ) {
    const cell = cellAtPoint(element, { x: element.x, y: world.y })
    return cell ? { kind: 'row', rowId: cell.rowId } : null
  }
  if (
    world.y >= element.y - padWorld &&
    world.y < element.y &&
    world.x >= element.x &&
    world.x < element.x + element.width
  ) {
    const cell = cellAtPoint(element, { x: world.x, y: element.y })
    return cell ? { kind: 'col', colId: cell.colId } : null
  }
  return null
}

/** Every cell a selection covers, row-major. A range is the rectangle between its corners. */
export function selectionCells(
  table: CanvasTable,
  selection: TableSelection,
): Array<CellRef> {
  if (selection.kind === 'row') {
    return table.rows.some((row) => row.id === selection.rowId)
      ? table.cols.map((col) => ({ rowId: selection.rowId, colId: col.id }))
      : []
  }
  if (selection.kind === 'col') {
    return table.cols.some((col) => col.id === selection.colId)
      ? table.rows.map((row) => ({ rowId: row.id, colId: selection.colId }))
      : []
  }
  const r1 = table.rows.findIndex((row) => row.id === selection.anchor.rowId)
  const r2 = table.rows.findIndex((row) => row.id === selection.focus.rowId)
  const c1 = table.cols.findIndex((col) => col.id === selection.anchor.colId)
  const c2 = table.cols.findIndex((col) => col.id === selection.focus.colId)
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return []
  const out: Array<CellRef> = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) {
      out.push({ rowId: table.rows[r].id, colId: table.cols[c].id })
    }
  }
  return out
}

/**
 * The selection after a table change: a row or column that no longer exists
 * drops out. Returns null when nothing selectable remains.
 */
export function pruneSelection(
  table: CanvasTable,
  selection: TableSelection,
): TableSelection | null {
  return selectionCells(table, selection).length > 0 ? selection : null
}

/** The cell `dRow`/`dCol` steps from `from`, clamped at the table's edges. */
export function stepCell(
  table: CanvasTable,
  from: CellRef,
  dRow: number,
  dCol: number,
): CellRef {
  const r = table.rows.findIndex((row) => row.id === from.rowId)
  const c = table.cols.findIndex((col) => col.id === from.colId)
  if (r < 0 || c < 0) return from
  const row = Math.min(table.rows.length - 1, Math.max(0, r + dRow))
  const col = Math.min(table.cols.length - 1, Math.max(0, c + dCol))
  return { rowId: table.rows[row].id, colId: table.cols[col].id }
}

/**
 * The cell Tab (`direction` 1) or Shift+Tab (-1) moves to, reading order, or
 * null past the last (first) cell.
 */
export function tabCell(
  table: CanvasTable,
  from: CellRef,
  direction: 1 | -1,
): CellRef | null {
  const r = table.rows.findIndex((row) => row.id === from.rowId)
  const c = table.cols.findIndex((col) => col.id === from.colId)
  if (r < 0 || c < 0) return null
  const index = r * table.cols.length + c + direction
  if (index < 0 || index >= table.rows.length * table.cols.length) return null
  return {
    rowId: table.rows[Math.floor(index / table.cols.length)].id,
    colId: table.cols[index % table.cols.length].id,
  }
}

/** The inverse of a shift: an op that moved the table by (dx, dy) is undone by moving it back. */
function shiftBack(op: { dx?: number; dy?: number }): {
  dx?: number
  dy?: number
} {
  return {
    ...(op.dx ? { dx: -op.dx } : {}),
    ...(op.dy ? { dy: -op.dy } : {}),
  }
}

/** How far an op moves the table's top-left corner. Only a resize from a left or top handle moves it. */
export function tableOpShift(op: TableOp): { dx: number; dy: number } {
  if (op.type === 'scaleTable' || op.type === 'setSizes') {
    return { dx: op.dx ?? 0, dy: op.dy ?? 0 }
  }
  return { dx: 0, dy: 0 }
}

// ── rows and columns: hover affordances, borders, resize ────────────────────

/** Diameter of the hover "+" button, in screen px. */
export const TABLE_PLUS_PX = 18
/** How far the "+" centre sits outside the table edge, in screen px. */
export const TABLE_PLUS_OFFSET_PX = 14
/** Half-width of the strip around a border that counts as "on" it, inside the table, in screen px. */
export const TABLE_BORDER_HIT_PX = 4
/** Where the append bar sits: its near and far edge outside the table, in screen px. */
export const TABLE_APPEND_NEAR_PX = 4
export const TABLE_APPEND_FAR_PX = 16

/**
 * What the pointer is over on a selected table, beyond its cells. `at` is the
 * world coordinate of the border the affordance belongs to (x for a column
 * border, y for a row border). Only the first four are pressable as a
 * button; the two `border-*` kinds are the draggable inner borders, and they
 * also reveal the "+" of their own border.
 */
export type TableAffordance =
  | { kind: 'insert-col'; afterColId: string; at: number }
  | { kind: 'insert-row'; afterRowId: string; at: number }
  | { kind: 'append-col' }
  | { kind: 'append-row' }
  | { kind: 'border-col'; colId: string; afterColId: string; at: number }
  | { kind: 'border-row'; rowId: string; afterRowId: string; at: number }

/** True when `a` and `b` name the same affordance. */
export function sameAffordance(
  a: TableAffordance | null,
  b: TableAffordance | null,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The world x of each INNER column border: between column i and i + 1. */
function innerColBorders(
  element: Pick<CanvasElement, 'x' | 'table'>,
): Array<{ colId: string; nextColId: string; at: number }> {
  const table = element.table
  if (!table) return []
  const out: Array<{ colId: string; nextColId: string; at: number }> = []
  let x = element.x
  for (let i = 0; i < table.cols.length - 1; i += 1) {
    x += table.cols[i].width
    out.push({
      colId: table.cols[i].id,
      nextColId: table.cols[i + 1].id,
      at: x,
    })
  }
  return out
}

/** The world y of each INNER row border: between row i and i + 1. */
function innerRowBorders(
  element: Pick<CanvasElement, 'y' | 'table'>,
): Array<{ rowId: string; nextRowId: string; at: number }> {
  const table = element.table
  if (!table) return []
  const out: Array<{ rowId: string; nextRowId: string; at: number }> = []
  let y = element.y
  for (let i = 0; i < table.rows.length - 1; i += 1) {
    y += table.rows[i].height
    out.push({
      rowId: table.rows[i].id,
      nextRowId: table.rows[i + 1].id,
      at: y,
    })
  }
  return out
}

/**
 * Where an affordance's border is NOW, in world units. A border drag moves the
 * border while the hover state still holds where it started.
 */
export function affordanceBorderAt(
  element: Pick<CanvasElement, 'x' | 'y' | 'table'>,
  affordance: TableAffordance,
): number | null {
  const table = element.table
  if (!table) return null
  if (affordance.kind === 'append-col' || affordance.kind === 'append-row') {
    return null
  }
  if (affordance.kind === 'insert-col' || affordance.kind === 'border-col') {
    const id = affordance.afterColId
    const index = table.cols.findIndex((col) => col.id === id)
    if (index < 0) return null
    return (
      element.x +
      table.cols.slice(0, index + 1).reduce((sum, col) => sum + col.width, 0)
    )
  }
  const id = affordance.afterRowId
  const index = table.rows.findIndex((row) => row.id === id)
  if (index < 0) return null
  return (
    element.y +
    table.rows.slice(0, index + 1).reduce((sum, row) => sum + row.height, 0)
  )
}

/** The "+" button of an inner border, as a screen-space-sized rect in WORLD units (`zoom` converts px). */
export function tablePlusRect(
  element: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>,
  kind: 'col' | 'row',
  at: number,
  zoom: number,
): WorldRect {
  const size = TABLE_PLUS_PX / zoom
  const offset = TABLE_PLUS_OFFSET_PX / zoom
  return kind === 'col'
    ? {
        x: at - size / 2,
        y: element.y + element.height + offset - size / 2,
        width: size,
        height: size,
      }
    : {
        x: element.x + element.width + offset - size / 2,
        y: at - size / 2,
        width: size,
        height: size,
      }
}

/** The append bar past the last column (`kind: 'col'`) or the last row, in WORLD units. */
export function tableAppendRect(
  element: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>,
  kind: 'col' | 'row',
  zoom: number,
): WorldRect {
  const near = TABLE_APPEND_NEAR_PX / zoom
  const thick = (TABLE_APPEND_FAR_PX - TABLE_APPEND_NEAR_PX) / zoom
  return kind === 'col'
    ? {
        x: element.x + element.width + near,
        y: element.y,
        width: thick,
        height: element.height,
      }
    : {
        x: element.x,
        y: element.y + element.height + near,
        width: element.width,
        height: thick,
      }
}

function rectHas(rect: WorldRect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * The affordance under a world point on a table: a "+" button, an append bar,
 * or an inner border. A button beats a bar, a bar beats a border. `canInsertRow`
 * and `canInsertCol` are false at the cell cap, which hides every way to add.
 *
 * The "+" button of a border answers over the strip between the table's edge
 * and the button's far side, so moving the pointer from the border out to the
 * button never crosses a dead zone.
 */
export function tableAffordanceAt(
  element: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height' | 'table'>,
  world: { x: number; y: number },
  zoom: number,
  limits: { canInsertRow: boolean; canInsertCol: boolean },
): TableAffordance | null {
  if (!element.table) return null
  const pad = TABLE_BORDER_HIT_PX / zoom
  const reach = (TABLE_PLUS_OFFSET_PX + TABLE_PLUS_PX / 2) / zoom
  const right = element.x + element.width
  const bottom = element.y + element.height
  const cols = innerColBorders(element)
  const rows = innerRowBorders(element)

  if (limits.canInsertCol) {
    for (const border of cols) {
      const half = TABLE_PLUS_PX / 2 / zoom
      if (
        Math.abs(world.x - border.at) <= half &&
        world.y >= bottom &&
        world.y <= bottom + reach
      ) {
        return { kind: 'insert-col', afterColId: border.colId, at: border.at }
      }
    }
  }
  if (limits.canInsertRow) {
    for (const border of rows) {
      const half = TABLE_PLUS_PX / 2 / zoom
      if (
        Math.abs(world.y - border.at) <= half &&
        world.x >= right &&
        world.x <= right + reach
      ) {
        return { kind: 'insert-row', afterRowId: border.rowId, at: border.at }
      }
    }
  }
  if (
    limits.canInsertCol &&
    rectHas(tableAppendRect(element, 'col', zoom), world)
  ) {
    return { kind: 'append-col' }
  }
  if (
    limits.canInsertRow &&
    rectHas(tableAppendRect(element, 'row', zoom), world)
  ) {
    return { kind: 'append-row' }
  }
  const inside =
    world.x >= element.x &&
    world.x <= right &&
    world.y >= element.y &&
    world.y <= bottom
  if (inside) {
    for (const border of cols) {
      if (Math.abs(world.x - border.at) <= pad) {
        return {
          kind: 'border-col',
          colId: border.colId,
          afterColId: border.colId,
          at: border.at,
        }
      }
    }
    for (const border of rows) {
      if (Math.abs(world.y - border.at) <= pad) {
        return {
          kind: 'border-row',
          rowId: border.rowId,
          afterRowId: border.rowId,
          at: border.at,
        }
      }
    }
  }
  return null
}

/** Handles a table scales from. Matches `ResizeHandle` in render.ts, spelled out so this module imports nothing from it. */
export type TableScaleHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/**
 * The scale a drag of `handle` asks of a table, clamped so no column drops
 * under the minimum width and no row under its content height.
 *
 * A corner scales both axes by the same factor (the larger change wins), an
 * edge scales one axis. `dx` and `dy` move the top-left corner so a drag from
 * the left or top handle keeps the opposite side still.
 */
export function tableScaleForDrag(
  handle: TableScaleHandle,
  table: CanvasTable,
  start: WorldRect,
  world: { x: number; y: number },
  rowMinHeights: ReadonlyArray<number>,
): { sx: number; sy: number; dx: number; dy: number } {
  const right = start.x + start.width
  const bottom = start.y + start.height
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  const wantWidth = east
    ? world.x - start.x
    : west
      ? right - world.x
      : start.width
  const wantHeight = south
    ? world.y - start.y
    : north
      ? bottom - world.y
      : start.height
  let sx = wantWidth / start.width
  let sy = wantHeight / start.height
  const corner = (west || east) && (north || south)
  if (corner) {
    const uniform = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy
    sx = uniform
    sy = uniform
  } else if (!(west || east)) {
    sx = 1
  } else {
    sy = 1
  }
  const minSx = Math.max(
    ...table.cols.map((col) => TABLE_MIN_COL_WIDTH / col.width),
  )
  const minSy = Math.max(
    ...table.rows.map(
      (row, i) =>
        Math.max(
          rowMinHeights[i] ?? TABLE_MIN_ROW_HEIGHT,
          TABLE_MIN_ROW_HEIGHT,
        ) / row.height,
    ),
  )
  const floor = corner ? Math.max(minSx, minSy) : 1
  const scaleX =
    west || east ? Math.min(100, Math.max(sx, corner ? floor : minSx)) : 1
  const scaleY =
    north || south ? Math.min(100, Math.max(sy, corner ? floor : minSy)) : 1
  return {
    sx: scaleX,
    sy: scaleY,
    dx: west ? start.width - start.width * scaleX : 0,
    dy: north ? start.height - start.height * scaleY : 0,
  }
}

/** The id of a cell's virtual text element, and its parts back. */
export function cellElementId(
  tableId: string,
  rowId: string,
  colId: string,
): string {
  return `${tableId}:${rowId}:${colId}`
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
          ...shiftBack(op),
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
          ...shiftBack(op),
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

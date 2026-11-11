// src/components/canvas/use-canvas-table-input.ts
// Table interaction for the canvas input hook: cell and row/column selection,
// cell editing, table ops, the "+" buttons, append bars, grabbers, border and
// scale drags, the right-click menu and the table cursor.
//
// Extracted from `use-canvas-input.ts` without a change in behaviour. That hook
// keeps the generic pointer and keyboard dispatch and calls into this one at the
// same points, in the same order.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Dispatch,
  MutableRefObject,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from 'react'
import type { Camera, Point } from '@/lib/canvas-engine/camera'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type {
  CanvasTable,
  CellRef,
  TableAffordance,
  TableOp,
  TableSelection,
} from '@/lib/canvas-engine/table'
import type { ResizeHandle } from '@/lib/canvas-engine/render'
import type { TextMeasurer } from '@/lib/canvas-engine/text-layout'
import type { CanvasFontSpec } from '@/lib/canvas-engine/render-target'
import type {
  CanvasEditCallbacks,
  CanvasTool,
  EditingState,
  Gesture,
  PendingTextEdit,
  TextEditResult,
} from './use-canvas-input'
import { hitTest } from '@/lib/canvas-engine/hit-test'
import {
  TABLE_CELL_HEIGHT,
  TABLE_CELL_WIDTH,
  TABLE_GRIP_PX,
  TABLE_MAX_CELLS,
  TABLE_MIN_COL_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
  applyTableOp as applyTableOpLocally,
  cellAtPoint,
  cellElementId,
  cellKey,
  cellTextElement,
  gripAtPoint,
  lookupCell,
  pruneSelection,
  sameAffordance,
  selectionCells,
  stepCell,
  tabCell,
  tableAffordanceAt,
  tableHoverAffordanceAt,
  tableScaleForDrag,
  tableSize,
} from '@/lib/canvas-engine/table'
import {
  addElement,
  nextZIndex,
  removeElements,
  updateElement,
} from '@/lib/canvas-engine/scene'
import { fittedTextHeight, fontSpecOf } from '@/lib/canvas-engine/render'
import { sameRuns } from '@/lib/canvas-engine/text-runs'
import { uuid } from '@/lib/uuid'

/** Arrow key to [rows, columns] step of the table cell selection. */
const TABLE_ARROW_STEPS: Partial<Record<string, [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}
/** Whether one more row, or one more column, still fits under the cell cap. */
export function tableInsertLimits(grid: CanvasTable): {
  canInsertRow: boolean
  canInsertCol: boolean
} {
  return {
    canInsertRow: (grid.rows.length + 1) * grid.cols.length <= TABLE_MAX_CELLS,
    canInsertCol: grid.rows.length * (grid.cols.length + 1) <= TABLE_MAX_CELLS,
  }
}

/** What the right-click menu on a table acts on, and which of its items are live. */
export interface TableMenuState {
  tableId: string
  rowId: string
  colId: string
  canInsertRow: boolean
  canInsertCol: boolean
  canDeleteRow: boolean
  canDeleteCol: boolean
}

export type TableMenuAction =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'insertColLeft'
  | 'insertColRight'
  | 'deleteRow'
  | 'deleteCol'
  | 'clearCells'

/** `grid` with one row set to `height`. */
export function withRowHeight(
  grid: CanvasTable,
  rowId: string,
  height: number,
): CanvasTable {
  return {
    ...grid,
    rows: grid.rows.map((row) => (row.id === rowId ? { ...row, height } : row)),
  }
}
type TableBorderGesture = Extract<Gesture, { kind: 'table-border' }>
type TableScaleGesture = Extract<Gesture, { kind: 'table-scale' }>

/** What the table hook reads from the input hook's `latest` ref. */
export interface TableInputLatest {
  scene: Scene
  camera: Camera
  tool: CanvasTool
  readOnly: boolean
  selectedIds: ReadonlySet<string>
  editing: EditingState | null
}

export interface UseCanvasTableInputArgs {
  latest: MutableRefObject<TableInputLatest>
  scene: Scene
  setScene: Dispatch<SetStateAction<Scene>>
  selectedIds: ReadonlySet<string>
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  setGesture: (next: Gesture) => void
  editingRef: MutableRefObject<EditingState | null>
  setEditing: (
    next:
      | EditingState
      | null
      | ((current: EditingState | null) => EditingState | null),
  ) => void
  setCaretVisible: Dispatch<SetStateAction<boolean>>
  pendingTextEditsRef: MutableRefObject<Array<PendingTextEdit>>
  textInputRef?: RefObject<HTMLTextAreaElement | null>
  getMeasurer: (spec: CanvasFontSpec) => TextMeasurer | null
  callbacks?: CanvasEditCallbacks
  /** `replaceEdit` of the input hook: the first keystroke that opens a cell. */
  replaceEdit: (
    text: string,
    a: number,
    b: number,
    insertion: string,
  ) => TextEditResult
}

export function useCanvasTableInput({
  latest,
  scene,
  setScene,
  selectedIds,
  setSelectedIds,
  setGesture,
  editingRef,
  setEditing,
  setCaretVisible,
  pendingTextEditsRef,
  textInputRef,
  getMeasurer,
  callbacks,
  replaceEdit,
}: UseCanvasTableInputArgs) {
  // The cells, row or column picked inside a selected table. Client-only; a
  // ref mirror for the same reason `editingRef` has one.
  const [tableSelection, setTableSelectionState] =
    useState<TableSelection | null>(null)
  const tableSelectionRef = useRef<TableSelection | null>(null)
  const setTableSelection = useCallback((next: TableSelection | null) => {
    tableSelectionRef.current = next
    setTableSelectionState(next)
  }, [])
  // What the pointer is over on the selected table beyond its cells (a "+"
  // button, an append bar, an inner border). Chrome only, never persisted.
  const [tableAffordance, setTableAffordanceState] = useState<{
    tableId: string
    affordance: TableAffordance
  } | null>(null)
  const setTableAffordance = useCallback(
    (next: { tableId: string; affordance: TableAffordance } | null) => {
      setTableAffordanceState((current) =>
        current?.tableId === next?.tableId &&
        sameAffordance(current?.affordance ?? null, next?.affordance ?? null)
          ? current
          : next,
      )
    },
    [],
  )
  // The cell a right-click landed on; the context menu acts on it.
  const [tableMenuTarget, setTableMenuTarget] = useState<{
    tableId: string
    rowId: string
    colId: string
  } | null>(null)

  // Table cell edits (see `beginCellEditing`) write the scene and one row's
  // height from several places, so both writers live up here.
  /** Write the scene now and mirror it into `latest`, so a handler running in the same frame reads what this wrote. */
  const writeScene = useCallback(
    (produce: (current: Scene) => Scene) => {
      setScene(produce)
      latest.current.scene = produce(latest.current.scene)
    },
    [setScene, latest],
  )

  /** Set one row's height in the local scene: only ever taller when `onlyGrow`. */
  const setRowHeight = useCallback(
    (tableId: string, rowId: string, height: number, onlyGrow: boolean) => {
      writeScene((prev) => {
        const element = prev.byId.get(tableId)
        const grid = element?.table
        if (!element || !grid) return prev
        const row = grid.rows.find((entry) => entry.id === rowId)
        if (!row || row.height === height) return prev
        if (onlyGrow && row.height >= height) return prev
        const table: CanvasTable = {
          ...grid,
          rows: grid.rows.map((entry) =>
            entry.id === rowId ? { ...entry, height } : entry,
          ),
        }
        return updateElement(prev, tableId, { table, ...tableSize(table) })
      })
    },
    [writeScene],
  )

  // The table selection follows the element selection and the table itself: it
  // drops when something else is selected, when the table goes, or when a remote
  // op removes the row or column it names.
  useEffect(() => {
    const picked = tableSelectionRef.current
    if (!picked) return
    const grid = scene.byId.get(picked.tableId)?.table
    const stillOne = selectedIds.size === 1 && selectedIds.has(picked.tableId)
    if (!grid || !stillOne || !pruneSelection(grid, picked)) {
      setTableSelection(null)
    }
  }, [scene, selectedIds, setTableSelection])

  // ── table cells ──────────────────────────────────────────────────────────
  //
  // A cell is edited as a virtual `text` element (`cellTextElement`) that lives
  // in the scene for the length of the edit, so the caret, selection, IME, text
  // bar and every layout call run on it unchanged. Commit takes it out again and
  // sends one `setCellText` table op.

  /**
   * Open a cell for typing. `typed` is a key that started the edit from a
   * selected cell: it is queued as the first keystroke, so it lands after the
   * caret like any other.
   */
  const beginCellEditing = useCallback(
    (tableId: string, cell: CellRef, caret: number | 'end', typed?: string) => {
      const tableElement = latest.current.scene.byId.get(tableId)
      if (!tableElement?.table) return
      const virtual = cellTextElement(tableElement, cell.rowId, cell.colId)
      if (!virtual) return
      const element: CanvasElement = {
        ...virtual,
        // Above everything, so a press in the cell reaches the editor first.
        zIndex: nextZIndex(latest.current.scene),
      }
      writeScene((prev) =>
        addElement(removeElements(prev, [element.id]), element),
      )
      textInputRef?.current?.focus({ preventScroll: true })
      const at = caret === 'end' ? (element.text ?? '').length : caret
      pendingTextEditsRef.current = []
      setEditing({
        elementId: element.id,
        caret: at,
        anchor: at,
        composition: '',
        isNew: false,
        before: { ...element },
        cell: { tableId, rowId: cell.rowId, colId: cell.colId },
      })
      if (typed) {
        pendingTextEditsRef.current.push({
          elementId: element.id,
          produce: (value, position, _element, anchor) =>
            replaceEdit(value, anchor, position, typed),
        })
      }
      setSelectedIds(new Set([tableId]))
      setTableSelection({ tableId, kind: 'cells', anchor: cell, focus: cell })
      setCaretVisible(true)
    },
    [
      setEditing,
      setTableSelection,
      textInputRef,
      writeScene,
      latest,
      pendingTextEditsRef,
      replaceEdit,
      setCaretVisible,
      setSelectedIds,
    ],
  )

  /** The scene change and table op that end a cell edit. */
  const finishCellEdit = useCallback(
    (
      current: EditingState,
      cell: NonNullable<EditingState['cell']>,
      element: CanvasElement,
    ) => {
      writeScene((prev) => removeElements(prev, [element.id]))
      const tableElement = latest.current.scene.byId.get(cell.tableId)
      if (!tableElement?.table) return
      const before = current.before ?? element
      const baseHeight = before.height
      const runs = element.style.textRuns
      const unchanged =
        (before.text ?? '') === (element.text ?? '') &&
        sameRuns(before.style.textRuns, element.style.textRuns)
      if (unchanged) {
        // Typing grew the row for the preview; nothing was kept.
        setRowHeight(cell.tableId, cell.rowId, baseHeight, false)
        return
      }
      // The server cannot measure text, so the row height travels in the op.
      const measure = getMeasurer(fontSpecOf(element.style))
      const fitted = measure ? Math.ceil(fittedTextHeight(element, measure)) : 0
      const rowHeight = fitted > baseHeight ? fitted : undefined
      setRowHeight(cell.tableId, cell.rowId, rowHeight ?? baseHeight, false)
      callbacks?.onTableOp?.(
        cell.tableId,
        {
          type: 'setCellText',
          rowId: cell.rowId,
          colId: cell.colId,
          text: element.text ?? '',
          ...(runs.length > 0 ? { textRuns: runs } : {}),
          ...(rowHeight !== undefined ? { rowHeight } : {}),
        },
        // The table as it stood before this edit: typing grew the row for the
        // preview, and the undo entry must remember the height it had before.
        withRowHeight(
          latest.current.scene.byId.get(cell.tableId)?.table ??
            tableElement.table,
          cell.rowId,
          baseHeight,
        ),
      )
    },
    [callbacks, getMeasurer, setRowHeight, writeScene, latest],
  )

  /**
   * Tab (`direction` 1) or Shift+Tab (-1) inside a cell: commit it and open the
   * next or previous one. Tab in the last cell appends a row and moves into it.
   */
  const moveCellEditing = useCallback(
    (direction: 1 | -1, commitEditing: () => void) => {
      const cell = editingRef.current?.cell
      if (!cell) return
      commitEditing()
      const grid = latest.current.scene.byId.get(cell.tableId)?.table
      if (!grid) return
      const from = { rowId: cell.rowId, colId: cell.colId }
      let target = tabCell(grid, from, direction)
      if (!target) {
        const full = (grid.rows.length + 1) * grid.cols.length > TABLE_MAX_CELLS
        if (direction === -1 || full) {
          setTableSelection({
            tableId: cell.tableId,
            kind: 'cells',
            anchor: from,
            focus: from,
          })
          return
        }
        const row = { id: uuid(), height: TABLE_CELL_HEIGHT }
        const op: TableOp = {
          type: 'insertRow',
          afterRowId: grid.rows[grid.rows.length - 1].id,
          row,
        }
        // Shown now, so the next cell exists to be opened; the table op the
        // consumer sends is what persists it.
        writeScene((prev) => {
          const element = prev.byId.get(cell.tableId)
          if (!element?.table) return prev
          try {
            const { table } = applyTableOpLocally(element.table, op)
            return updateElement(prev, cell.tableId, {
              table,
              ...tableSize(table),
            })
          } catch {
            return prev
          }
        })
        callbacks?.onTableOp?.(cell.tableId, op, grid)
        target = { rowId: row.id, colId: grid.cols[0].id }
      }
      beginCellEditing(cell.tableId, target, 'end')
    },
    [
      beginCellEditing,
      callbacks,
      setTableSelection,
      writeScene,
      editingRef,
      latest,
    ],
  )

  // ── table rows and columns ───────────────────────────────────────────────
  //
  // Every structural change goes out as ONE table op through `onTableOp`, which
  // applies it to the scene at once, sends it to the server and records one
  // undo entry (with the contested checks `undoExpectFor` builds).

  const issueTableOp = useCallback(
    (tableId: string, op: TableOp) => {
      if (latest.current.readOnly) return
      const grid = latest.current.scene.byId.get(tableId)?.table
      if (!grid) return
      callbacks?.onTableOp?.(tableId, op, grid)
    },
    [callbacks, latest],
  )

  /** A row after `afterRowId` (null = first), if the cell cap allows one more. */
  const insertTableRow = useCallback(
    (tableId: string, afterRowId: string | null) => {
      const grid = latest.current.scene.byId.get(tableId)?.table
      if (!grid || !tableInsertLimits(grid).canInsertRow) return
      issueTableOp(tableId, {
        type: 'insertRow',
        afterRowId,
        row: { id: uuid(), height: TABLE_CELL_HEIGHT },
      })
    },
    [issueTableOp, latest],
  )

  const insertTableCol = useCallback(
    (tableId: string, afterColId: string | null) => {
      const grid = latest.current.scene.byId.get(tableId)?.table
      if (!grid || !tableInsertLimits(grid).canInsertCol) return
      issueTableOp(tableId, {
        type: 'insertCol',
        afterColId,
        col: { id: uuid(), width: TABLE_CELL_WIDTH },
      })
    },
    [issueTableOp, latest],
  )

  /** Remove a row; the last row is never removed. */
  const removeTableRow = useCallback(
    (tableId: string, rowId: string) => {
      const grid = latest.current.scene.byId.get(tableId)?.table
      if (!grid || grid.rows.length <= 1) return
      issueTableOp(tableId, { type: 'removeRow', rowId })
    },
    [issueTableOp, latest],
  )

  const removeTableCol = useCallback(
    (tableId: string, colId: string) => {
      const grid = latest.current.scene.byId.get(tableId)?.table
      if (!grid || grid.cols.length <= 1) return
      issueTableOp(tableId, { type: 'removeCol', colId })
    },
    [issueTableOp, latest],
  )

  /** Clear the text of `refs` in ONE op. Fill and alignment stay. Nothing to clear sends nothing. */
  const clearTableCells = useCallback(
    (tableId: string, refs: ReadonlyArray<CellRef>) => {
      const grid = latest.current.scene.byId.get(tableId)?.table
      if (!grid) return
      const cells: Array<{
        rowId: string
        colId: string
        cell: NonNullable<ReturnType<typeof lookupCell>>
      }> = []
      for (const ref of refs) {
        const prior = lookupCell(grid.cells, cellKey(ref.rowId, ref.colId))
        if (!prior || prior.text === '') continue
        const { textRuns: _runs, ...kept } = prior
        cells.push({
          rowId: ref.rowId,
          colId: ref.colId,
          cell: { ...kept, text: '' },
        })
      }
      if (cells.length === 0) return
      issueTableOp(tableId, { type: 'restoreCells', cells, only: 'text' })
    },
    [issueTableOp, latest],
  )

  /** The height each row of a table needs to show its text, the floor a resize is clamped to. */
  const tableRowMinHeights = useCallback(
    (element: CanvasElement): Array<number> => {
      const grid = element.table
      if (!grid) return []
      return grid.rows.map((row) => {
        let height = TABLE_MIN_ROW_HEIGHT
        for (const col of grid.cols) {
          const cell = lookupCell(grid.cells, cellKey(row.id, col.id))
          if (!cell || cell.text === '') continue
          const virtual = cellTextElement(element, row.id, col.id)
          const measure = virtual && getMeasurer(fontSpecOf(virtual.style))
          if (!virtual || !measure) continue
          height = Math.max(
            height,
            Math.ceil(fittedTextHeight(virtual, measure)),
          )
        }
        return height
      })
    },
    [getMeasurer],
  )

  /**
   * The affordance under a world point, when the one selected element is a
   * table the user can edit. `hover` also reveals the append bar over the last
   * column or row; a press only ever acts on the bar itself.
   */
  const affordanceAtPoint = useCallback(
    (
      world: Point,
      hover = false,
    ): { tableId: string; affordance: TableAffordance } | null => {
      const current = latest.current
      if (current.readOnly || current.tool !== 'select' || editingRef.current) {
        return null
      }
      if (current.selectedIds.size !== 1) return null
      const only = current.scene.byId.get([...current.selectedIds][0])
      if (only?.kind !== 'table' || !only.table) return null
      const find = hover ? tableHoverAffordanceAt : tableAffordanceAt
      const affordance = find(
        only,
        world,
        current.camera.zoom,
        tableInsertLimits(only.table),
      )
      return affordance ? { tableId: only.id, affordance } : null
    },
    [editingRef, latest],
  )

  /** The context menu's target with the live state of each item. */
  const tableMenu = useMemo<TableMenuState | null>(() => {
    if (!tableMenuTarget) return null
    const grid = scene.byId.get(tableMenuTarget.tableId)?.table
    if (!grid) return null
    return {
      ...tableMenuTarget,
      ...tableInsertLimits(grid),
      canDeleteRow: grid.rows.length > 1,
      canDeleteCol: grid.cols.length > 1,
    }
  }, [scene, tableMenuTarget])

  const onTableMenuAction = useCallback(
    (action: TableMenuAction) => {
      const target = tableMenuTarget
      if (!target) return
      const grid = latest.current.scene.byId.get(target.tableId)?.table
      if (!grid) return
      const row = grid.rows.findIndex((entry) => entry.id === target.rowId)
      const col = grid.cols.findIndex((entry) => entry.id === target.colId)
      if (row < 0 || col < 0) return
      switch (action) {
        case 'insertRowAbove':
          insertTableRow(
            target.tableId,
            row === 0 ? null : grid.rows[row - 1].id,
          )
          break
        case 'insertRowBelow':
          insertTableRow(target.tableId, target.rowId)
          break
        case 'insertColLeft':
          insertTableCol(
            target.tableId,
            col === 0 ? null : grid.cols[col - 1].id,
          )
          break
        case 'insertColRight':
          insertTableCol(target.tableId, target.colId)
          break
        case 'deleteRow':
          removeTableRow(target.tableId, target.rowId)
          break
        case 'deleteCol':
          removeTableCol(target.tableId, target.colId)
          break
        case 'clearCells': {
          const picked = tableSelectionRef.current
          clearTableCells(
            target.tableId,
            picked?.tableId === target.tableId
              ? selectionCells(grid, picked)
              : [{ rowId: target.rowId, colId: target.colId }],
          )
          break
        }
      }
    },
    [
      clearTableCells,
      insertTableCol,
      insertTableRow,
      removeTableCol,
      removeTableRow,
      tableMenuTarget,
      latest,
    ],
  )

  /**
   * Delete or Backspace with part of a table picked. A row or column goes (the
   * last one never does); cells lose their text in one op. Returns whether the
   * key was handled — only a whole-table selection falls through to deleting
   * the element.
   */
  const deleteTableSelection = useCallback((): boolean => {
    const picked = tableSelectionRef.current
    const ids = latest.current.selectedIds
    if (!picked || ids.size !== 1 || !ids.has(picked.tableId)) return false
    const grid = latest.current.scene.byId.get(picked.tableId)?.table
    if (!grid) return false
    if (picked.kind === 'row') removeTableRow(picked.tableId, picked.rowId)
    else if (picked.kind === 'col') removeTableCol(picked.tableId, picked.colId)
    else clearTableCells(picked.tableId, selectionCells(grid, picked))
    return true
  }, [clearTableCells, removeTableCol, removeTableRow, latest])

  // ── pointer and keyboard entry points ────────────────────────────────────
  //
  // Each of these is a block that used to sit inline in the input hook's
  // handlers; the handler calls it at the same point.

  /**
   * A right-click: pick the cell under it (unless it is already in the picked
   * range) and hand the menu its target; anywhere else clears the target.
   */
  const pressTableMenu = useCallback(
    (world: Point) => {
      const pressed = hitTest(latest.current.scene, world)
      const pressedCell =
        pressed?.kind === 'table' ? cellAtPoint(pressed, world) : null
      if (!pressed?.table || !pressedCell) {
        setTableMenuTarget(null)
        return
      }
      setSelectedIds(new Set([pressed.id]))
      const existing = tableSelectionRef.current
      const inRange =
        existing?.tableId === pressed.id &&
        selectionCells(pressed.table, existing).some(
          (ref) =>
            ref.rowId === pressedCell.rowId && ref.colId === pressedCell.colId,
        )
      if (!inRange) {
        setTableSelection({
          tableId: pressed.id,
          kind: 'cells',
          anchor: pressedCell,
          focus: pressedCell,
        })
      }
      setTableMenuTarget({ tableId: pressed.id, ...pressedCell })
      return
    },
    [setSelectedIds, setTableSelection, latest],
  )

  /** A press on a resize handle of a table starts a scale gesture; false when `only` is no table. */
  const beginTableScale = useCallback(
    (only: CanvasElement, grabbed: ResizeHandle): boolean => {
      if (only.kind !== 'table' || !only.table) return false
      // A table scales its rows and columns together (`scaleTable`)
      // rather than stretching a frame the grid would no longer fill.
      setGesture({
        kind: 'table-scale',
        handle: grabbed,
        tableId: only.id,
        startBounds: {
          x: only.x,
          y: only.y,
          width: only.width,
          height: only.height,
        },
        before: { ...only },
        rowMinHeights: tableRowMinHeights(only),
        scale: { sx: 1, sy: 1, dx: 0, dy: 0 },
      })
      return true
    },
    [setGesture, tableRowMinHeights],
  )

  /**
   * A selected table's "+" buttons, append bars and inner borders, then its row
   * and column grabbers. Returns whether the press was theirs.
   */
  const pressTableChrome = useCallback(
    (world: Point, currentSelection: ReadonlySet<string>): boolean => {
      const only = latest.current.scene.byId.get([...currentSelection][0])
      const over = affordanceAtPoint(world)
      if (only?.kind === 'table' && only.table && over) {
        const grid = only.table
        const { affordance } = over
        switch (affordance.kind) {
          case 'insert-col':
            insertTableCol(only.id, affordance.afterColId)
            break
          case 'insert-row':
            insertTableRow(only.id, affordance.afterRowId)
            break
          case 'append-col':
            insertTableCol(only.id, grid.cols[grid.cols.length - 1].id)
            break
          case 'append-row':
            insertTableRow(only.id, grid.rows[grid.rows.length - 1].id)
            break
          case 'border-col':
            setGesture({
              kind: 'table-border',
              tableId: only.id,
              axis: 'col',
              id: affordance.colId,
              startWorld: world,
              startSize:
                grid.cols.find((col) => col.id === affordance.colId)?.width ??
                TABLE_CELL_WIDTH,
              minSize: TABLE_MIN_COL_WIDTH,
              before: { ...only },
            })
            break
          case 'border-row': {
            const index = grid.rows.findIndex(
              (row) => row.id === affordance.rowId,
            )
            setGesture({
              kind: 'table-border',
              tableId: only.id,
              axis: 'row',
              id: affordance.rowId,
              startWorld: world,
              startSize: grid.rows[index]?.height ?? TABLE_CELL_HEIGHT,
              minSize: tableRowMinHeights(only)[index] ?? TABLE_MIN_ROW_HEIGHT,
              before: { ...only },
            })
            break
          }
        }
        return true
      }
      if (only?.kind === 'table') {
        const grip = gripAtPoint(
          only,
          world,
          TABLE_GRIP_PX / latest.current.camera.zoom,
        )
        if (grip) {
          setTableSelection(
            grip.kind === 'row'
              ? { tableId: only.id, kind: 'row', rowId: grip.rowId }
              : { tableId: only.id, kind: 'col', colId: grip.colId },
          )
          return true
        }
      }
      return false
    },
    [
      affordanceAtPoint,
      insertTableCol,
      insertTableRow,
      setGesture,
      setTableSelection,
      tableRowMinHeights,
      latest,
    ],
  )

  /** A press on a cell of a table that is already the one selection. Returns whether the press ends there. */
  const pressTableCell = useCallback(
    (
      hit: CanvasElement,
      target: CanvasElement,
      currentSelection: ReadonlySet<string>,
      world: Point,
      shiftKey: boolean,
    ): boolean => {
      if (
        hit.kind === 'table' &&
        target.id === hit.id &&
        currentSelection.size === 1 &&
        currentSelection.has(hit.id)
      ) {
        const cell = cellAtPoint(hit, world)
        const existing = tableSelectionRef.current
        if (cell) {
          if (shiftKey) {
            const anchor =
              existing?.tableId === hit.id && existing.kind === 'cells'
                ? existing.anchor
                : cell
            setTableSelection({
              tableId: hit.id,
              kind: 'cells',
              anchor,
              focus: cell,
            })
            return true
          }
          setTableSelection({
            tableId: hit.id,
            kind: 'cells',
            anchor: cell,
            focus: cell,
          })
        }
      }
      return false
    },
    [setTableSelection],
  )

  /** The live preview of a table border drag. */
  const dragTableBorder = useCallback(
    (active: TableBorderGesture, world: Point) => {
      const delta =
        active.axis === 'col'
          ? world.x - active.startWorld.x
          : world.y - active.startWorld.y
      const size = Math.max(
        active.minSize,
        Math.round(active.startSize + delta),
      )
      setScene((prev) => {
        const grid = prev.byId.get(active.tableId)?.table
        if (!grid) return prev
        const table: CanvasTable =
          active.axis === 'col'
            ? {
                ...grid,
                cols: grid.cols.map((col) =>
                  col.id === active.id ? { ...col, width: size } : col,
                ),
              }
            : {
                ...grid,
                rows: grid.rows.map((row) =>
                  row.id === active.id ? { ...row, height: size } : row,
                ),
              }
        return updateElement(prev, active.tableId, {
          table,
          ...tableSize(table),
        })
      })
    },
    [setScene],
  )

  /** The live preview of a table scale drag. */
  const dragTableScale = useCallback(
    (active: TableScaleGesture, world: Point) => {
      const start = active.before.table
      if (!start) return
      const scale = tableScaleForDrag(
        active.handle,
        start,
        active.startBounds,
        world,
        active.rowMinHeights,
      )
      let scaled: CanvasTable
      try {
        scaled = applyTableOpLocally(start, {
          type: 'scaleTable',
          sx: scale.sx,
          sy: scale.sy,
        }).table
      } catch {
        return
      }
      setScene((prev) =>
        prev.byId.has(active.tableId)
          ? updateElement(prev, active.tableId, {
              table: scaled,
              ...tableSize(scaled),
              x: active.before.x + scale.dx,
              y: active.before.y + scale.dy,
            })
          : prev,
      )
      setGesture({ ...active, scale })
    },
    [setGesture, setScene],
  )

  /** A table border drag ends: restore the preview and send one resize op. */
  const finishTableBorder = useCallback(
    (finished: TableBorderGesture) => {
      const grid = latest.current.scene.byId.get(finished.tableId)?.table
      const before = finished.before.table
      if (!grid || !before) return
      const size =
        finished.axis === 'col'
          ? grid.cols.find((col) => col.id === finished.id)?.width
          : grid.rows.find((row) => row.id === finished.id)?.height
      if (size === undefined) return
      // The live preview is dropped first: the op is applied to the scene
      // by the consumer, so leaving the preview in would apply it twice.
      const restore = (): void =>
        writeScene((prev) =>
          prev.byId.has(finished.tableId)
            ? updateElement(prev, finished.tableId, {
                table: before,
                width: finished.before.width,
                height: finished.before.height,
              })
            : prev,
        )
      restore()
      if (Math.abs(size - finished.startSize) < 0.5) return
      callbacks?.onTableOp?.(
        finished.tableId,
        finished.axis === 'col'
          ? { type: 'resizeCol', colId: finished.id, width: size }
          : { type: 'resizeRow', rowId: finished.id, height: size },
        before,
      )
    },
    [callbacks, latest, writeScene],
  )

  /** A table scale drag ends: restore the preview and send one scale op. */
  const finishTableScale = useCallback(
    (finished: TableScaleGesture) => {
      const before = finished.before.table
      if (!before) return
      const { sx, sy, anchorX, anchorY } = finished.scale
      writeScene((prev) =>
        prev.byId.has(finished.tableId)
          ? updateElement(prev, finished.tableId, {
              table: before,
              width: finished.before.width,
              height: finished.before.height,
              x: finished.before.x,
              y: finished.before.y,
            })
          : prev,
      )
      if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return
      callbacks?.onTableOp?.(
        finished.tableId,
        {
          type: 'scaleTable',
          sx,
          sy,
          ...(anchorX ? { anchorX } : {}),
          ...(anchorY ? { anchorY } : {}),
        },
        before,
      )
    },
    [callbacks, writeScene],
  )

  /** A double-click on a table opens the cell under the pointer. */
  const editTableCellAt = useCallback(
    (
      hit: CanvasElement,
      world: Point,
      caretAtWorldPoint: (element: CanvasElement, world: Point) => number,
    ) => {
      const cell = cellAtPoint(hit, world)
      if (!cell) return
      const virtual = cellTextElement(hit, cell.rowId, cell.colId)
      beginCellEditing(
        hit.id,
        cell,
        virtual ? caretAtWorldPoint(virtual, world) : 'end',
      )
    },
    [beginCellEditing],
  )

  /**
   * A selected table cell, row or column owns the keys that would otherwise
   * switch tools. Returns whether the key was handled.
   */
  const onTableKeyDown = useCallback(
    (event: ReactKeyboardEvent): boolean => {
      const picked = tableSelectionRef.current
      const pickedTable = picked
        ? latest.current.scene.byId.get(picked.tableId)
        : undefined
      const grid = pickedTable?.table
      if (picked && grid) {
        const focus: CellRef =
          picked.kind === 'cells'
            ? picked.focus
            : picked.kind === 'row'
              ? { rowId: picked.rowId, colId: grid.cols[0].id }
              : { rowId: grid.rows[0].id, colId: picked.colId }
        const step = TABLE_ARROW_STEPS[event.key]
        if (step) {
          event.preventDefault()
          const next = stepCell(grid, focus, step[0], step[1])
          setTableSelection({
            tableId: picked.tableId,
            kind: 'cells',
            anchor:
              event.shiftKey && picked.kind === 'cells' ? picked.anchor : next,
            focus: next,
          })
          return true
        }
        if (event.key === 'Escape') {
          setTableSelection(null)
          return true
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          beginCellEditing(picked.tableId, focus, 'end')
          return true
        }
        if (event.key.length === 1) {
          event.preventDefault()
          beginCellEditing(picked.tableId, focus, 'end', event.key)
          return true
        }
      }
      return false
    },
    [beginCellEditing, setTableSelection, latest],
  )

  /** A table's create ack renamed it: carry the open cell and the picked cells to the new id. */
  const remapTableId = useCallback(
    (from: string, to: string) => {
      // A table whose create ack renames it while one of its cells is open:
      // the cell's virtual element carries the table id in its own.
      const open = editingRef.current
      if (open?.cell?.tableId === from) {
        const { rowId, colId } = open.cell
        const oldId = open.elementId
        const newId = cellElementId(to, rowId, colId)
        setScene((prev) => {
          const virtual = prev.byId.get(oldId)
          return virtual
            ? addElement(removeElements(prev, [oldId]), {
                ...virtual,
                id: newId,
              })
            : prev
        })
        setEditing((current) =>
          current?.cell?.tableId === from
            ? {
                ...current,
                elementId: newId,
                cell: { ...current.cell, tableId: to },
                before: current.before
                  ? { ...current.before, id: newId }
                  : null,
              }
            : current,
        )
        pendingTextEditsRef.current = pendingTextEditsRef.current.map((edit) =>
          edit.elementId === oldId ? { ...edit, elementId: newId } : edit,
        )
      }
      const picked = tableSelectionRef.current
      if (picked?.tableId === from)
        setTableSelection({ ...picked, tableId: to })
    },
    [pendingTextEditsRef, setEditing, setScene, setTableSelection, editingRef],
  )

  /** The cursor the table zones ask for, or null. */
  const tableCursorFor = useCallback(
    (current: Gesture): string | null =>
      current.kind === 'table-border'
        ? current.axis === 'col'
          ? 'col-resize'
          : 'row-resize'
        : tableAffordance?.affordance.kind === 'border-col'
          ? 'col-resize'
          : tableAffordance?.affordance.kind === 'border-row'
            ? 'row-resize'
            : tableAffordance
              ? 'pointer'
              : null,
    [tableAffordance],
  )

  return {
    tableSelection,
    tableSelectionRef,
    setTableSelection,
    tableAffordance,
    setTableAffordance,
    tableMenu,
    onTableMenuAction,
    issueTableOp,
    setRowHeight,
    beginCellEditing,
    finishCellEdit,
    moveCellEditing,
    affordanceAtPoint,
    deleteTableSelection,
    pressTableMenu,
    beginTableScale,
    pressTableChrome,
    pressTableCell,
    dragTableBorder,
    dragTableScale,
    finishTableBorder,
    finishTableScale,
    editTableCellAt,
    onTableKeyDown,
    remapTableId,
    tableCursorFor,
  }
}

// src/lib/react-flow/canvas-mode.ts
// CanvasModeContext — mirrors ForceFullDetailContext (level-of-detail.ts):
// a plain boolean context, not node data, so TableNode's custom memo
// comparator (see TableNode.tsx's second `memo` argument) does not need a
// new field to key on. Provided from ReactFlowCanvas.tsx using the
// already-computed `canvasMode` flag (unconditional on the main board, via
// `enableEdgeAblation` — see canvas-unconditional-default).
//
// While true, TableNode renders its chrome-light form (sized wrapper +
// per-column ColumnHandles only, no header text/buttons/ColumnRow bodies —
// see the "DOM strip to handles-only anchors" spec-delta requirement) and
// CanvasNodeLayer paints the table's visuals on <canvas> instead.
import { createContext, useContext } from 'react'

export const CanvasModeContext = createContext(false)

export function useCanvasMode(): boolean {
  return useContext(CanvasModeContext)
}

// CanvasEditContext (tactical plan Phase 3, "In-place DOM edit overlay") —
// sits beside CanvasModeContext on the same provider subtree. While canvas
// mode strips every table down to its chrome-light, handles-only DOM (see
// CanvasModeContext above), a user with edit permission can double-click a
// table to mount the real, full-DOM TableNode for exactly that ONE table in
// place — reusing every existing editor (inline name, data-type selector,
// reorder, notes) verbatim — while CanvasNodeLayer skips drawing it so the
// canvas and the DOM overlay never double-paint the same table.
//
// `editingTableId` is the single table (if any) currently overlaid.
// `initialEditingField` carries which column/field to open the moment that
// overlay mounts (double-click-a-column opens that column's editor
// directly); the target TableNode instance consumes it once (see its local
// ref guard) — the context itself is not responsible for clearing it, so
// its shape stays exactly `{editingTableId, initialEditingField, requestEdit,
// exitEdit}` per the tactical plan.
export interface InitialEditingField {
  tableId: string
  columnId?: string
  field?: 'name' | 'dataType'
}

/**
 * A request to OPEN an affordance on a canvas table WITHOUT entering the edit
 * overlay — fired when the user clicks one of the canvas-drawn header icons
 * (note / comment / relations) OR a canvas-drawn field-note glyph on a
 * column row (`fieldnote`, tactical plan: canvas-field-note-popover). The
 * target `TableNode` consumes it (via a per-instance ref guard, like
 * `initialEditingField`) to open the matching in-place popover / relations
 * panel. A fresh object is minted on every call so clicking the same icon
 * twice re-fires. `columnId` is only set for `fieldnote` — it identifies
 * which column's note popover to open, anchored beside that column's row.
 */
export interface AffordanceRequest {
  tableId: string
  kind: 'note' | 'comment' | 'relations' | 'fieldnote'
  columnId?: string
}

export interface CanvasEditContextValue {
  editingTableId: string | null
  initialEditingField: InitialEditingField | null
  /** Latest header-icon affordance request (see `AffordanceRequest`). */
  affordanceRequest: AffordanceRequest | null
  /**
   * Request the overlay for `tableId`. Omit `columnId`/`field` for a plain
   * header/body double-click (mounts the overlay, opens no field). Replaces
   * whatever table was previously overlaid (at most one overlay at a time).
   */
  requestEdit: (
    tableId: string,
    columnId?: string,
    field?: 'name' | 'dataType',
  ) => void
  /**
   * Open a canvas header icon's popover/panel in place (no edit overlay).
   * Pass `columnId` when `kind === 'fieldnote'` so the target TableNode
   * knows which column's note to open.
   */
  requestAffordance: (
    tableId: string,
    kind: AffordanceRequest['kind'],
    columnId?: string,
  ) => void
  /** Close the overlay entirely (pane click, Escape). */
  exitEdit: () => void
  /**
   * LizMeter #53 fix — retargeting-immune double-press entry point for edit
   * mode. Double-clicking table A then table B while A is still overlaid can
   * have a React re-render between B's first-click mousedown and its own
   * click event unmount the `.column-row`/wrapper the mousedown landed on;
   * the browser then retargets the resulting click/dblclick to
   * `div.react-flow__nodes`, so `onDoubleClick` never fires on B. Tracking
   * two mousedowns manually is immune to that retargeting because the
   * evidence shows `mousedown` always reaches the correct target — only
   * `click`/`dblclick` get retargeted. Call once per `mousedown` on a
   * double-click-to-edit surface (chrome-light wrapper / LodColumnRow);
   * fires `requestEdit` itself once two presses on the same
   * `tableId`/`columnId` land within `DOUBLE_PRESS_WINDOW_MS`.
   */
  registerEditPress: (
    tableId: string,
    columnId?: string,
    field?: 'name' | 'dataType',
  ) => void
  /**
   * Cancel any in-flight double-press tracking (LizMeter #53 drag guard).
   * Called wherever a real node drag or column-reorder drag actually
   * starts, so a mousedown that begins a drag can never later combine with
   * an unrelated double-click elsewhere within the press window.
   */
  cancelEditPress: () => void
}

const noop = () => {}

// Default (no provider) is a safe no-op — mirrors CanvasModeContext's
// fail-closed default so any subtree rendered outside ReactFlowCanvas (e.g.
// tests) never crashes calling these.
export const CanvasEditContext = createContext<CanvasEditContextValue>({
  editingTableId: null,
  initialEditingField: null,
  affordanceRequest: null,
  requestEdit: noop,
  requestAffordance: noop,
  exitEdit: noop,
  registerEditPress: noop,
  cancelEditPress: noop,
})

export function useCanvasEdit(): CanvasEditContextValue {
  return useContext(CanvasEditContext)
}

/**
 * Double-click timing window for `registerEditPress` (LizMeter #53). OS
 * defaults for a real double-click commonly sit 300-500ms; 400ms is the
 * midpoint. Too short and a slightly slow deliberate double-click across two
 * different targets falls back to the kept native `onDoubleClick` (no
 * functional loss, just no retargeting-immunity for that click); too long
 * and two separate single-clicks on the same target could theoretically
 * combine — mitigated by requiring the same `tableId`/`columnId` key.
 */
export const DOUBLE_PRESS_WINDOW_MS = 400

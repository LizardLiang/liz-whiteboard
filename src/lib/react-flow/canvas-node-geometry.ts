// src/lib/react-flow/canvas-node-geometry.ts
// Shared table-node geometry constants + showMode column filtering, used by
// BOTH the canvas draw (CanvasNodeLayer.tsx) and the chrome-light DOM handle
// layout (TableNode.tsx's canvas-mode path). Extracted from CanvasNodeLayer
// (tactical plan, Phase 1) so the two render paths can never drift apart —
// before this, HEADER_H/ROW_H lived only in CanvasNodeLayer as a comment
// promise ("mirrors TableNode's DOM") with no code forcing that to stay
// true. Any table whose canvas draw and DOM handle rows disagree breaks
// edge anchoring (column handles land at the wrong y) — see the "Column
// handle preservation for edges" spec-delta requirement.
import type { Column } from '@/data/models'
import type { ShowMode } from './types'

/** Table header block height (px, at zoom=1) — canvas draw + DOM wrapper. */
export const HEADER_H = 34

/** Per-column row height (px, at zoom=1) — === TableNode's COLUMN_ROW_HEIGHT. */
export const ROW_H = 28

/** Fallback table width when no measured/cached width is available yet. */
export const DEFAULT_W = 220

/** Horizontal text padding inside a table's canvas-drawn box. */
export const PAD_X = 12

/**
 * Which columns get their OWN row (canvas-drawn row + DOM handle row) for a
 * given showMode. Single source of truth for both CanvasNodeLayer's draw
 * loop and TableNode's chrome-light handle layout, so "columns drawn on
 * canvas" and "columns with a positioned handle row" can never disagree
 * (spec-delta: "Show-mode parity in canvas render").
 *
 * - ALL_FIELDS: every column gets a row.
 * - KEY_ONLY: only PK/FK columns get a row.
 * - TABLE_NAME: no column gets its own row — the table collapses to just
 *   the header block. (Column handles still need to exist for edges under
 *   canvas mode — TableNode's chrome-light path mounts them separately,
 *   collapsed into the header row; see that file's TABLE_NAME branch.)
 */
export function getVisibleColumnsForShowMode(
  columns: Array<Column>,
  showMode: ShowMode,
): Array<Column> {
  if (showMode === 'TABLE_NAME') return []
  if (showMode === 'KEY_ONLY') {
    return columns.filter((c) => c.isPrimaryKey || c.isForeignKey)
  }
  return columns
}

/** Total table box height for a given row-column count (header + N rows). */
export function computeTableHeight(rowColumnCount: number): number {
  return HEADER_H + rowColumnCount * ROW_H
}

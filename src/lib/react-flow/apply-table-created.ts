// src/lib/react-flow/apply-table-created.ts
// Pure reducer for applying a peer's table:created broadcast (GH #125) to the
// ReactFlowWhiteboard canvas's source-of-truth query cache
// (['whiteboard', whiteboardId] — FLAT shape, see patchWhiteboardTablePositions
// in ReactFlowWhiteboard.tsx: `getWhiteboardWithDiagram` returns
// `{ ...whiteboard, tables, viewerRole }`, there is no nested `.whiteboard`
// wrapper). Extracted as a standalone pure function (mirrors applyBulkPositions
// in src/lib/auto-layout/index.ts) so the insert / idempotency logic is unit
// testable without mounting the whole ReactFlowWhiteboard component tree.
//
// Once patched into the cache, the existing `nodes` useMemo + initialNodes
// sync effect (ReactFlowWhiteboard.tsx) construct a fully-wired React Flow
// node for any table id they don't already recognize — no manual node
// construction needed here.
import type { Column, DiagramTable } from '@/data/models'

export interface WhiteboardWithTables {
  tables: Array<DiagramTable & { columns: Array<Column> }>
}

/**
 * Applies a freshly-created table (from a peer's table:created broadcast) to
 * the cached whiteboard payload.
 * - Returns `old` unchanged if the cache hasn't loaded yet (`old` or
 *   `old.tables` missing), or if the table id already exists — an idempotency
 *   guard against a duplicate/replayed event double-inserting.
 * - Defaults `columns: []` — a brand-new table always has zero columns.
 */
export function applyTableCreated<T extends WhiteboardWithTables>(
  old: T | undefined,
  table: DiagramTable & { columns?: Array<Column> },
): T | undefined {
  if (!old?.tables) return old
  if (old.tables.some((t) => t.id === table.id)) return old
  return {
    ...old,
    tables: [...old.tables, { ...table, columns: table.columns ?? [] }],
  }
}

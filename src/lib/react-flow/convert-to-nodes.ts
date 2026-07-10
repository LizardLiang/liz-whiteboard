/**
 * React Flow Node Conversion Utilities
 *
 * Convert Prisma DiagramTable entities to React Flow nodes
 */

import type { Column, DiagramTable } from '@/data/models'
import type { ShowMode, TableNodeData, TableNodeType } from './types'

/**
 * Extract table position from DiagramTable entity.
 * When positionX or positionY is null (table has no assigned position yet),
 * returns {x: -99999, y: -99999} so the node is placed far off-canvas.
 * React Flow still renders and measures the node via ResizeObserver at this
 * position, allowing client-side position resolution to compute a
 * non-overlapping placement once dimensions are known.
 */
export function extractTablePosition(table: DiagramTable): {
  x: number
  y: number
} {
  if (table.positionX === null || table.positionY === null) {
    return { x: -99999, y: -99999 }
  }
  return {
    x: table.positionX,
    y: table.positionY,
  }
}

/**
 * Convert a single DiagramTable to React Flow Node
 * @param table - DiagramTable with columns
 * @param options - Optional node data overrides
 * @returns React Flow TableNodeType
 */
export function convertTableToNode(
  table: DiagramTable & { columns: Array<Column> },
  options?: Partial<TableNodeData>,
): TableNodeType {
  const position = extractTablePosition(table)

  return {
    id: table.id,
    type: 'table',
    position,
    data: {
      table,
      isActiveHighlighted: false,
      isHighlighted: false,
      isRelationsPreviewOpen: false,
      showMode: 'ALL_FIELDS',
      positionPending: table.positionX === null || table.positionY === null,
      ...options,
    },
    // Do NOT set width here — React Flow pins it as an inline style on the outer
    // wrapper div (overriding the inner node's computed width). Let React Flow
    // measure the rendered DOM via ResizeObserver instead. The autoWidth useMemo
    // in TableNode already uses table.width as a floor so saved widths are respected.
    height: table.height ?? undefined,
    // Table nodes are never natively deletable (GH #106 Bug 1) — Delete/
    // Backspace always routes through the confirmation dialog, never React
    // Flow's own removal (see ReactFlowCanvas.tsx). Set at the source (not
    // just defensively re-applied in ReactFlowCanvas's mergedNodes map) so
    // that map's cheap `n.deletable === false` check is actually true from
    // the start — otherwise every table node gets wrapped in a brand-new
    // object on every mergedNodes recompute, an unstable-reference cost that
    // defeats TableNode's memoization (GH #121 perf, stable-reference audit).
    deletable: false,
  }
}

/**
 * Convert multiple DiagramTables to React Flow Nodes
 * @param tables - Array of DiagramTable entities with columns
 * @param showMode - Display mode for all nodes (optional)
 * @returns Array of React Flow TableNodeType
 */
export function convertTablesToNodes(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  showMode?: ShowMode,
): Array<TableNodeType> {
  return tables.map((table) =>
    convertTableToNode(table, {
      ...(showMode ? { showMode } : {}),
    }),
  )
}

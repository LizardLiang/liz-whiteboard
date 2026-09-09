/**
 * React Flow Node Conversion Utilities
 *
 * Convert Prisma DiagramTable entities to React Flow nodes
 */

import { Z_INDEX } from './types'
import type { Column, DiagramTable } from '@/data/models'
import type {
  ExternalTableNodeType,
  ShowMode,
  TableNodeData,
  TableNodeType,
} from './types'
import type { ResolvedTableReference } from '@/data/table-reference'

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

/**
 * Convert resolved cross-file references into React Flow nodes (LizMeter #83).
 *
 * A reference is a DiagramTable row, so its position comes from the same
 * columns a table's does — including the off-canvas sentinel used while a row
 * has no position yet.
 *
 * The callbacks are injected here rather than read from a context because
 * ExternalTableNode is rendered through `nodeTypes` and never receives props
 * directly. Omitting `onJumpToSource` is meaningful: it disables jump-to-source
 * on the public share-link path, where the viewer holds no role on the source
 * board.
 */
export function convertReferencesToNodes(
  references: Array<ResolvedTableReference>,
  handlers: {
    onJumpToSource?: (sourceWhiteboardId: string, sourceTableId: string) => void
    onRetarget?: (tableId: string) => void
  } = {},
): Array<ExternalTableNodeType> {
  return references.map((reference) => ({
    id: reference.table.id,
    type: 'externalTable' as const,
    position: extractTablePosition(reference.table),
    data: {
      tableId: reference.table.id,
      sourceWhiteboardId: reference.table.sourceWhiteboardId ?? '',
      sourceTableId: reference.table.sourceTableId ?? '',
      sourceTableName: reference.sourceTableName,
      sourceWhiteboardName: reference.sourceWhiteboardName,
      columns: reference.columns.map((column) => ({
        id: column.id,
        name: column.name,
        dataType: column.dataType,
        isPrimaryKey: column.isPrimaryKey,
        isForeignKey: column.isForeignKey,
        missing: column.missing,
      })),
      missing: reference.missing,
      isActiveHighlighted: false,
      isHighlighted: false,
      showMode: 'ALL_FIELDS' as const,
      onJumpToSource: handlers.onJumpToSource,
      onRetarget: handlers.onRetarget,
    },
    // Same z tier as an ordinary table. Without it React Flow treats the
    // missing value as 0 and every table (which carries NODE_DEFAULT = 1
    // through calculateHighlighting) paints over the reference — a node you
    // can see through but cannot click, drag or connect.
    zIndex: Z_INDEX.NODE_DEFAULT,
    // Never natively deletable — Delete/Backspace routes through the
    // confirmation dialog, exactly as it does for table nodes.
    deletable: false,
  }))
}

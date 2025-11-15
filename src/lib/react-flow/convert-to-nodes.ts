/**
 * React Flow Node Conversion Utilities
 *
 * Convert Prisma DiagramTable entities to React Flow nodes
 */

import type { DiagramTable, Column } from '@prisma/client'
import type { TableNodeType, TableNodeData, ShowMode } from './types'

/**
 * Extract table position from DiagramTable entity
 * @param table - DiagramTable with positionX and positionY
 * @returns Position object compatible with React Flow
 */
export function extractTablePosition(table: DiagramTable): { x: number; y: number } {
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
  table: DiagramTable & { columns: Column[] },
  options?: Partial<TableNodeData>
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
      isHovered: false,
      showMode: 'ALL_FIELDS',
      ...options,
    },
    // Hints for React Flow (actual dimensions will be measured)
    width: table.width ?? undefined,
    height: table.height ?? undefined,
  }
}

/**
 * Convert multiple DiagramTables to React Flow Nodes
 * @param tables - Array of DiagramTable entities with columns
 * @param showMode - Display mode for all nodes (optional)
 * @returns Array of React Flow TableNodeType
 */
export function convertTablesToNodes(
  tables: (DiagramTable & { columns: Column[] })[],
  showMode?: ShowMode
): TableNodeType[] {
  return tables.map((table) =>
    convertTableToNode(table, showMode ? { showMode } : undefined)
  )
}

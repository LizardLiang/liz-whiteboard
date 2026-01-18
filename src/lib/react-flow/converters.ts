/**
 * React Flow Conversion Utilities
 *
 * This file contains all conversion functions for transforming between
 * Prisma entities and React Flow nodes/edges
 */

import type {
  Cardinality,
  Column,
  DiagramTable,
  Relationship,
} from '@prisma/client'
import type {
  CanvasViewport,
  CardinalityType,
  ReactFlowViewport,
  RelationshipEdge,
  RelationshipEdgeData,
  RelationshipEdgeType,
  ShowMode,
  TableNode,
  TableNodeData,
  TableNodeType,
} from './types'

// ============================================================================
// Node Conversion (from convert-to-nodes.ts)
// ============================================================================

/**
 * Extract table position from DiagramTable entity
 * @param table - DiagramTable with positionX and positionY
 * @returns Position object compatible with React Flow
 */
export function extractTablePosition(table: DiagramTable): {
  x: number
  y: number
} {
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
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  showMode?: ShowMode,
): Array<TableNodeType> {
  return tables.map((table) =>
    convertTableToNode(table, showMode ? { showMode } : undefined),
  )
}

/**
 * Convert Prisma DiagramTable entities to React Flow nodes (legacy format)
 */
export function convertToReactFlowNodes(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
): Array<TableNode> {
  return tables.map((table) => ({
    id: table.id,
    type: 'erTable' as const,
    position: {
      x: table.positionX,
      y: table.positionY,
    },
    data: {
      table,
      columns: table.columns.sort((a, b) => a.orderIndex - b.orderIndex),
    },
  }))
}

/**
 * Extract position updates from a React Flow node for database persistence
 */
export function extractPositionUpdates(
  node: TableNode,
): Pick<DiagramTable, 'positionX' | 'positionY'> {
  return {
    positionX: node.position.x,
    positionY: node.position.y,
  }
}

// ============================================================================
// Edge Conversion (from convert-to-edges.ts)
// ============================================================================

/**
 * Create unique handle ID for column connection point
 * Format: `${tableId}__${columnId}`
 *
 * @param tableId - Table ID
 * @param columnId - Column ID
 * @returns Handle ID string
 */
export function createHandleId(tableId: string, columnId: string): string {
  return `${tableId}__${columnId}`
}

/**
 * Parse handle ID back to table and column IDs
 *
 * @param handleId - Handle ID in format `${tableId}__${columnId}`
 * @returns Object with tableId and columnId
 */
export function parseHandleId(handleId: string): {
  tableId: string
  columnId: string
} {
  const [tableId, columnId] = handleId.split('__')
  return { tableId, columnId }
}

/**
 * Get SVG marker ID for relationship source (based on cardinality)
 *
 * @param cardinality - Relationship cardinality
 * @returns SVG marker reference string
 */
export function getCardinalityMarkerStart(cardinality: Cardinality): string {
  switch (cardinality) {
    case 'ONE_TO_ONE':
      return 'url(#zeroOrOneLeft)'
    case 'ONE_TO_MANY':
      return 'url(#zeroOrOneLeft)'
    case 'MANY_TO_ONE':
      return 'url(#zeroOrManyLeft)'
    case 'MANY_TO_MANY':
      return 'url(#zeroOrManyLeft)'
  }
}

/**
 * Get SVG marker ID for relationship target (based on cardinality)
 *
 * @param cardinality - Relationship cardinality
 * @returns SVG marker reference string
 */
export function getCardinalityMarkerEnd(cardinality: Cardinality): string {
  switch (cardinality) {
    case 'ONE_TO_ONE':
      return 'url(#zeroOrOneRight)'
    case 'ONE_TO_MANY':
      return 'url(#zeroOrManyRight)'
    case 'MANY_TO_ONE':
      return 'url(#zeroOrOneRight)'
    case 'MANY_TO_MANY':
      return 'url(#zeroOrManyRight)'
  }
}

/**
 * Convert a single Relationship to React Flow Edge
 *
 * @param relationship - Relationship entity with source and target columns
 * @returns React Flow RelationshipEdgeType
 */
export function convertRelationshipToEdge(
  relationship: Relationship & {
    sourceColumn: Column
    targetColumn: Column
  },
): RelationshipEdgeType {
  return {
    id: relationship.id,
    type: 'relationship',
    source: relationship.sourceTableId,
    target: relationship.targetTableId,
    sourceHandle: createHandleId(
      relationship.sourceTableId,
      relationship.sourceColumnId,
    ),
    targetHandle: createHandleId(
      relationship.targetTableId,
      relationship.targetColumnId,
    ),
    data: {
      relationship,
      cardinality: relationship.cardinality,
      isHighlighted: false,
      label: relationship.label ?? undefined,
    },
    // SVG markers for cardinality indicators
    markerStart: getCardinalityMarkerStart(relationship.cardinality),
    markerEnd: getCardinalityMarkerEnd(relationship.cardinality),
  }
}

/**
 * Convert multiple Relationships to React Flow Edges
 *
 * @param relationships - Array of Relationship entities with source and target columns
 * @returns Array of React Flow RelationshipEdgeType
 */
export function convertRelationshipsToEdges(
  relationships: Array<Relationship & {
    sourceColumn: Column
    targetColumn: Column
  }>,
): Array<RelationshipEdgeType> {
  return relationships.map((rel) => convertRelationshipToEdge(rel))
}

/**
 * Convert Prisma Relationship entities to React Flow edges (legacy format)
 */
export function convertToReactFlowEdges(
  relationships: Array<Relationship>,
): Array<RelationshipEdge> {
  return relationships.map((rel) => ({
    id: rel.id,
    type: 'erRelationship' as const,
    source: rel.sourceTableId,
    target: rel.targetTableId,
    sourceHandle: rel.sourceColumnId
      ? `${rel.sourceColumnId}-source`
      : undefined,
    targetHandle: rel.targetColumnId
      ? `${rel.targetColumnId}-target`
      : undefined,
    data: {
      relationship: rel,
      cardinality: rel.relationshipType as CardinalityType,
      label: rel.label || undefined,
    },
  }))
}

// ============================================================================
// Viewport Conversion
// ============================================================================

/**
 * Convert legacy CanvasViewport to React Flow viewport format
 */
export function convertToReactFlowViewport(
  cv: CanvasViewport,
): ReactFlowViewport {
  return {
    x: cv.offsetX,
    y: cv.offsetY,
    zoom: cv.zoom,
  }
}

/**
 * Convert React Flow viewport to legacy CanvasViewport format
 */
export function convertToCanvasViewport(
  rfv: ReactFlowViewport,
): CanvasViewport {
  return {
    zoom: rfv.zoom,
    offsetX: rfv.x,
    offsetY: rfv.y,
  }
}

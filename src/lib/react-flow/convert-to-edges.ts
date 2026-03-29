/**
 * React Flow Edge Conversion Utilities
 *
 * Convert Prisma Relationship entities to React Flow edges
 */

import type { Relationship, Column, Cardinality } from '@prisma/client'
import type { RelationshipEdgeType, RelationshipEdgeData } from './types'

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
      return 'url(#cardinality-one-left)'
    case 'ONE_TO_MANY':
      return 'url(#cardinality-one-left)'
    case 'MANY_TO_ONE':
      return 'url(#cardinality-many-left)'
    case 'MANY_TO_MANY':
      return 'url(#cardinality-many-left)'
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
      return 'url(#cardinality-one-right)'
    case 'ONE_TO_MANY':
      return 'url(#cardinality-many-right)'
    case 'MANY_TO_ONE':
      return 'url(#cardinality-one-right)'
    case 'MANY_TO_MANY':
      return 'url(#cardinality-many-right)'
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
  }
): RelationshipEdgeType {
  return {
    id: relationship.id,
    type: 'relationship',
    source: relationship.sourceTableId,
    target: relationship.targetTableId,
    sourceHandle: createHandleId(relationship.sourceTableId, relationship.sourceColumnId),
    targetHandle: createHandleId(relationship.targetTableId, relationship.targetColumnId),
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
  relationships: (Relationship & {
    sourceColumn: Column
    targetColumn: Column
  })[]
): RelationshipEdgeType[] {
  return relationships.map((rel) => convertRelationshipToEdge(rel))
}

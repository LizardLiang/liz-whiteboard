/**
 * React Flow Edge Conversion Utilities
 *
 * Convert Prisma Relationship entities to React Flow edges
 */

import { createColumnHandleId } from './edge-routing'
import type { Cardinality, Column, Relationship } from '@prisma/client'
import type { RelationshipEdgeData, RelationshipEdgeType } from './types'

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
    case 'ZERO_TO_ONE':
      return 'url(#cardinality-zero-one-left)'
    case 'ZERO_TO_MANY':
      return 'url(#cardinality-zero-many-left)'
    case 'SELF_REFERENCING':
      return 'url(#cardinality-one-left)'
    // New types — source is many (|⋈)
    case 'MANY_TO_ZERO_OR_ONE':
      return 'url(#cardinality-many-left)'
    case 'MANY_TO_ZERO_OR_MANY':
      return 'url(#cardinality-many-left)'
    case 'ZERO_OR_MANY_TO_ONE':
      return 'url(#cardinality-zero-many-left)'
    case 'ZERO_OR_MANY_TO_MANY':
      return 'url(#cardinality-zero-many-left)'
    case 'ZERO_OR_MANY_TO_ZERO_OR_ONE':
      return 'url(#cardinality-zero-many-left)'
    case 'ZERO_OR_MANY_TO_ZERO_OR_MANY':
      return 'url(#cardinality-zero-many-left)'
    // New types — source is one, optional (○|)
    case 'ZERO_OR_ONE_TO_ONE':
      return 'url(#cardinality-zero-one-left)'
    case 'ZERO_OR_ONE_TO_MANY':
      return 'url(#cardinality-zero-one-left)'
    case 'ZERO_OR_ONE_TO_ZERO_OR_ONE':
      return 'url(#cardinality-zero-one-left)'
    case 'ZERO_OR_ONE_TO_ZERO_OR_MANY':
      return 'url(#cardinality-zero-one-left)'
    default:
      return 'url(#cardinality-one-left)'
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
    case 'ZERO_TO_ONE':
      return 'url(#cardinality-one-right)'
    case 'ZERO_TO_MANY':
      return 'url(#cardinality-many-right)'
    case 'SELF_REFERENCING':
      return 'url(#cardinality-many-right)'
    // New types — target is zero-or-one (○|)
    case 'MANY_TO_ZERO_OR_ONE':
      return 'url(#cardinality-zero-one-right)'
    case 'ZERO_OR_ONE_TO_ZERO_OR_ONE':
      return 'url(#cardinality-zero-one-right)'
    case 'ZERO_OR_MANY_TO_ZERO_OR_ONE':
      return 'url(#cardinality-zero-one-right)'
    // New types — target is zero-or-many (○⋈)
    case 'MANY_TO_ZERO_OR_MANY':
      return 'url(#cardinality-zero-many-right)'
    case 'ZERO_OR_ONE_TO_ZERO_OR_MANY':
      return 'url(#cardinality-zero-many-right)'
    case 'ZERO_OR_MANY_TO_ZERO_OR_MANY':
      return 'url(#cardinality-zero-many-right)'
    // New types — target is exactly one (||)
    case 'ZERO_OR_ONE_TO_ONE':
      return 'url(#cardinality-one-right)'
    case 'ZERO_OR_MANY_TO_ONE':
      return 'url(#cardinality-one-right)'
    // New types — target is one-or-many (|⋈)
    case 'ZERO_OR_ONE_TO_MANY':
      return 'url(#cardinality-many-right)'
    case 'ZERO_OR_MANY_TO_MANY':
      return 'url(#cardinality-many-right)'
    default:
      return 'url(#cardinality-one-right)'
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
    // Default to right→left; ReactFlowCanvas will recalculate based on actual positions
    sourceHandle: createColumnHandleId(
      relationship.sourceTableId,
      relationship.sourceColumnId,
      'right',
      'source',
    ),
    targetHandle: createColumnHandleId(
      relationship.targetTableId,
      relationship.targetColumnId,
      'left',
      'target',
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
  relationships: Array<
    Relationship & {
      sourceColumn: Column
      targetColumn: Column
    }
  >,
): Array<RelationshipEdgeType> {
  return relationships.map((rel) => convertRelationshipToEdge(rel))
}

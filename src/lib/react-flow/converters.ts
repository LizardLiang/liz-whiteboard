// NOTE: as of this pass, nothing in the app imports this module — it predates
// convert-to-nodes.ts / convert-to-edges.ts / layout-adapter.ts, which are the
// converters ReactFlowWhiteboard actually uses. Left in place (not deleted)
// since removing unreferenced files was outside this pass's approved scope;
// flagged as cleanup debt in implementation-notes.md. Types below are aligned
// to the current `./types`/models/schema shapes so it still compiles.
import type { Column, DiagramTable, Relationship } from '@/data/models'
import type { CanvasState } from '@/data/schema'
import type {
  ReactFlowViewport,
  RelationshipEdgeType,
  TableNodeType,
} from './types'

// ============================================================================
// Node Conversion
// ============================================================================

/**
 * Convert Prisma DiagramTable entities to React Flow nodes
 */
export function convertToReactFlowNodes(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
): Array<TableNodeType> {
  return tables.map((table) => ({
    id: table.id,
    type: 'table' as const,
    position: {
      x: table.positionX ?? 0,
      y: table.positionY ?? 0,
    },
    data: {
      table: {
        ...table,
        columns: [...table.columns].sort((a, b) => a.order - b.order),
      },
      isActiveHighlighted: false,
      isHighlighted: false,
      isRelationsPreviewOpen: false,
      showMode: 'ALL_FIELDS',
    },
  }))
}

/**
 * Extract position updates from a React Flow node for database persistence
 */
export function extractPositionUpdates(
  node: TableNodeType,
): Pick<DiagramTable, 'positionX' | 'positionY'> {
  return {
    positionX: node.position.x,
    positionY: node.position.y,
  }
}

// ============================================================================
// Edge Conversion
// ============================================================================

/**
 * Convert Prisma Relationship entities to React Flow edges
 */
export function convertToReactFlowEdges(
  relationships: Array<
    Relationship & { sourceColumn: Column; targetColumn: Column }
  >,
): Array<RelationshipEdgeType> {
  return relationships.map((rel) => ({
    id: rel.id,
    type: 'relationship' as const,
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
      cardinality: rel.cardinality,
      isHighlighted: false,
      label: rel.label || undefined,
    },
  }))
}

// ============================================================================
// Viewport Conversion
// ============================================================================

/**
 * Convert legacy CanvasState to React Flow viewport format
 */
export function convertToReactFlowViewport(
  cv: CanvasState,
): ReactFlowViewport {
  return {
    x: cv.offsetX,
    y: cv.offsetY,
    zoom: cv.zoom,
  }
}

/**
 * Convert React Flow viewport to legacy CanvasState format
 */
export function convertToCanvasViewport(rfv: ReactFlowViewport): CanvasState {
  return {
    zoom: rfv.zoom,
    offsetX: rfv.x,
    offsetY: rfv.y,
  }
}

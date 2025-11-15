import type { DiagramTable, Column, Relationship } from '@prisma/client';
import type {
  TableNode,
  RelationshipEdge,
  CardinalityType,
  ReactFlowViewport,
  CanvasViewport,
} from './types';

// ============================================================================
// Node Conversion
// ============================================================================

/**
 * Convert Prisma DiagramTable entities to React Flow nodes
 */
export function convertToReactFlowNodes(
  tables: (DiagramTable & { columns: Column[] })[]
): TableNode[] {
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
  }));
}

/**
 * Extract position updates from a React Flow node for database persistence
 */
export function extractPositionUpdates(
  node: TableNode
): Pick<DiagramTable, 'positionX' | 'positionY'> {
  return {
    positionX: node.position.x,
    positionY: node.position.y,
  };
}

// ============================================================================
// Edge Conversion
// ============================================================================

/**
 * Convert Prisma Relationship entities to React Flow edges
 */
export function convertToReactFlowEdges(
  relationships: Relationship[]
): RelationshipEdge[] {
  return relationships.map((rel) => ({
    id: rel.id,
    type: 'erRelationship' as const,
    source: rel.sourceTableId,
    target: rel.targetTableId,
    sourceHandle: rel.sourceColumnId ? `${rel.sourceColumnId}-source` : undefined,
    targetHandle: rel.targetColumnId ? `${rel.targetColumnId}-target` : undefined,
    data: {
      relationship: rel,
      cardinality: rel.relationshipType as CardinalityType,
      label: rel.label || undefined,
    },
  }));
}

// ============================================================================
// Viewport Conversion
// ============================================================================

/**
 * Convert legacy CanvasViewport to React Flow viewport format
 */
export function convertToReactFlowViewport(cv: CanvasViewport): ReactFlowViewport {
  return {
    x: cv.offsetX,
    y: cv.offsetY,
    zoom: cv.zoom,
  };
}

/**
 * Convert React Flow viewport to legacy CanvasViewport format
 */
export function convertToCanvasViewport(rfv: ReactFlowViewport): CanvasViewport {
  return {
    zoom: rfv.zoom,
    offsetX: rfv.x,
    offsetY: rfv.y,
  };
}

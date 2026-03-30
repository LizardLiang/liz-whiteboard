/**
 * Edge Routing Utilities
 *
 * Calculates the optimal source/target handle side for relationship edges
 * based on the relative positions of connected table nodes. Edges connect
 * to column-level handles (preserving field-to-field connections) while
 * dynamically choosing left or right side based on relative node position.
 */

import type { Node } from '@xyflow/react'
import type { RelationshipEdgeType, TableNodeData } from './types'

// Default node dimensions used when measured dimensions are unavailable
const DEFAULT_NODE_WIDTH = 250
const DEFAULT_NODE_HEIGHT = 150

export type HandleSide = 'left' | 'right'

/**
 * Build column-level handle ID with side and type information.
 * Format: `{tableId}__{columnId}__{side}__{type}`
 *
 * React Flow requires unique handle IDs within a node. Source and target
 * handles on the same side must have distinct IDs so edge routing resolves
 * to the correct handle.
 */
export function createColumnHandleId(
  tableId: string,
  columnId: string,
  side: HandleSide,
  type: 'source' | 'target' = 'source',
): string {
  return `${tableId}__${columnId}__${side}__${type}`
}

/**
 * Get the center coordinates of a node.
 */
function getNodeCenter(node: Node): { cx: number; cy: number } {
  const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH
  const height = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT
  return {
    cx: node.position.x + width / 2,
    cy: node.position.y + height / 2,
  }
}

/**
 * Determine which side each table should use for the edge connection,
 * based on relative horizontal position of the two nodes.
 *
 * - Source is LEFT of target  → source RIGHT, target LEFT
 * - Source is RIGHT of target → source LEFT, target RIGHT
 */
export function calculateBestSides(
  sourceNode: Node,
  targetNode: Node,
): { sourceSide: HandleSide; targetSide: HandleSide } {
  const src = getNodeCenter(sourceNode)
  const tgt = getNodeCenter(targetNode)

  const dx = tgt.cx - src.cx

  if (dx >= 0) {
    return { sourceSide: 'right', targetSide: 'left' }
  } else {
    return { sourceSide: 'left', targetSide: 'right' }
  }
}

/**
 * Recalculate handle IDs for a single edge based on current node positions.
 * Uses column-level handles so edges connect to specific fields.
 */
export function recalculateEdgeHandles(
  edge: RelationshipEdgeType,
  nodesById: Map<string, Node<TableNodeData>>,
): RelationshipEdgeType {
  const sourceNode = nodesById.get(edge.source)
  const targetNode = nodesById.get(edge.target)

  if (!sourceNode || !targetNode || !edge.data?.relationship) {
    return edge
  }

  const { sourceSide, targetSide } = calculateBestSides(sourceNode, targetNode)

  const sourceColumnId = edge.data.relationship.sourceColumnId
  const targetColumnId = edge.data.relationship.targetColumnId

  const newSourceHandle = createColumnHandleId(
    edge.source,
    sourceColumnId,
    sourceSide,
    'source',
  )
  const newTargetHandle = createColumnHandleId(
    edge.target,
    targetColumnId,
    targetSide,
    'target',
  )

  if (
    edge.sourceHandle === newSourceHandle &&
    edge.targetHandle === newTargetHandle
  ) {
    return edge
  }

  return {
    ...edge,
    sourceHandle: newSourceHandle,
    targetHandle: newTargetHandle,
  }
}

/**
 * Recalculate handles for all edges connected to the given node IDs.
 */
export function recalculateEdgesForDraggedNodes(
  edges: Array<RelationshipEdgeType>,
  nodes: Array<Node<TableNodeData>>,
  draggedNodeIds: Set<string>,
): Array<RelationshipEdgeType> {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))

  const updatedEdges = edges.map((edge) => {
    if (!draggedNodeIds.has(edge.source) && !draggedNodeIds.has(edge.target)) {
      return edge
    }
    return recalculateEdgeHandles(edge, nodesById)
  })

  const anyChanged = updatedEdges.some((e, i) => e !== edges[i])
  return anyChanged ? updatedEdges : edges
}

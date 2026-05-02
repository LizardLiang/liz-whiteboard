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
 * Parse a column handle ID back into its components.
 * Format: `{tableId}__{columnId}__{side}__{type}`
 *
 * Returns null if the handle ID doesn't match the expected format.
 */
export function parseColumnHandleId(handleId: string): {
  tableId: string
  columnId: string
  side: HandleSide
  type: 'source' | 'target'
} | null {
  const parts = handleId.split('__')
  if (parts.length !== 4) return null

  const [tableId, columnId, side, type] = parts

  if (side !== 'left' && side !== 'right') return null
  if (type !== 'source' && type !== 'target') return null

  return { tableId, columnId, side, type }
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

// Minimum clear horizontal gap (px) required before we treat nodes as
// being in different columns. Below this threshold the nodes are considered
// vertically aligned and we use same-side handles to avoid looping beziers.
const COLUMN_GAP_THRESHOLD = 20

/**
 * Determine which side each table should use for the edge connection,
 * based on relative horizontal position of the two nodes.
 *
 * - Source clearly LEFT of target  → source RIGHT, target LEFT
 * - Source clearly RIGHT of target → source LEFT, target RIGHT
 * - Same column (bounding boxes overlap or are within COLUMN_GAP_THRESHOLD)
 *   → source RIGHT, target RIGHT  (compact "C" curve on the right side,
 *     avoids the large loop that right→left produces for same-column nodes)
 */
export function calculateBestSides(
  sourceNode: Node,
  targetNode: Node,
): { sourceSide: HandleSide; targetSide: HandleSide } {
  const srcW = sourceNode.measured?.width ?? sourceNode.width ?? DEFAULT_NODE_WIDTH
  const tgtW = targetNode.measured?.width ?? targetNode.width ?? DEFAULT_NODE_WIDTH

  const srcLeft = sourceNode.position.x
  const srcRight = srcLeft + srcW
  const tgtLeft = targetNode.position.x
  const tgtRight = tgtLeft + tgtW

  if (tgtLeft > srcRight + COLUMN_GAP_THRESHOLD) {
    // Target is clearly to the right
    return { sourceSide: 'right', targetSide: 'left' }
  }
  if (srcLeft > tgtRight + COLUMN_GAP_THRESHOLD) {
    // Target is clearly to the left
    return { sourceSide: 'left', targetSide: 'right' }
  }
  // Same column or overlapping — route as a "C" on the right side
  return { sourceSide: 'right', targetSide: 'right' }
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

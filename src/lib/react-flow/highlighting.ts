/**
 * React Flow Highlighting Utilities
 *
 * Implements highlighting logic for tables and relationships
 * when tables are selected or hovered
 */

import { Z_INDEX } from './types'
import type {
  EdgeMap,
  HighlightResult,
  RelationshipEdgeType,
  TableNodeType,
} from './types'

/**
 * Build edge lookup map for fast relationship queries
 *
 * Creates a map where each table ID points to all edges connected to it
 * (both as source and target)
 *
 * @param edges - Array of relationship edges
 * @returns Map of table ID to connected edges
 */
export function buildEdgeMap(edges: Array<RelationshipEdgeType>): EdgeMap {
  const map = new Map<string, Array<RelationshipEdgeType>>()

  edges.forEach((edge) => {
    // Add to source table's edges
    const sourceEdges = map.get(edge.source) ?? []
    sourceEdges.push(edge)
    map.set(edge.source, sourceEdges)

    // Add to target table's edges
    const targetEdges = map.get(edge.target) ?? []
    targetEdges.push(edge)
    map.set(edge.target, targetEdges)
  })

  return map
}

/**
 * Calculate highlighting state for nodes and edges
 *
 * Determines which tables and relationships should be highlighted
 * based on the currently active or hovered table
 *
 * @param nodes - All table nodes
 * @param edges - All relationship edges
 * @param activeTableId - ID of actively selected table (clicked)
 * @param hoveredTableId - ID of currently hovered table
 * @returns Updated nodes and edges with highlighting state
 */
export function calculateHighlighting(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
  activeTableId: string | null,
  hoveredTableId: string | null,
): HighlightResult {
  const edgeMap = buildEdgeMap(edges)
  const relatedTableIds = new Set<string>()

  // Add active table and its related tables
  if (activeTableId) {
    relatedTableIds.add(activeTableId)
    const connectedEdges = edgeMap.get(activeTableId) ?? []
    connectedEdges.forEach((edge) => {
      relatedTableIds.add(edge.source)
      relatedTableIds.add(edge.target)
    })
  }

  // Add hovered table and its related tables
  if (hoveredTableId) {
    relatedTableIds.add(hoveredTableId)
    const connectedEdges = edgeMap.get(hoveredTableId) ?? []
    connectedEdges.forEach((edge) => {
      relatedTableIds.add(edge.source)
      relatedTableIds.add(edge.target)
    })
  }

  // Update node highlighting — only create a new object when something actually changed
  // so React.memo can skip re-renders for unaffected nodes
  const highlightedNodes = nodes.map((node) => {
    const isActiveHighlighted = node.id === activeTableId
    const isHighlighted =
      relatedTableIds.has(node.id) && node.id !== activeTableId
    const isHovered = node.id === hoveredTableId
    const newZIndex = relatedTableIds.has(node.id)
      ? Z_INDEX.NODE_HIGHLIGHTED
      : Z_INDEX.NODE_DEFAULT

    if (
      node.data.isActiveHighlighted === isActiveHighlighted &&
      node.data.isHighlighted === isHighlighted &&
      node.data.isHovered === isHovered &&
      node.zIndex === newZIndex
    ) {
      return node
    }

    return {
      ...node,
      data: { ...node.data, isActiveHighlighted, isHighlighted, isHovered },
      zIndex: newZIndex,
    }
  })

  // Update edge highlighting — only create a new object when isHighlighted changes
  // so React.memo can skip re-renders for unaffected edges
  const highlightedEdges = edges.map((edge) => {
    const isConnectedToActive =
      edge.source === activeTableId || edge.target === activeTableId
    const isConnectedToHovered =
      edge.source === hoveredTableId || edge.target === hoveredTableId
    const isHighlighted = isConnectedToActive || isConnectedToHovered
    const newZIndex = isHighlighted
      ? Z_INDEX.EDGE_HIGHLIGHTED
      : Z_INDEX.EDGE_DEFAULT

    if (
      edge.data?.isHighlighted === isHighlighted &&
      edge.zIndex === newZIndex
    ) {
      return edge
    }

    return {
      ...edge,
      data: { ...edge.data, isHighlighted },
      zIndex: newZIndex,
    } as RelationshipEdgeType
  })

  return {
    nodes: highlightedNodes,
    edges: highlightedEdges,
  }
}

/**
 * Custom hook for managing highlighting state
 *
 * @param nodes - All table nodes
 * @param edges - All relationship edges
 * @param activeTableId - ID of actively selected table
 * @param hoveredTableId - ID of currently hovered table
 * @returns Highlighted nodes and edges
 */
export function useHighlighting(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
  activeTableId: string | null,
  hoveredTableId: string | null,
): HighlightResult {
  return calculateHighlighting(nodes, edges, activeTableId, hoveredTableId)
}

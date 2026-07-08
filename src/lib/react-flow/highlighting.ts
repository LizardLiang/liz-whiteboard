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
 * Filter out edges that reference a stale/deleted column.
 *
 * Shared by ReactFlowCanvas.tsx's initialEdges effect, TableFocusOverlay.tsx's
 * focus computation, and getDirectlyRelatedTableIds below — a column can be
 * deleted while an edge referencing it hasn't been cleaned up yet (or hasn't
 * propagated), which previously produced the
 * "[React Flow]: Couldn't create edge for source handle id" warning flood.
 *
 * @param nodes - All table nodes (used to determine which columns still exist)
 * @param edges - Edges to filter
 * @returns Only edges whose source and target columns both still exist
 */
export function filterValidEdges(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
): Array<RelationshipEdgeType> {
  const existingColumnIds = new Set<string>()
  for (const node of nodes) {
    for (const col of node.data.table.columns) {
      existingColumnIds.add(col.id)
    }
  }

  return edges.filter((edge) => {
    const rel = edge.data?.relationship
    if (!rel) return false
    return (
      existingColumnIds.has(rel.sourceColumnId) &&
      existingColumnIds.has(rel.targetColumnId)
    )
  })
}

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
 * Calculate edge highlighting in isolation (GH #121 perf) — extracted from
 * calculateHighlighting's edge loop so ReactFlowCanvas's hover path can
 * recompute JUST the (far fewer) edges via setEdges without also rebuilding
 * the full node array via setNodes on every hover. calculateHighlighting
 * still exists unchanged (delegates to this internally) for callers that
 * want the combined node+edge result in one pass.
 *
 * @param edges - All relationship edges
 * @param activeTableId - ID of actively selected table (clicked)
 * @param hoveredTableId - ID of currently hovered table
 * @returns Edges with updated `isHighlighted`/`zIndex`; unaffected edges keep
 *   their original object reference so React.memo can skip their re-render
 */
export function calculateEdgeHighlighting(
  edges: Array<RelationshipEdgeType>,
  activeTableId: string | null,
  hoveredTableId: string | null,
): Array<RelationshipEdgeType> {
  return edges.map((edge) => {
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
 * @param relationsPreviewTableId - ID of the table whose relations panel is
 *   currently open (if any) — gets the top z-index tier so its attached
 *   panel always renders above every other node/edge
 * @returns Updated nodes and edges with highlighting state
 */
export function calculateHighlighting(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
  activeTableId: string | null,
  hoveredTableId: string | null,
  relationsPreviewTableId: string | null = null,
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
    const isRelationsPreviewOpen = node.id === relationsPreviewTableId
    const newZIndex = isRelationsPreviewOpen
      ? Z_INDEX.NODE_RELATIONS_PREVIEW
      : relatedTableIds.has(node.id)
        ? Z_INDEX.NODE_HIGHLIGHTED
        : Z_INDEX.NODE_DEFAULT

    if (
      node.data.isActiveHighlighted === isActiveHighlighted &&
      node.data.isHighlighted === isHighlighted &&
      node.data.isHovered === isHovered &&
      node.data.isRelationsPreviewOpen === isRelationsPreviewOpen &&
      node.zIndex === newZIndex
    ) {
      return node
    }

    return {
      ...node,
      data: {
        ...node.data,
        isActiveHighlighted,
        isHighlighted,
        isHovered,
        isRelationsPreviewOpen,
      },
      zIndex: newZIndex,
    }
  })

  // Update edge highlighting — only create a new object when isHighlighted changes
  // so React.memo can skip re-renders for unaffected edges
  const highlightedEdges = calculateEdgeHighlighting(
    edges,
    activeTableId,
    hoveredTableId,
  )

  return {
    nodes: highlightedNodes,
    edges: highlightedEdges,
  }
}

/**
 * Get the directly-related (1-hop) neighbor table ids for a given table.
 *
 * Expects `edges` to already be pre-filtered via `filterValidEdges` (both
 * call sites — ReactFlowCanvas.tsx and TableFocusOverlay.tsx — do this before
 * calling in), so a table whose only connecting edge is stale never gets
 * pulled in as a "related" table.
 *
 * @param tableId - ID of the table to find neighbors for
 * @param edges - Relationship edges, expected pre-filtered via filterValidEdges
 * @returns The seed table id + all 1-hop neighbor ids, plus the specific
 *   edges connected to `tableId` (not the full edge set touching the
 *   neighborhood), deduped by edge id — a self-referencing edge
 *   (source === target === tableId) is otherwise pushed into buildEdgeMap's
 *   result twice (once via the source loop, once via the target loop)
 */
export function getDirectlyRelatedTableIds(
  tableId: string,
  edges: Array<RelationshipEdgeType>,
): { relatedTableIds: Set<string>; relatedEdges: Array<RelationshipEdgeType> } {
  const edgeMap = buildEdgeMap(edges)
  const relatedTableIds = new Set<string>()
  relatedTableIds.add(tableId)

  const connectedEdges = edgeMap.get(tableId) ?? []
  const relatedEdges = [
    ...new Map(connectedEdges.map((edge) => [edge.id, edge])).values(),
  ]
  for (const edge of relatedEdges) {
    relatedTableIds.add(edge.source)
    relatedTableIds.add(edge.target)
  }

  return { relatedTableIds, relatedEdges }
}

/**
 * Custom hook for managing highlighting state
 *
 * @param nodes - All table nodes
 * @param edges - All relationship edges
 * @param activeTableId - ID of actively selected table
 * @param hoveredTableId - ID of currently hovered table
 * @param relationsPreviewTableId - ID of the table whose relations panel is open
 * @returns Highlighted nodes and edges
 */
export function useHighlighting(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
  activeTableId: string | null,
  hoveredTableId: string | null,
  relationsPreviewTableId: string | null = null,
): HighlightResult {
  return calculateHighlighting(
    nodes,
    edges,
    activeTableId,
    hoveredTableId,
    relationsPreviewTableId,
  )
}

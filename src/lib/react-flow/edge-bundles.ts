/**
 * Edge Bundle Offsets
 *
 * Fans parallel edges apart so they do not draw on top of each other. The
 * offsets are a pure function of the edges (with their handle sides) and the
 * node positions and sizes, so every path that moves a table or changes a
 * handle side recomputes them through recalculateEdgeRouting.
 */

import {
  parseColumnHandleId,
  recalculateEdgesForDraggedNodes,
} from './edge-routing'
import type { Node } from '@xyflow/react'
import type { RelationshipEdgeType, TableNodeData } from './types'
import { EDGE_SEP } from '@/lib/auto-layout/d3-force-layout'

// Default node width used when measured width is unavailable
const DEFAULT_NODE_WIDTH = 250

/** Bucket size (px) used to decide that two vertical segments share a corridor. */
const CORRIDOR_BUCKET = 8

export interface EdgeBundleOffset {
  handleYOffset: number
  centerXOffset: number
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function nodeWidth(node: Node): number {
  return node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH
}

function handleX(node: Node, side: 'left' | 'right'): number {
  return side === 'left' ? node.position.x : node.position.x + nodeWidth(node)
}

/** Spread the ids of one group symmetrically around 0, in id order. */
function spread(
  ids: Array<string>,
  assign: (id: string, offset: number) => void,
): void {
  const n = ids.length
  if (n <= 1) return
  const sorted = [...ids].sort(compareIds)
  for (let i = 0; i < n; i++) {
    assign(sorted[i], (i - (n - 1) / 2) * EDGE_SEP)
  }
}

/**
 * Compute per-edge bundle offsets from the real table positions.
 *
 * centerXOffset: edges whose vertical segment lands in the same 8 px bucket
 *   share a corridor. Cross-side edges (right to left, left to right) are keyed
 *   by the midpoint of the two handle x values. Same-side edges are keyed by
 *   side and the larger handle x. Each group is spread by EDGE_SEP in id order.
 *
 * handleYOffset: edges between the same table pair are spread by EDGE_SEP in
 *   id order, which separates their horizontal entry and exit segments.
 *
 * Groups of one edge get offset 0. Edges with unknown nodes or handles are
 * skipped and get offset 0.
 */
export function computeEdgeBundleOffsetsFromPositions(
  edges: Array<RelationshipEdgeType>,
  nodesById: Map<string, Node>,
): Map<string, EdgeBundleOffset> {
  const result = new Map<string, EdgeBundleOffset>()
  for (const edge of edges) {
    result.set(edge.id, { handleYOffset: 0, centerXOffset: 0 })
  }

  const corridorGroups = new Map<string, Array<string>>()
  const pairGroups = new Map<string, Array<string>>()

  for (const edge of edges) {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target) continue

    const a = edge.source
    const b = edge.target
    const pairKey = a < b ? `${a}:${b}` : `${b}:${a}`
    if (!pairGroups.has(pairKey)) pairGroups.set(pairKey, [])
    pairGroups.get(pairKey)!.push(edge.id)

    const src = edge.sourceHandle
      ? parseColumnHandleId(edge.sourceHandle)
      : null
    const tgt = edge.targetHandle
      ? parseColumnHandleId(edge.targetHandle)
      : null
    if (!src || !tgt) continue

    const sx = handleX(source, src.side)
    const tx = handleX(target, tgt.side)
    let key: string
    if (src.side !== tgt.side) {
      key = `x:${Math.round((sx + tx) / 2 / CORRIDOR_BUCKET)}`
    } else {
      key = `${src.side}:${Math.round(Math.max(sx, tx) / CORRIDOR_BUCKET)}`
    }
    if (!corridorGroups.has(key)) corridorGroups.set(key, [])
    corridorGroups.get(key)!.push(edge.id)
  }

  for (const ids of corridorGroups.values()) {
    spread(ids, (id, offset) => {
      result.get(id)!.centerXOffset = offset
    })
  }
  for (const ids of pairGroups.values()) {
    spread(ids, (id, offset) => {
      result.get(id)!.handleYOffset = offset
    })
  }

  return result
}

/**
 * Recalculate handle sides for edges touching the moved nodes, then recompute
 * the bundle offsets for ALL edges and write them into edge data. Returns the
 * same array when nothing changed.
 */
export function recalculateEdgeRouting(
  edges: Array<RelationshipEdgeType>,
  nodes: Array<Node<TableNodeData>>,
  movedIds: Set<string>,
): Array<RelationshipEdgeType> {
  const routed = recalculateEdgesForDraggedNodes(edges, nodes, movedIds)
  const offsets = computeEdgeBundleOffsetsFromPositions(
    routed,
    new Map(nodes.map((n) => [n.id, n])),
  )

  const updated = routed.map((edge) => {
    const off = offsets.get(edge.id)!
    const curY = edge.data?.bundleHandleYOffset ?? 0
    const curX = edge.data?.bundleCenterXOffset ?? 0
    if (curY === off.handleYOffset && curX === off.centerXOffset) return edge
    if (!edge.data) return edge
    return {
      ...edge,
      data: {
        ...edge.data,
        bundleHandleYOffset: off.handleYOffset,
        bundleCenterXOffset: off.centerXOffset,
      },
    }
  })

  const anyChanged = updated.some((e, i) => e !== edges[i])
  return anyChanged ? updated : edges
}

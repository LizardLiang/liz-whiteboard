// src/lib/auto-layout/index.ts
// Barrel re-exports for the auto-layout module.

export {
  computeD3ForceLayout,
  enforceGapPostPass,
  simulateChunked,
} from './d3-force-layout'

export type {
  LayoutInputEdge,
  LayoutInputNode,
  LayoutOutputPosition,
} from './d3-force-layout'

/**
 * Apply a bulk position update to a React Flow nodes array in O(n) time.
 *
 * Builds a Map from the positions array once, then maps over nodes — avoiding
 * the O(n × m) Array.find-inside-map pattern.
 *
 * @param nodes - Current React Flow nodes (read-only)
 * @param positions - Desired positions keyed by node id
 * @returns New nodes array with positions applied; unmatched nodes are unchanged
 */
export function applyBulkPositions<
  N extends { id: string; position: { x: number; y: number } },
>(
  nodes: ReadonlyArray<N>,
  positions: ReadonlyArray<{ id: string; x: number; y: number }>,
): Array<N> {
  const byId = new Map(positions.map((p) => [p.id, p]))
  return nodes.map((n) => {
    const p = byId.get(n.id)
    return p ? { ...n, position: { x: p.x, y: p.y } } : n
  })
}

// src/hooks/use-d3-force-layout.ts
// React hook wrapping computeD3ForceLayout.
// Reads node dimensions from React Flow's node.measured API and drives the
// d3-force simulation. Returns runLayout, isRunning, and error.
// Does NOT call setNodes — the orchestrator (use-auto-layout-orchestrator) owns that.

import { useCallback, useState } from 'react'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import type {
  LayoutOutputEdge,
  LayoutOutputPosition,
} from '@/lib/auto-layout/d3-force-layout'
import {
  assignLayersBFS,
  computeD3ForceLayout,
  computeEdgeBundleOffsets,
} from '@/lib/auto-layout/d3-force-layout'
import { getCachedTableWidth } from '@/lib/react-flow/canvas-node-metrics'
import { calculateTableHeight } from '@/lib/react-flow/layout-adapter'

export interface LayoutResult {
  /** Node positions to apply via applyBulkPositions */
  positions: Array<LayoutOutputPosition>
  /** Per-edge bundle offsets to apply to edge data */
  edgeOffsets: Array<LayoutOutputEdge>
}

export interface UseD3ForceLayoutOptions {
  onLayoutComplete?: (result: LayoutResult) => void
  onLayoutError?: (error: Error) => void
}

export interface UseD3ForceLayoutResult {
  /**
   * Run the layout computation.
   * Resolves to { positions, edgeOffsets } or null if an error occurred.
   */
  runLayout: (
    nodes: Array<TableNodeType>,
    edges: Array<RelationshipEdgeType>,
  ) => Promise<LayoutResult | null>
  /** True while the layout is computing */
  isRunning: boolean
  /** The last error, or null */
  error: Error | null
}

/**
 * React hook that wraps computeD3ForceLayout.
 *
 * Node dimensions: read from `node.measured?.width ?? node.width ?? 250`
 * and `node.measured?.height ?? node.height ?? 150` — matches the existing
 * ELK fallback pattern in elk-layout.ts lines 58-59.
 *
 * @example
 * ```tsx
 * const { runLayout, isRunning } = useD3ForceLayout()
 * const positions = await runLayout(nodes, edges)
 * if (positions) setNodes(…)
 * ```
 */
export function useD3ForceLayout(
  options: UseD3ForceLayoutOptions = {},
): UseD3ForceLayoutResult {
  const { onLayoutComplete, onLayoutError } = options
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const runLayout = useCallback(
    async (
      nodes: Array<TableNodeType>,
      edges: Array<RelationshipEdgeType>,
    ): Promise<LayoutResult | null> => {
      setIsRunning(true)
      setError(null)

      try {
        // Warn about nodes without measured dimensions (timing issue: ResizeObserver
        // may not have fired yet). Layout still runs with the 250×150 fallback.
        const unmeasured = nodes.filter((n) => !n.measured)
        if (unmeasured.length > 0) {
          console.warn(
            `Auto Layout: ${unmeasured.length} node(s) have no measured dimensions; using 250×150 fallback. IDs: ${unmeasured.map((n) => n.id).join(', ')}`,
          )
        }

        // Convert React Flow nodes to layout input.
        //
        // Table nodes: size from table DATA (full column list + saved width),
        // never from `node.measured` — the measured DOM box is LOD-trimmed
        // (header-only) when zoomed below LOD_ZOOM_THRESHOLD, which packed
        // positions for the trimmed size and caused overlap once zoomed back
        // in (GH #151 Bug 1). getCachedTableWidth is the same zoom-independent
        // width source TableNode's chrome-light wrapper and CanvasNodeLayer's
        // draw already use. Height uses calculateTableHeight (the established
        // full-content estimator: 40 + rows*28 + 12, per area-bounds.ts /
        // TableFocusOverlay), which slightly over-estimates vs the render
        // path's computeTableHeight (34 + rows*28) — safe, since over-
        // allocating vertical space only widens the gap, never overlaps.
        //
        // Non-table nodes (areas): keep the existing measured/width fallback
        // — they have no `data.table` to size against.
        const layoutNodes = nodes.map((n) => {
          const table = n.data.table
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `table` is non-nullable per TableNodeData, but this guards against a non-table node reaching this path at runtime (e.g. a future caller passing area nodes cast as TableNodeType).
          if (table) {
            return {
              id: n.id,
              width: getCachedTableWidth(
                table.id,
                table.name,
                table.columns,
                table.width,
              ),
              height: calculateTableHeight(table.columns.length),
            }
          }
          return {
            id: n.id,
            // Verbatim copy of elk-layout.ts:58-59 dimension fallback strategy
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            width: n.measured?.width ?? (n.width as number) ?? 250,
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            height: n.measured?.height ?? (n.height as number) ?? 150,
          }
        })

        // Convert React Flow edges to layout input.
        // Pass id so computeEdgeBundleOffsets can emit per-edge offsets keyed by id.
        // Pass label and cardinality so the layout engine can compute per-edge
        // label pill sizes from actual content (not a fixed constant).
        const layoutEdges = edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.data?.label ?? undefined,
          cardinality: e.data?.cardinality ?? undefined,
        }))

        const positions = await computeD3ForceLayout(layoutNodes, layoutEdges)

        // Compute per-edge bundle offsets (O(n+e), negligible cost).
        // Re-runs assignLayersBFS over all layout nodes — isolated nodes have
        // degree 0 so they don't affect the connected cluster's corridor keys.
        const layers = assignLayersBFS(layoutNodes, layoutEdges)
        const edgeOffsets = computeEdgeBundleOffsets(layoutEdges, layers)

        const result: LayoutResult = { positions, edgeOffsets }
        onLayoutComplete?.(result)
        return result
      } catch (err) {
        const layoutError = err instanceof Error ? err : new Error(String(err))
        setError(layoutError)
        onLayoutError?.(layoutError)
        return null
      } finally {
        setIsRunning(false)
      }
    },
    [onLayoutComplete, onLayoutError],
  )

  return { runLayout, isRunning, error }
}

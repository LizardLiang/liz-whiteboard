// src/hooks/use-d3-force-layout.ts
// React hook wrapping computeD3ForceLayout.
// Reads node dimensions from React Flow's node.measured API and drives the
// d3-force simulation. Returns runLayout, isRunning, and error.
// Does NOT call setNodes — the orchestrator (use-auto-layout-orchestrator) owns that.

import { useCallback, useState } from 'react'
import { computeD3ForceLayout } from '@/lib/auto-layout/d3-force-layout'
import type { LayoutOutputPosition } from '@/lib/auto-layout/d3-force-layout'
import type { TableNodeType, RelationshipEdgeType } from '@/lib/react-flow/types'

export interface UseD3ForceLayoutOptions {
  onLayoutComplete?: (positions: LayoutOutputPosition[]) => void
  onLayoutError?: (error: Error) => void
}

export interface UseD3ForceLayoutResult {
  /**
   * Run the layout computation.
   * Resolves to an array of { id, x, y } positions or null if an error occurred.
   */
  runLayout: (
    nodes: TableNodeType[],
    edges: RelationshipEdgeType[],
  ) => Promise<LayoutOutputPosition[] | null>
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
      nodes: TableNodeType[],
      edges: RelationshipEdgeType[],
    ): Promise<LayoutOutputPosition[] | null> => {
      setIsRunning(true)
      setError(null)

      try {
        // Convert React Flow nodes to layout input, reading measured dimensions
        const layoutNodes = nodes.map((n) => ({
          id: n.id,
          // Verbatim copy of elk-layout.ts:58-59 dimension fallback strategy
          width: n.measured?.width ?? (n.width as number | undefined) ?? 250,
          height: n.measured?.height ?? (n.height as number | undefined) ?? 150,
        }))

        // Convert React Flow edges to layout input (source/target table IDs)
        const layoutEdges = edges.map((e) => ({
          source: e.source,
          target: e.target,
        }))

        const positions = await computeD3ForceLayout(layoutNodes, layoutEdges)
        onLayoutComplete?.(positions)
        return positions
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        onLayoutError?.(error)
        return null
      } finally {
        setIsRunning(false)
      }
    },
    [onLayoutComplete, onLayoutError],
  )

  return { runLayout, isRunning, error }
}

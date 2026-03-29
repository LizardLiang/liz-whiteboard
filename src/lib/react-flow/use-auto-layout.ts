/**
 * useAutoLayout Hook
 * React hook for triggering ELK auto-layout on React Flow diagrams
 */

import { useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { computeELKLayout } from './elk-layout'
import type { RelationshipEdgeType, TableNodeType } from './types'

/**
 * Auto-layout hook options
 */
export interface UseAutoLayoutOptions {
  /** Callback after layout completes successfully */
  onLayoutComplete?: (nodes: Array<TableNodeType>) => void
  /** Callback when layout fails */
  onLayoutError?: (error: Error) => void
  /** Whether to fit view after layout (default: true) */
  fitViewAfterLayout?: boolean
  /** Delay before fitting view in ms (default: 100) */
  fitViewDelay?: number
}

/**
 * Auto-layout hook return value
 */
export interface UseAutoLayoutReturn {
  /** Trigger auto-layout computation */
  computeLayout: () => Promise<void>
  /** Whether layout is currently computing */
  isComputing: boolean
  /** Last error if layout failed */
  error: Error | null
}

/**
 * Hook for auto-layout functionality
 * Computes ELK hierarchical layout and updates node positions
 *
 * @param options - Configuration options
 * @returns Auto-layout controls
 *
 * @example
 * ```tsx
 * const { computeLayout, isComputing } = useAutoLayout({
 *   onLayoutComplete: (nodes) => console.log('Layout complete', nodes),
 *   fitViewAfterLayout: true,
 * })
 *
 * <button onClick={computeLayout} disabled={isComputing}>
 *   Auto Layout
 * </button>
 * ```
 */
export function useAutoLayout(
  options: UseAutoLayoutOptions = {},
): UseAutoLayoutReturn {
  const {
    onLayoutComplete,
    onLayoutError,
    fitViewAfterLayout = true,
    fitViewDelay = 100,
  } = options

  const { getNodes, getEdges, setNodes, fitView } = useReactFlow<
    TableNodeType,
    RelationshipEdgeType
  >()
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const computeLayout = useCallback(async () => {
    setIsComputing(true)
    setError(null)

    try {
      // Get current nodes and edges
      const nodes = getNodes()
      const edges = getEdges()

      if (nodes.length === 0) {
        throw new Error('No nodes to layout')
      }

      // Compute layout using ELK
      const layoutedNodes = await computeELKLayout(nodes, edges)

      // Update React Flow nodes
      setNodes(layoutedNodes)

      // Fit view after layout (with delay to allow React Flow to measure new positions)
      if (fitViewAfterLayout) {
        setTimeout(() => {
          fitView({ padding: 0.2, duration: 300 })
        }, fitViewDelay)
      }

      // Call success callback
      onLayoutComplete?.(layoutedNodes)
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error('Unknown layout error')
      setError(error)
      onLayoutError?.(error)
      console.error('Auto-layout failed:', error)
    } finally {
      setIsComputing(false)
    }
  }, [
    getNodes,
    getEdges,
    setNodes,
    fitView,
    fitViewAfterLayout,
    fitViewDelay,
    onLayoutComplete,
    onLayoutError,
  ])

  return {
    computeLayout,
    isComputing,
    error,
  }
}

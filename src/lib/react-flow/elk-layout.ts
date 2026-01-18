/**
 * ELK Layout Integration for React Flow
 * Provides hierarchical auto-layout using Eclipse Layout Kernel (ELK)
 */

import type { Edge, Node } from '@xyflow/react'
import type { ELKNode } from 'elkjs'
import type { RelationshipEdgeType, TableNodeType } from './types'

/**
 * ELK graph structure for layout computation
 */
export interface ELKGraph {
  id: string
  layoutOptions: Record<string, string>
  children: Array<ELKNode>
  edges: Array<{
    id: string
    sources: Array<string>
    targets: Array<string>
  }>
}

/**
 * Default ELK layout options for ERD diagrams
 * Uses 'layered' algorithm for hierarchical left-to-right layout
 */
export const DEFAULT_ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT', // Left-to-right layout
  'elk.layered.spacing.baseValue': '40',
  'elk.spacing.componentComponent': '80', // Space between disconnected groups
  'elk.layered.spacing.edgeNodeBetweenLayers': '120',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.layered.mergeEdges': 'true',
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
} as const

/**
 * Convert React Flow nodes to ELK graph format
 *
 * @param nodes - React Flow table nodes
 * @param edges - React Flow relationship edges
 * @param layoutOptions - Custom ELK layout options (optional)
 * @returns ELK graph structure
 */
export function convertNodesToELKGraph(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
  layoutOptions: Record<string, string> = DEFAULT_ELK_OPTIONS,
): ELKGraph {
  return {
    id: 'root',
    layoutOptions,
    children: nodes.map((node) => ({
      id: node.id,
      // Use measured dimensions if available, otherwise use defaults
      width: node.measured?.width ?? node.width ?? 250,
      height: node.measured?.height ?? node.height ?? 150,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }
}

/**
 * Apply ELK layout results to React Flow nodes
 * Updates node positions based on ELK computation
 *
 * @param nodes - Original React Flow nodes
 * @param elkNodes - ELK nodes with computed positions
 * @returns Updated React Flow nodes with new positions
 */
export function applyELKLayout(
  nodes: Array<TableNodeType>,
  elkNodes: Array<ELKNode>,
): Array<TableNodeType> {
  // Create lookup map for O(1) position lookup
  const layoutMap = new Map(
    elkNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
  )

  return nodes.map((node) => {
    const position = layoutMap.get(node.id)
    if (!position) {
      console.warn(`No layout position found for node ${node.id}`)
      return node
    }

    return {
      ...node,
      position,
    }
  })
}

/**
 * Compute ELK layout using Web Worker (non-blocking)
 *
 * @param nodes - React Flow table nodes
 * @param edges - React Flow relationship edges
 * @param layoutOptions - Custom ELK layout options (optional)
 * @returns Promise resolving to updated nodes with computed positions
 */
export async function computeELKLayout(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
  layoutOptions?: Record<string, string>,
): Promise<Array<TableNodeType>> {
  return new Promise((resolve, reject) => {
    // Create Web Worker
    const worker = new Worker(
      new URL('./elk-layout.worker.ts', import.meta.url),
      { type: 'module' },
    )

    // Set timeout to prevent hanging (10 seconds)
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('ELK layout computation timed out after 10 seconds'))
    }, 10000)

    // Handle worker response
    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout)
      worker.terminate()

      if (e.data.success) {
        // Apply computed layout to nodes
        const layoutedNodes = applyELKLayout(nodes, e.data.layout.children)
        resolve(layoutedNodes)
      } else {
        reject(new Error(e.data.error))
      }
    }

    // Handle worker errors
    worker.onerror = (error) => {
      clearTimeout(timeout)
      worker.terminate()
      reject(error)
    }

    // Send layout request to worker
    const graph = convertNodesToELKGraph(nodes, edges, layoutOptions)
    worker.postMessage(graph)
  })
}

/**
 * Extract positions from nodes for batch database update
 *
 * @param nodes - React Flow nodes with positions
 * @returns Array of {id, x, y} objects for database update
 */
export function extractPositionsForBatchUpdate(
  nodes: Array<TableNodeType>,
): Array<{ id: string; positionX: number; positionY: number }> {
  return nodes.map((node) => ({
    id: node.id,
    positionX: node.position.x,
    positionY: node.position.y,
  }))
}

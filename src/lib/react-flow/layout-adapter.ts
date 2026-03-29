/**
 * Layout Adapter for React Flow
 * Adapts d3-force layout algorithm to work with React Flow node format
 */

import type { TableNode } from './types'
import type { Column, DiagramTable, Relationship } from '@prisma/client'

/**
 * Layout computation options
 */
export interface LayoutOptions {
  width: number
  height: number
  linkDistance?: number
  chargeStrength?: number
  collisionPadding?: number
  iterations?: number
  handleClusters?: boolean
}

/**
 * Layout result with positions for each node
 */
export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>
  metadata: {
    computeTime: number
    iterations: number
    clusterCount: number
  }
}

/**
 * Apply layout results to React Flow nodes
 * Updates node positions based on layout computation
 *
 * @param nodes - Current React Flow nodes
 * @param layoutResult - Result from layout computation
 * @returns Updated nodes with new positions
 */
export function applyLayoutToNodes(
  nodes: Array<TableNode>,
  layoutResult: LayoutResult,
): Array<TableNode> {
  return nodes.map((node) => ({
    ...node,
    position: layoutResult.positions[node.id] || node.position,
  }))
}

/**
 * Convert React Flow nodes to format expected by d3-force layout worker
 *
 * @param nodes - React Flow nodes
 * @param edges - React Flow edges
 * @returns Data structure for layout worker
 */
export function prepareLayoutInput(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: LayoutOptions,
) {
  return {
    tables: tables.map((table) => ({
      id: table.id,
      name: table.name,
      x: table.positionX,
      y: table.positionY,
      width: table.width || 250,
      height: calculateTableHeight(table.columns.length),
      columns: table.columns,
    })),
    relationships: relationships.map((rel) => ({
      id: rel.id,
      source: rel.sourceTableId,
      target: rel.targetTableId,
      sourceColumn: rel.sourceColumnId,
      targetColumn: rel.targetColumnId,
      type: rel.relationshipType,
    })),
    canvasWidth: options.width,
    canvasHeight: options.height,
    options: {
      linkDistance: options.linkDistance || 200,
      chargeStrength: options.chargeStrength || -1000,
      collisionPadding: options.collisionPadding || 50,
      iterations: options.iterations || 300,
      handleClusters: options.handleClusters ?? true,
    },
  }
}

/**
 * Calculate table height based on number of columns
 */
function calculateTableHeight(columnCount: number): number {
  const headerHeight = 40
  const rowHeight = 28
  const padding = 12
  return headerHeight + columnCount * rowHeight + padding
}

/**
 * Calculate relationship strength based on column types
 * Primary key to foreign key relationships have higher strength
 *
 * @param relationship - Relationship data
 * @param tables - Table data with columns
 * @returns Strength value (0-1)
 */
export function calculateRelationshipStrength(
  relationship: Relationship,
  tables: Array<DiagramTable & { columns: Array<Column> }>,
): number {
  // Default strength
  let strength = 0.5

  // Find source and target tables
  const sourceTable = tables.find((t) => t.id === relationship.sourceTableId)
  const targetTable = tables.find((t) => t.id === relationship.targetTableId)

  if (!sourceTable || !targetTable) return strength

  // Find source and target columns
  const sourceColumn = relationship.sourceColumnId
    ? sourceTable.columns.find((c) => c.id === relationship.sourceColumnId)
    : null
  const targetColumn = relationship.targetColumnId
    ? targetTable.columns.find((c) => c.id === relationship.targetColumnId)
    : null

  // Increase strength for PK-FK relationships
  if (sourceColumn?.isPrimaryKey && targetColumn?.isForeignKey) {
    strength = 0.8
  } else if (sourceColumn?.isForeignKey || targetColumn?.isForeignKey) {
    strength = 0.7
  }

  // Increase strength for ONE_TO_MANY relationships
  if (relationship.relationshipType === 'ONE_TO_MANY') {
    strength += 0.1
  }

  return Math.min(strength, 1.0)
}

/**
 * Detect disconnected clusters in the graph
 * Groups nodes that are not connected to each other
 *
 * @param tables - Table data
 * @param relationships - Relationship data
 * @returns Array of clusters (each cluster is an array of table IDs)
 */
export function detectClusters(
  tables: Array<DiagramTable>,
  relationships: Array<Relationship>,
): Array<Array<string>> {
  const clusters: Array<Array<string>> = []
  const visited = new Set<string>()

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>()
  tables.forEach((table) => {
    adjacency.set(table.id, new Set())
  })

  relationships.forEach((rel) => {
    adjacency.get(rel.sourceTableId)?.add(rel.targetTableId)
    adjacency.get(rel.targetTableId)?.add(rel.sourceTableId)
  })

  // DFS to find connected components
  function dfs(nodeId: string, cluster: Array<string>) {
    visited.add(nodeId)
    cluster.push(nodeId)

    const neighbors = adjacency.get(nodeId)
    if (neighbors) {
      neighbors.forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          dfs(neighborId, cluster)
        }
      })
    }
  }

  // Find all clusters
  tables.forEach((table) => {
    if (!visited.has(table.id)) {
      const cluster: Array<string> = []
      dfs(table.id, cluster)
      clusters.push(cluster)
    }
  })

  return clusters
}

/**
 * Position disconnected clusters with spacing
 * Arranges clusters horizontally with padding between them
 *
 * @param positions - Current node positions
 * @param clusters - Cluster groups
 * @param clusterPadding - Horizontal padding between clusters
 * @returns Updated positions
 */
export function positionClusters(
  positions: Record<string, { x: number; y: number }>,
  clusters: Array<Array<string>>,
  clusterPadding: number = 300,
): Record<string, { x: number; y: number }> {
  if (clusters.length <= 1) return positions

  const updatedPositions = { ...positions }
  let offsetX = 0

  clusters.forEach((cluster, index) => {
    if (index === 0) return // First cluster stays at origin

    // Find bounding box of previous cluster
    let maxX = -Infinity
    clusters[index - 1].forEach((nodeId) => {
      const pos = updatedPositions[nodeId]
      if (pos) {
        maxX = Math.max(maxX, pos.x)
      }
    })

    // Calculate offset for current cluster
    offsetX = maxX + clusterPadding

    // Apply offset to all nodes in current cluster
    cluster.forEach((nodeId) => {
      const pos = updatedPositions[nodeId]
      if (pos) {
        updatedPositions[nodeId] = {
          x: pos.x + offsetX,
          y: pos.y,
        }
      }
    })
  })

  return updatedPositions
}

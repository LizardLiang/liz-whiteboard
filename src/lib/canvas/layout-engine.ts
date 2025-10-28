// src/lib/canvas/layout-engine.ts
// Force-directed layout engine using d3-force for automatic diagram arrangement

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Column, DiagramTable, Relationship } from '@prisma/client'

/**
 * Layout node representing a table in the simulation
 */
export interface LayoutNode extends SimulationNodeDatum {
  id: string
  /** Current X position */
  x: number
  /** Current Y position */
  y: number
  /** Node width for collision detection */
  width: number
  /** Node height for collision detection */
  height: number
  /** Original table data */
  table: DiagramTable & { columns: Array<Column> }
}

/**
 * Layout link representing a relationship between tables
 */
export interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  id: string
  source: string | LayoutNode
  target: string | LayoutNode
  /** Relationship strength (higher = closer positioning) */
  strength: number
  /** Original relationship data */
  relationship: Relationship
}

/**
 * Layout computation result
 */
export interface LayoutResult {
  /** Updated table positions */
  positions: Array<{
    id: string
    x: number
    y: number
  }>
  /** Layout metadata */
  metadata: {
    /** Number of iterations run */
    iterations: number
    /** Number of disconnected clusters */
    clusterCount: number
    /** Computation time in milliseconds */
    computeTime: number
  }
}

/**
 * Layout configuration options
 */
export interface LayoutOptions {
  /** Canvas width for centering */
  width: number
  /** Canvas height for centering */
  height: number
  /** Link distance multiplier (default: 200) */
  linkDistance?: number
  /** Charge strength (repulsion, default: -1000) */
  chargeStrength?: number
  /** Collision radius padding (default: 50) */
  collisionPadding?: number
  /** Number of simulation iterations (default: 300) */
  iterations?: number
  /** Whether to handle disconnected clusters separately (default: true) */
  handleClusters?: boolean
}

/**
 * Calculate relationship strength between two tables
 * Formula: directConnections + 0.5 * sharedNeighbors
 *
 * @param tableA - First table ID
 * @param tableB - Second table ID
 * @param relationships - All relationships in the diagram
 * @returns Strength value (higher = stronger connection)
 *
 * @example
 * ```ts
 * // Direct connection: A → B
 * calculateRelationshipStrength('A', 'B', [{ sourceTableId: 'A', targetTableId: 'B' }])
 * // Returns: 1
 *
 * // Shared neighbor: A → C, B → C
 * calculateRelationshipStrength('A', 'B', [
 *   { sourceTableId: 'A', targetTableId: 'C' },
 *   { sourceTableId: 'B', targetTableId: 'C' }
 * ])
 * // Returns: 0.5
 * ```
 */
export function calculateRelationshipStrength(
  tableA: string,
  tableB: string,
  relationships: Array<Relationship>,
): number {
  // Count direct connections
  let directConnections = 0
  for (const rel of relationships) {
    if (
      (rel.sourceTableId === tableA && rel.targetTableId === tableB) ||
      (rel.sourceTableId === tableB && rel.targetTableId === tableA)
    ) {
      directConnections++
    }
  }

  // Find neighbors for each table
  const aNeighbors = new Set<string>()
  const bNeighbors = new Set<string>()

  for (const rel of relationships) {
    if (rel.sourceTableId === tableA || rel.targetTableId === tableA) {
      const neighbor =
        rel.sourceTableId === tableA ? rel.targetTableId : rel.sourceTableId
      if (neighbor !== tableA) aNeighbors.add(neighbor)
    }
    if (rel.sourceTableId === tableB || rel.targetTableId === tableB) {
      const neighbor =
        rel.sourceTableId === tableB ? rel.targetTableId : rel.sourceTableId
      if (neighbor !== tableB) bNeighbors.add(neighbor)
    }
  }

  // Count shared neighbors
  const sharedNeighbors = [...aNeighbors].filter((n) =>
    bNeighbors.has(n),
  ).length

  return directConnections + 0.5 * sharedNeighbors
}

/**
 * Find disconnected table clusters using depth-first search
 *
 * @param tables - All tables in the diagram
 * @param relationships - All relationships between tables
 * @returns Array of table clusters (each cluster is an array of tables)
 */
export function findClusters(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
): Array<Array<DiagramTable & { columns: Array<Column> }>> {
  const visited = new Set<string>()
  const clusters: Array<Array<DiagramTable & { columns: Array<Column> }>> = []

  /**
   * Depth-first search to find all connected tables
   */
  function dfs(
    tableId: string,
    cluster: Array<DiagramTable & { columns: Array<Column> }>,
  ) {
    if (visited.has(tableId)) return
    visited.add(tableId)

    const table = tables.find((t) => t.id === tableId)
    if (table) cluster.push(table)

    // Find all connected tables through relationships
    for (const rel of relationships) {
      if (rel.sourceTableId === tableId && !visited.has(rel.targetTableId)) {
        dfs(rel.targetTableId, cluster)
      }
      if (rel.targetTableId === tableId && !visited.has(rel.sourceTableId)) {
        dfs(rel.sourceTableId, cluster)
      }
    }
  }

  // Find all clusters
  for (const table of tables) {
    if (!visited.has(table.id)) {
      const cluster: Array<DiagramTable & { columns: Array<Column> }> = []
      dfs(table.id, cluster)
      clusters.push(cluster)
    }
  }

  return clusters
}

/**
 * Calculate table dimensions for collision detection
 * Uses same logic as TableNode component
 *
 * @param table - Table with columns
 * @returns Width and height in pixels
 */
function calculateTableDimensions(
  table: DiagramTable & { columns: Array<Column> },
): {
  width: number
  height: number
} {
  const STYLE = {
    minWidth: 200,
    headerHeight: 40,
    rowHeight: 28,
    padding: 12,
  }

  // Rough estimate: 7-8 pixels per character
  const headerWidth = table.name.length * 8 + STYLE.padding * 2
  const columnWidths = table.columns.map(
    (col) =>
      (col.name.length + col.dataType.length + 10) * 7 + STYLE.padding * 2,
  )
  const maxColumnWidth = Math.max(...columnWidths, 0)

  const width = Math.max(
    STYLE.minWidth,
    headerWidth,
    maxColumnWidth,
    table.width ?? 0,
  )

  const height =
    STYLE.headerHeight + table.columns.length * STYLE.rowHeight + STYLE.padding

  return { width, height }
}

/**
 * Compute layout for a single cluster of connected tables
 *
 * @param tables - Tables in this cluster
 * @param relationships - Relationships in this cluster
 * @param options - Layout configuration
 * @returns Updated positions for tables in this cluster
 */
function computeClusterLayout(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: Required<LayoutOptions>,
): Array<{ id: string; x: number; y: number }> {
  // Create nodes from tables
  const nodes: Array<LayoutNode> = tables.map((table) => {
    const { width, height } = calculateTableDimensions(table)
    return {
      id: table.id,
      x: table.positionX,
      y: table.positionY,
      width,
      height,
      table,
    }
  })

  // Create links from relationships with calculated strength
  const links: Array<LayoutLink> = []
  const processedPairs = new Set<string>()

  for (const rel of relationships) {
    // Create unique key for this pair (bidirectional)
    const pairKey = [rel.sourceTableId, rel.targetTableId].sort().join('-')

    // Only process each pair once
    if (!processedPairs.has(pairKey)) {
      processedPairs.add(pairKey)

      const strength = calculateRelationshipStrength(
        rel.sourceTableId,
        rel.targetTableId,
        relationships,
      )

      links.push({
        id: rel.id,
        source: rel.sourceTableId,
        target: rel.targetTableId,
        strength: Math.max(strength, 0.1), // Minimum strength to avoid division by zero
        relationship: rel,
      })
    }
  }

  // Create force simulation
  const simulation = forceSimulation<LayoutNode>(nodes)
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((d) => d.id)
        .distance((d) => options.linkDistance / d.strength) // Stronger relationships = closer
        .strength((d) => Math.min(d.strength, 1)), // Normalize strength to 0-1
    )
    .force(
      'charge',
      forceManyBody<LayoutNode>().strength(options.chargeStrength), // Repulsion between all nodes
    )
    .force(
      'center',
      forceCenter<LayoutNode>(options.width / 2, options.height / 2), // Center the cluster
    )
    .force(
      'collide',
      forceCollide<LayoutNode>()
        .radius(
          (d) => Math.max(d.width, d.height) / 2 + options.collisionPadding,
        )
        .strength(1), // Prevent overlaps
    )
    .stop()

  // Run simulation synchronously
  for (let i = 0; i < options.iterations; ++i) {
    simulation.tick()
  }

  // Extract positions
  return nodes.map((node) => ({
    id: node.id,
    x: Math.round(node.x ?? node.table.positionX),
    y: Math.round(node.y ?? node.table.positionY),
  }))
}

/**
 * Compute force-directed layout for all tables
 * Handles disconnected clusters separately if configured
 *
 * @param tables - All tables in the diagram
 * @param relationships - All relationships in the diagram
 * @param options - Layout configuration
 * @returns Layout result with updated positions
 *
 * @example
 * ```ts
 * const result = computeLayout(tables, relationships, {
 *   width: 1920,
 *   height: 1080,
 *   linkDistance: 200,
 *   chargeStrength: -1000,
 * });
 *
 * // Apply positions to tables
 * for (const pos of result.positions) {
 *   await updateTablePosition(pos.id, pos.x, pos.y);
 * }
 * ```
 */
export function computeLayout(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: LayoutOptions,
): LayoutResult {
  const startTime = Date.now()

  // Merge with default options
  const opts: Required<LayoutOptions> = {
    width: options.width,
    height: options.height,
    linkDistance: options.linkDistance ?? 200,
    chargeStrength: options.chargeStrength ?? -1000,
    collisionPadding: options.collisionPadding ?? 50,
    iterations: options.iterations ?? 300,
    handleClusters: options.handleClusters ?? true,
  }

  // Handle edge cases
  if (tables.length === 0) {
    return {
      positions: [],
      metadata: {
        iterations: 0,
        clusterCount: 0,
        computeTime: Date.now() - startTime,
      },
    }
  }

  if (tables.length === 1) {
    // Single table - center it
    return {
      positions: [
        {
          id: tables[0].id,
          x: Math.round(opts.width / 2),
          y: Math.round(opts.height / 2),
        },
      ],
      metadata: {
        iterations: 0,
        clusterCount: 1,
        computeTime: Date.now() - startTime,
      },
    }
  }

  let allPositions: Array<{ id: string; x: number; y: number }> = []
  let clusterCount = 1

  if (opts.handleClusters) {
    // Find disconnected clusters
    const clusters = findClusters(tables, relationships)
    clusterCount = clusters.length

    if (clusters.length === 1) {
      // Single cluster - compute layout normally
      allPositions = computeClusterLayout(tables, relationships, opts)
    } else {
      // Multiple clusters - arrange in a grid
      const clusterSize = Math.ceil(Math.sqrt(clusters.length))
      const clusterWidth = opts.width / clusterSize
      const clusterHeight = opts.height / clusterSize

      clusters.forEach((cluster, index) => {
        // Find relationships within this cluster
        const clusterTableIds = new Set(cluster.map((t) => t.id))
        const clusterRelationships = relationships.filter(
          (rel) =>
            clusterTableIds.has(rel.sourceTableId) &&
            clusterTableIds.has(rel.targetTableId),
        )

        // Compute layout for this cluster with adjusted viewport
        const row = Math.floor(index / clusterSize)
        const col = index % clusterSize
        const clusterOptions = {
          ...opts,
          width: clusterWidth,
          height: clusterHeight,
        }

        const clusterPositions = computeClusterLayout(
          cluster,
          clusterRelationships,
          clusterOptions,
        )

        // Offset positions to cluster grid location
        const offsetX = col * clusterWidth
        const offsetY = row * clusterHeight

        const adjustedPositions = clusterPositions.map((pos) => ({
          id: pos.id,
          x: Math.round(pos.x + offsetX),
          y: Math.round(pos.y + offsetY),
        }))

        allPositions.push(...adjustedPositions)
      })
    }
  } else {
    // Don't handle clusters - compute as single graph
    allPositions = computeClusterLayout(tables, relationships, opts)
  }

  const computeTime = Date.now() - startTime

  return {
    positions: allPositions,
    metadata: {
      iterations: opts.iterations,
      clusterCount,
      computeTime,
    },
  }
}

/**
 * Compute layout asynchronously using Web Worker
 * (Implementation placeholder - actual worker code in layout-worker.ts)
 *
 * @param tables - All tables in the diagram
 * @param relationships - All relationships in the diagram
 * @param options - Layout configuration
 * @returns Promise that resolves to layout result
 */
export async function computeLayoutAsync(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: LayoutOptions,
): Promise<LayoutResult> {
  // For now, use synchronous computation
  // Web Worker implementation will be added in layout-worker.ts
  return new Promise((resolve) => {
    const result = computeLayout(tables, relationships, options)
    resolve(result)
  })
}

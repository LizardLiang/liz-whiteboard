// src/lib/auto-layout/d3-force-layout.ts
// Auto Layout engine for ER diagram tables.
//
// Strategy: layered (Sugiyama-style) layout.
//   1. Topological sort assigns each table a column based on FK depth.
//   2. Tables stack vertically within each column, columns read left-to-right.
//   3. Isolated tables (no FK edges) are placed in a row below the cluster.
//   4. A post-pass guarantees every pair has ≥ 16 px L∞ gap.
//
// Outputs top-left coordinates matching React Flow's node.position contract.
// Returns a Promise so the call-site API is unchanged.

import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutInputNode {
  id: string
  /** Rendered width of the table (px). Falls back to 250 if unmeasured. */
  width: number
  /** Rendered height of the table (px). Falls back to 150 if unmeasured. */
  height: number
}

export interface LayoutInputEdge {
  /** Source table ID */
  source: string
  /** Target table ID */
  target: string
}

export interface LayoutOutputPosition {
  id: string
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Internal node type — center coordinates, mutated by post-pass
// ---------------------------------------------------------------------------

export interface SimNode extends SimulationNodeDatum {
  id: string
  width: number
  height: number
  x: number
  y: number
}

type SimLink = SimulationLinkDatum<SimNode>

// ---------------------------------------------------------------------------
// simulateChunked — kept for backwards-compat and tests (TC-AL-E-10/11)
// ---------------------------------------------------------------------------

const TICK_BUDGET_PER_FRAME = 10
const MAX_TICKS = 500

export function simulateChunked(
  simulation: Simulation<SimNode, SimLink>,
): Promise<void> {
  return new Promise((resolve) => {
    let ticksRun = 0

    function frame() {
      const remaining = MAX_TICKS - ticksRun
      const chunk = Math.min(TICK_BUDGET_PER_FRAME, remaining)
      for (let i = 0; i < chunk; i++) simulation.tick()
      ticksRun += chunk

      if (ticksRun >= MAX_TICKS || simulation.alpha() < simulation.alphaMin()) {
        simulation.stop()
        resolve()
        return
      }

      requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
  })
}

// ---------------------------------------------------------------------------
// Post-pass: enforce 16 px L∞ gap on every pair
// ---------------------------------------------------------------------------

function l8Gap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): number {
  const gapX = Math.max(ax - (bx + bw), bx - (ax + aw))
  const gapY = Math.max(ay - (by + bh), by - (ay + ah))
  return Math.max(gapX, gapY)
}

const MIN_GAP = 16
const POST_PASS_SLACK = 1
const POST_PASS_MAX_SWEEPS = 5

/**
 * Deterministic O(n²) post-pass (center coordinates).
 * Ensures every pair of nodes has an L∞ gap ≥ MIN_GAP.
 */
export function enforceGapPostPass(nodes: Array<SimNode>): void {
  for (let sweep = 0; sweep < POST_PASS_MAX_SWEEPS; sweep++) {
    let anyViolation = false

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]

        const ax = a.x - a.width / 2
        const ay = a.y - a.height / 2
        const bx = b.x - b.width / 2
        const by = b.y - b.height / 2

        const gap = l8Gap(ax, ay, a.width, a.height, bx, by, b.width, b.height)

        if (gap < MIN_GAP) {
          anyViolation = true
          const nudge = MIN_GAP - gap + POST_PASS_SLACK

          const gapX = Math.max(ax - (bx + b.width), bx - (ax + a.width))
          const gapY = Math.max(ay - (by + b.height), by - (ay + a.height))

          const nudgeA = a.id < b.id
          const target = nudgeA ? a : b
          const other = nudgeA ? b : a

          if (gapX >= gapY) {
            target.x += target.x < other.x ? -nudge : nudge
          } else {
            target.y += target.y < other.y ? -nudge : nudge
          }
        }
      }
    }

    if (!anyViolation) break
  }
}

// ---------------------------------------------------------------------------
// Layered layout (left-to-right columns)
// ---------------------------------------------------------------------------

const COL_GAP = 80  // horizontal gap between columns
const ROW_GAP = 32  // vertical gap between nodes within a column

/**
 * Assign each node a column index via longest-path topological sort.
 * Nodes in cycles are placed in the column after the deepest reachable node.
 */
function assignLayersBFS(
  nodes: Array<LayoutInputNode>,
  edges: Array<LayoutInputEdge>,
): Map<string, number> {
  const nodeSet = new Set(nodes.map((n) => n.id))

  // Build undirected adjacency — FK direction is child→parent, so directed BFS
  // from the hub parent would find no outgoing edges and never expand.
  const adj = new Map<string, string[]>()
  const degree = new Map<string, number>()
  for (const n of nodes) { adj.set(n.id, []); degree.set(n.id, 0) }
  for (const e of edges) {
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
    degree.set(e.source, degree.get(e.source)! + 1)
    degree.set(e.target, degree.get(e.target)! + 1)
  }

  const layer = new Map<string, number>()
  let componentColOffset = 0

  // Process each connected component, starting with the most-connected node
  // so that hubs are always in the leftmost column of their component.
  const unvisited = new Set(nodes.map((n) => n.id))

  while (unvisited.size > 0) {
    // Pick the unvisited node with the highest degree (most connections) as root
    let root = ''
    let bestDegree = -1
    for (const id of unvisited) {
      const d = degree.get(id)!
      if (d > bestDegree || (d === bestDegree && id < root)) {
        bestDegree = d; root = id
      }
    }

    // BFS from root — assigns BFS distance as the column index
    const queue = [root]
    layer.set(root, componentColOffset)
    unvisited.delete(root)
    let head = 0
    let maxColInComp = componentColOffset

    while (head < queue.length) {
      const id = queue[head++]
      const col = layer.get(id)!
      for (const next of adj.get(id)!) {
        if (unvisited.has(next)) {
          layer.set(next, col + 1)
          maxColInComp = Math.max(maxColInComp, col + 1)
          unvisited.delete(next)
          queue.push(next)
        }
      }
    }

    // Next component starts after a 1-column gap
    componentColOffset = maxColInComp + 2
  }

  return layer
}

/**
 * Place connected nodes in left-to-right columns using BFS from the hub table.
 * BFS level = column index: root in col 0, its direct FK neighbours in col 1,
 * their neighbours in col 2, etc. Nodes stack vertically within each column.
 * Returns SimNodes with center coordinates (x, y).
 */
function layeredPlacement(
  nodes: Array<LayoutInputNode>,
  edges: Array<LayoutInputEdge>,
): Array<SimNode> {
  const layer = assignLayersBFS(nodes, edges)

  // Group by column (BFS level)
  const cols = new Map<number, Array<LayoutInputNode>>()
  for (const n of nodes) {
    const l = layer.get(n.id)!
    if (!cols.has(l)) cols.set(l, [])
    // Within each column sort by degree desc (most-connected at top), then id
    cols.get(l)!.push(n)
  }

  const simNodes: Array<SimNode> = []
  let leftEdge = 0

  for (const l of [...cols.keys()].sort((a, b) => a - b)) {
    const colNodes = cols.get(l)!
    const colWidth = Math.max(...colNodes.map((n) => n.width))

    let topEdge = 0
    for (const n of colNodes) {
      simNodes.push({
        id: n.id,
        width: n.width,
        height: n.height,
        x: leftEdge + colWidth / 2,
        y: topEdge + n.height / 2,
      })
      topEdge += n.height + ROW_GAP
    }

    leftEdge += colWidth + COL_GAP
  }

  return simNodes
}

// ---------------------------------------------------------------------------
// Isolated node placement
// ---------------------------------------------------------------------------

/**
 * Place isolated nodes in a column to the RIGHT of the connected cluster,
 * starting at the same top edge as the cluster. This keeps them visually
 * adjacent regardless of how tall the cluster is.
 */
function placeIsolatedNodes(
  isolated: Array<SimNode>,
  connected: Array<SimNode>,
): void {
  if (isolated.length === 0) return

  // Right edge of the connected cluster (or 0 if no connected nodes)
  let clusterRight = 0
  let clusterTop = 0
  if (connected.length > 0) {
    clusterRight = connected.reduce((max, n) => Math.max(max, n.x + n.width / 2), -Infinity)
    clusterTop = connected.reduce((min, n) => Math.min(min, n.y - n.height / 2), Infinity)
  }

  const startX = clusterRight + COL_GAP
  let topEdge = clusterTop

  for (const n of isolated) {
    n.x = startX + n.width / 2
    n.y = topEdge + n.height / 2
    topEdge += n.height + ROW_GAP
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute a left-to-right layered layout for ER diagram tables.
 *
 * - FK-connected tables are arranged in columns ordered by FK depth (left = fewer deps).
 * - Tables within each column stack top-to-bottom.
 * - Isolated tables (no FK edges) appear in a row below the connected cluster.
 * - Every pair of tables is guaranteed an L∞ gap ≥ 16 px.
 * - Returns top-left coordinates matching React Flow's node.position contract.
 */
export async function computeD3ForceLayout(
  nodes: Array<LayoutInputNode>,
  edges: Array<LayoutInputEdge>,
): Promise<Array<LayoutOutputPosition>> {
  if (nodes.length === 0) throw new Error('No nodes to layout')

  if (nodes.length === 1) return [{ id: nodes[0].id, x: 0, y: 0 }]

  // Split connected vs isolated
  const connectedIds = new Set<string>()
  for (const e of edges) { connectedIds.add(e.source); connectedIds.add(e.target) }
  const connectedNodes = nodes.filter((n) => connectedIds.has(n.id))
  const isolatedNodes = nodes.filter((n) => !connectedIds.has(n.id))

  // All nodes isolated: simple horizontal row
  if (connectedNodes.length === 0) {
    let x = 0
    return nodes.map((n) => {
      const pos = { id: n.id, x, y: 0 }
      x += n.width + ROW_GAP
      return pos
    })
  }

  // Layered placement for connected nodes (center coords)
  const connSimNodes = layeredPlacement(connectedNodes, edges)
  enforceGapPostPass(connSimNodes)

  // Isolated nodes below the cluster (center coords)
  const isoSimNodes: Array<SimNode> = isolatedNodes.map((n) => ({
    id: n.id, width: n.width, height: n.height, x: 0, y: 0,
  }))
  placeIsolatedNodes(isoSimNodes, connSimNodes)

  if (isoSimNodes.length > 0) {
    enforceGapPostPass([...connSimNodes, ...isoSimNodes])
  }

  // Convert center → top-left for React Flow
  return [
    ...connSimNodes.map((n) => ({ id: n.id, x: n.x - n.width / 2, y: n.y - n.height / 2 })),
    ...isoSimNodes.map((n) => ({ id: n.id, x: n.x - n.width / 2, y: n.y - n.height / 2 })),
  ]
}

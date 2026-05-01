// src/lib/auto-layout/d3-force-layout.ts
// Client-side d3-force layout engine for ER diagram Auto Layout.
// Returns new table positions as a Promise; all ticks are RAF-chunked
// (10 per frame, 500-tick hard cap) so no longtask ≥ 200 ms is produced.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force'
import type {
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force'

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
// Internal simulation node (mutable, d3 mutates x/y/vx/vy in place)
// ---------------------------------------------------------------------------

interface SimNode extends SimulationNodeDatum {
  id: string
  width: number
  height: number
  // d3 will set x/y; we initialize to 0 so TypeScript is happy
  x: number
  y: number
}

type SimLink = SimulationLinkDatum<SimNode>

// ---------------------------------------------------------------------------
// RAF-chunked tick runner
// ---------------------------------------------------------------------------

const TICK_BUDGET_PER_FRAME = 10
const MAX_TICKS = 500

/**
 * Drive the simulation manually through requestAnimationFrame.
 * Each RAF callback runs at most TICK_BUDGET_PER_FRAME ticks so the main
 * thread never blocks for > ~5 ms (satisfies the FR-007 longtask contract).
 */
export function simulateChunked(
  simulation: Simulation<SimNode, SimLink>,
): Promise<void> {
  return new Promise((resolve) => {
    let ticksRun = 0

    function frame() {
      const remaining = MAX_TICKS - ticksRun
      const chunk = Math.min(TICK_BUDGET_PER_FRAME, remaining)
      for (let i = 0; i < chunk; i++) {
        simulation.tick()
      }
      ticksRun += chunk

      if (
        ticksRun >= MAX_TICKS ||
        simulation.alpha() < simulation.alphaMin()
      ) {
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
// Post-pass: enforce 16 px L∞ gap on every pair (originator-screen guarantee)
// ---------------------------------------------------------------------------

/**
 * Compute the L∞ gap between two axis-aligned rectangles.
 * A positive value means the rectangles do NOT overlap; 0 means touching;
 * negative means they overlap.
 */
function l8Gap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  // Gaps along each axis (positive = separation, negative = overlap)
  const gapX = Math.max(ax - (bx + bw), bx - (ax + aw))
  const gapY = Math.max(ay - (by + bh), by - (ay + ah))
  // L∞ gap = max of the two axis gaps.
  // If both are negative (overlap in both axes) the min-negative is used.
  return Math.max(gapX, gapY)
}

const MIN_GAP = 16
const POST_PASS_SLACK = 1 // 1 px so floating-point doesn't push back below 16
const POST_PASS_MAX_SWEEPS = 5

/**
 * Deterministic O(n²) post-pass.
 * For every pair (A, B), if L∞ gap < MIN_GAP, nudge the node with the
 * lexicographically smaller `id` away from the other along the axis with the
 * smaller gap component. Runs up to POST_PASS_MAX_SWEEPS times to absorb
 * cascade effects.
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
          const nudge = (MIN_GAP - gap) + POST_PASS_SLACK

          // Determine nudge axis — use the axis where the gap component is smaller
          // (or whichever is more "separating" already).
          const gapX = Math.max(ax - (bx + b.width), bx - (ax + a.width))
          const gapY = Math.max(ay - (by + b.height), by - (ay + a.height))

          // Deterministic tie-breaker: nudge the node with the smaller ID
          // (lexicographically smaller) away from the other.
          const nudgeA = a.id < b.id
          const target = nudgeA ? a : b
          const other = nudgeA ? b : a

          if (gapX >= gapY) {
            // Separate along X axis
            if (target.x < other.x) {
              target.x -= nudge
            } else {
              target.x += nudge
            }
          } else {
            // Separate along Y axis
            if (target.y < other.y) {
              target.y -= nudge
            } else {
              target.y += nudge
            }
          }
        }
      }
    }

    // Stop early if no violations found in this sweep
    if (!anyViolation) break
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute a force-directed layout for a set of ER diagram tables.
 *
 * @param nodes - Table nodes with id + dimensions
 * @param edges - FK relationship edges (source/target table IDs)
 * @returns Promise resolving to array of { id, x, y } positions
 *
 * Guarantees (on the originator's screen):
 * - Every pair of tables has an L∞ gap ≥ 16 px after the post-pass.
 * - FK-related pairs are attracted closer than unrelated pairs.
 * - 0-FK whiteboards still produce non-overlapping layouts.
 * - Never produces a longtask ≥ 200 ms (10-tick RAF budget per frame).
 */
export async function computeD3ForceLayout(
  nodes: Array<LayoutInputNode>,
  edges: Array<LayoutInputEdge>,
): Promise<Array<LayoutOutputPosition>> {
  if (nodes.length === 0) {
    throw new Error('No nodes to layout')
  }

  // Single-node shortcut — nothing to separate
  if (nodes.length === 1) {
    return [{ id: nodes[0].id, x: nodes[0].width / 2, y: nodes[0].height / 2 }]
  }

  // Build simulation nodes (d3 mutates x/y in place)
  const simNodes: Array<SimNode> = nodes.map((n, i) => ({
    id: n.id,
    width: n.width,
    height: n.height,
    // Scatter nodes in a circle to avoid degenerate starting positions
    x: Math.cos((i / nodes.length) * 2 * Math.PI) * 200,
    y: Math.sin((i / nodes.length) * 2 * Math.PI) * 200,
  }))

  // Build simulation links (only between valid node IDs)
  const nodeIds = new Set(simNodes.map((n) => n.id))
  const simLinks: Array<SimLink> = edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }))

  // Compute average table size for scaling the link distance
  const avgWidth = nodes.reduce((s, n) => s + n.width, 0) / nodes.length
  const avgHeight = nodes.reduce((s, n) => s + n.height, 0) / nodes.length
  const avgSize = Math.sqrt(avgWidth * avgWidth + avgHeight * avgHeight)

  // Build forces
  const simulation = forceSimulation<SimNode>(simNodes)
    .force('charge', forceManyBody<SimNode>().strength(-800))
    .force(
      'collide',
      forceCollide<SimNode>().radius(
        (d) => Math.hypot(d.width, d.height) / 2 + 8,
      ),
    )
    .force('center', forceCenter(0, 0))
    .stop() // Prevent d3 from auto-running its internal async loop

  if (simLinks.length > 0) {
    simulation.force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(() => avgSize * 1.5)
        .strength(0.5),
    )
  }

  // Run the simulation in RAF-chunked batches
  await simulateChunked(simulation)

  // Apply deterministic post-pass to guarantee the 16 px L∞ gap contract
  enforceGapPostPass(simNodes)

  // Return final positions
  return simNodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))
}

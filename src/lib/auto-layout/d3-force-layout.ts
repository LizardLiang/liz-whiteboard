// src/lib/auto-layout/d3-force-layout.ts
// Auto Layout engine for ER diagram tables.
//
// Strategy: layered (Sugiyama-style) layout.
//   1. Topological sort assigns each table a column based on FK depth.
//   2. Tables stack vertically within each column, columns read left-to-right.
//   3. Isolated tables (no FK edges) are placed in a row below the cluster.
//   4. A post-pass guarantees every pair has ≥ 48 px L∞ gap.
//   5. A second post-pass pushes nodes away from estimated edge-label zones.
//
// Outputs top-left coordinates matching React Flow's node.position contract.
// Returns a Promise so the call-site API is unchanged.

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
  /**
   * Unique edge ID — used by computeEdgeBundleOffsets to emit per-edge offsets
   * back to the renderer. Optional so existing callers without IDs still compile;
   * bundle offset functions fall back to '' for deterministic sorting.
   */
  id?: string
  /** Source table ID */
  source: string
  /** Target table ID */
  target: string
  /**
   * Optional label text to reserve space for.
   * Passed through from RelationshipEdgeData.label.
   */
  label?: string
  /**
   * Optional cardinality type string (e.g. 'ONE_TO_MANY').
   * Used to compute per-end cardinality indicator extents.
   * Passed through from RelationshipEdgeData.cardinality.
   */
  cardinality?: string
}

export interface LayoutOutputPosition {
  id: string
  x: number
  y: number
}

/**
 * Per-edge bundle offset data returned alongside node positions.
 * Applied by RelationshipEdge.new.tsx to separate parallel/coincident edges.
 */
export interface LayoutOutputEdge {
  /** Edge ID matching LayoutInputEdge.id */
  id: string
  /**
   * Y offset (px) applied to source and target handle positions before
   * calling getSmoothStepPath. Separates horizontal segments for
   * same-table-pair bundles (multi-edges or near-coincident edges).
   * Positive = downward in canvas coordinates.
   */
  handleYOffset: number
  /**
   * X offset (px) applied to getSmoothStepPath's centerX parameter relative
   * to the natural corridor midpoint. Separates vertical step segments for
   * all edges in the same column corridor.
   */
  centerXOffset: number
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
// Post-pass: enforce 48 px L∞ gap on every pair
// ---------------------------------------------------------------------------

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
  const gapX = Math.max(ax - (bx + bw), bx - (ax + aw))
  const gapY = Math.max(ay - (by + bh), by - (ay + ah))
  return Math.max(gapX, gapY)
}

const MIN_GAP = 48
const POST_PASS_SLACK = 1
const POST_PASS_MAX_SWEEPS = 10

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
// Edge-label pill sizing — derived from RelationshipEdge.new.tsx styles
// ---------------------------------------------------------------------------

/**
 * Font spec for edge labels (mirrors RelationshipEdge.new.tsx).
 * Used for canvas.measureText() to get accurate text width.
 */
const LABEL_FONT_SPEC = '500 11px sans-serif'

/** Font size for edge labels (px). Matches RelationshipEdge.new.tsx. */
const LABEL_FONT_SIZE_PX = 11

/**
 * Per-character advance estimate (px/char) — fallback when canvas is unavailable.
 * Derived from RelationshipEdge.new.tsx input width formula:
 *   width: Math.max(60, editValue.length * 7 + 16)px
 * which implies 7 px/char for this font/size combination.
 */
export const LABEL_CHAR_ADVANCE = 7

/** Minimum pill width (px) — matches component's Math.max(60, ...) clamp. */
export const LABEL_MIN_PILL_WIDTH = 60

/** Horizontal padding (left + right) inside the pill, from padding: '3px 10px'. */
const PILL_H_PADDING = 20

/** Vertical padding (top + bottom) inside the pill, from padding: '3px 10px'. */
const PILL_V_PADDING = 6

/** Total border contribution (1px each side × 2). */
const PILL_BORDER = 2

/** CSS line-height multiplier for 11px text in an inline-flex pill. */
const LABEL_LINE_HEIGHT = 1.4

/** Minimum margin between a node AABB and the nearest label pill edge (px). */
export const EDGE_LABEL_MARGIN = 16

/**
 * Compute the rendered width of an edge label pill.
 *
 * Uses canvas.measureText() when available (real browser).
 * Falls back to charCount × LABEL_CHAR_ADVANCE (predictable in jsdom test env
 * where canvas.getContext returns null without the 'canvas' npm package).
 *
 * Pill horizontal structure (from RelationshipEdge.new.tsx):
 *   border(1) + padding(10) + text + padding(10) + border(1) = textWidth + 22px
 */
export function computeLabelPillWidth(label: string): number {
  if (!label) return 0
  let textWidth: number
  try {
    const canvas =
       
      typeof document !== 'undefined' ? document.createElement('canvas') : null
    const ctx = canvas?.getContext('2d') ?? null
    if (ctx) {
      ctx.font = LABEL_FONT_SPEC
      const metrics = ctx.measureText(label)
      // jsdom without the canvas npm package returns width=0 — use char fallback
      const letterSpacingExtra = label.length * 0.02 * LABEL_FONT_SIZE_PX
      textWidth =
        metrics.width > 0
          ? metrics.width + letterSpacingExtra
          : label.length * LABEL_CHAR_ADVANCE
    } else {
      textWidth = label.length * LABEL_CHAR_ADVANCE
    }
  } catch {
    textWidth = label.length * LABEL_CHAR_ADVANCE
  }
  return (
    Math.max(LABEL_MIN_PILL_WIDTH, textWidth) + PILL_H_PADDING + PILL_BORDER
  )
}

/**
 * Compute the rendered height of an edge label pill.
 * Derived from RelationshipEdge.new.tsx: fontSize=11, line-height≈1.4,
 * padding='3px 10px', border=1px each side.
 */
export function computeLabelPillHeight(): number {
  return (
    Math.ceil(LABEL_FONT_SIZE_PX * LABEL_LINE_HEIGHT) +
    PILL_V_PADDING +
    PILL_BORDER
  )
}

// ---------------------------------------------------------------------------
// Cardinality indicator extent — mirrors RelationshipEdge.new.tsx constants
// ---------------------------------------------------------------------------

/**
 * Crow's foot convergence-point distance outward from the handle (px).
 * Mirrors CROW_LENGTH in RelationshipEdge.new.tsx.
 */
const CROW_LENGTH_EXTENT = 2

/**
 * Distance from multiplicity outer edge to optionality symbol center (px).
 * Mirrors OPT_GAP in RelationshipEdge.new.tsx.
 */
const OPT_GAP_EXTENT = 7

/**
 * Open circle radius for the optional symbol (px).
 * Mirrors CIRCLE_R in RelationshipEdge.new.tsx.
 */
const CARDINALITY_SYMBOL_RADIUS = 4

/**
 * How far a cardinality indicator extends outward from the handle into the
 * inter-node gap. Mirrors the indicatorExtent() function in RelationshipEdge.new.tsx.
 */
function cardinalityIndicatorExtent(isMany: boolean): number {
  return (
    (isMany ? CROW_LENGTH_EXTENT : 0) +
    OPT_GAP_EXTENT +
    CARDINALITY_SYMBOL_RADIUS
  )
}

/** Maximum indicator extent (crow's foot end). Used as a conservative default. */
const MAX_CARDINALITY_EXTENT = cardinalityIndicatorExtent(true) // 13 px

/**
 * srcMany / tgtMany flags per cardinality type.
 * Mirrors CARDINALITY_FLAGS in RelationshipEdge.new.tsx (only the 'many' booleans needed).
 * Tuple: [srcMany, tgtMany]
 */
const CARDINALITY_MANY: Readonly<Record<string, readonly [boolean, boolean]>> =
  {
    ONE_TO_ONE: [false, false],
    ONE_TO_MANY: [false, true],
    MANY_TO_ONE: [true, false],
    MANY_TO_MANY: [true, true],
    ZERO_TO_ONE: [false, false],
    ZERO_TO_MANY: [false, true],
    SELF_REFERENCING: [false, true],
    MANY_TO_ZERO_OR_ONE: [true, false],
    MANY_TO_ZERO_OR_MANY: [true, true],
    ZERO_OR_ONE_TO_ONE: [false, false],
    ZERO_OR_ONE_TO_MANY: [false, true],
    ZERO_OR_ONE_TO_ZERO_OR_ONE: [false, false],
    ZERO_OR_ONE_TO_ZERO_OR_MANY: [false, true],
    ZERO_OR_MANY_TO_ONE: [true, false],
    ZERO_OR_MANY_TO_MANY: [true, true],
    ZERO_OR_MANY_TO_ZERO_OR_ONE: [true, false],
    ZERO_OR_MANY_TO_ZERO_OR_MANY: [true, true],
  }

// ---------------------------------------------------------------------------
// Per-edge column gap computation
// ---------------------------------------------------------------------------

/**
 * Compute the minimum inter-column gap required for a set of edges.
 * For each edge, the required gap is:
 *   leftCardinalityExtent + EDGE_LABEL_MARGIN + pillWidth + EDGE_LABEL_MARGIN + rightCardinalityExtent
 * Returns at least COL_GAP (the floor) even when there are no labelled edges.
 */
export function computeRequiredColGap(edges: Array<LayoutInputEdge>): number {
  let maxRequired = COL_GAP
  for (const edge of edges) {
    const pillWidth = computeLabelPillWidth(edge.label ?? '')
    const flags =
      CARDINALITY_MANY[edge.cardinality ?? ''] ?? ([false, false] as const)
    const srcExt = cardinalityIndicatorExtent(flags[0])
    const tgtExt = cardinalityIndicatorExtent(flags[1])
    const required =
      pillWidth > 0
        ? srcExt + EDGE_LABEL_MARGIN + pillWidth + EDGE_LABEL_MARGIN + tgtExt
        : MAX_CARDINALITY_EXTENT * 2 + MIN_GAP
    maxRequired = Math.max(maxRequired, required)
  }
  return maxRequired
}

// ---------------------------------------------------------------------------
// Edge-label zone post-pass
// ---------------------------------------------------------------------------

/**
 * Push non-endpoint nodes out of estimated edge-label zones.
 *
 * For each edge, estimates where the label pill will appear (midpoint between
 * the two endpoints' inner-facing edges, adjusted for cardinality extents) and
 * nudges any NON-ENDPOINT node whose AABB intrudes into that zone.
 *
 * Label pill width is computed per-edge from the actual label text using
 * computeLabelPillWidth() — no single shared constant.
 */
export function enforceEdgeLabelGap(
  nodes: Array<SimNode>,
  edges: Array<LayoutInputEdge>,
): void {
  for (let sweep = 0; sweep < POST_PASS_MAX_SWEEPS; sweep++) {
    let anyViolation = false

    for (const edge of edges) {
      const sourceNode = nodes.find((n) => n.id === edge.source)
      const targetNode = nodes.find((n) => n.id === edge.target)
      if (!sourceNode || !targetNode) continue

      const leftNode = sourceNode.x <= targetNode.x ? sourceNode : targetNode
      const rightNode = sourceNode.x <= targetNode.x ? targetNode : sourceNode

      // Per-edge cardinality extents
      const leftIsSource = leftNode.id === edge.source
      const flags =
        CARDINALITY_MANY[edge.cardinality ?? ''] ?? ([false, false] as const)
      const leftIsMany = leftIsSource ? flags[0] : flags[1]
      const rightIsMany = leftIsSource ? flags[1] : flags[0]
      const leftExt = cardinalityIndicatorExtent(leftIsMany)
      const rightExt = cardinalityIndicatorExtent(rightIsMany)

      // Per-edge label pill dimensions
      const pillWidth = computeLabelPillWidth(edge.label ?? '')
      const pillHeight = computeLabelPillHeight()

      // Estimated label midpoint — between inner-facing edges, accounting for
      // cardinality indicator extents (mirrors the getSmoothStepPath adjustment
      // in RelationshipEdge.new.tsx: adjSourceX + leftExt ... adjTargetX - rightExt)
      const midX =
        (leftNode.x +
          leftNode.width / 2 +
          leftExt +
          rightNode.x -
          rightNode.width / 2 -
          rightExt) /
        2
      const midY = (leftNode.y + rightNode.y) / 2

      // Use minimum label zone width even for unlabelled edges (cardinality markers alone
      // occupy leftExt + rightExt px of the gap; reserve that + margin on each side)
      const zoneW =
        Math.max(pillWidth, leftExt + rightExt) + 2 * EDGE_LABEL_MARGIN
      const zoneH =
        (pillWidth > 0 ? pillHeight : leftExt + rightExt) +
        2 * EDGE_LABEL_MARGIN

      const lx = midX - zoneW / 2
      const ly = midY - zoneH / 2

      for (const node of nodes) {
        if (node.id === edge.source || node.id === edge.target) continue

        // Node AABB (top-left from center)
        const nx = node.x - node.width / 2
        const ny = node.y - node.height / 2
        const nw = node.width
        const nh = node.height

        // Signed gaps on each axis (negative = overlap)
        const gapX = Math.max(nx - (lx + zoneW), lx - (nx + nw))
        const gapY = Math.max(ny - (ly + zoneH), ly - (ny + nh))
        const gap = Math.max(gapX, gapY)

        if (gap < 0) {
          anyViolation = true
          // Nudge enough to exit the zone plus a small slack
          const nudge = -gap + POST_PASS_SLACK

          if (gapX >= gapY) {
            // Less overlap on X — push horizontally
            node.x += node.x < midX ? -nudge : nudge
          } else {
            // Less overlap on Y — push vertically
            node.y += node.y < midY ? -nudge : nudge
          }
        }
      }
    }

    if (!anyViolation) break
  }
}

// ---------------------------------------------------------------------------
// Same-side label X clamping — render-time helper used by RelationshipEdge.new.tsx
// ---------------------------------------------------------------------------

/**
 * Minimum clearance between a handle position and the nearest pill edge (px).
 * Small enough to keep labels visually close to the edge, large enough to
 * provide breathing room from the table body.
 */
export const LABEL_PILL_CLAMP_MARGIN = 8

/**
 * Clamp a label's X position so the pill doesn't overlap either endpoint's
 * table body when both handles exit from the same side (right→right or left→left).
 *
 * `getSmoothStepPath` returns the geometric path midpoint as `labelX`. For
 * same-side C-curves with long labels the pill can extend back over the source
 * or target table body. This function clamps labelX so that:
 *
 *   right→right: pill left edge ≥ max(sourceX, targetX) + LABEL_PILL_CLAMP_MARGIN
 *   left→left:   pill right edge ≤ min(sourceX, targetX) − LABEL_PILL_CLAMP_MARGIN
 *
 * For cross-column routing (right→left or left→right) the midpoint already sits
 * in the inter-table gap guaranteed by `computeRequiredColGap` — no clamp applied.
 *
 * @param labelX     Raw labelX from getSmoothStepPath (canvas coordinates)
 * @param pillWidth  Pill outer width from computeLabelPillWidth()
 * @param sourceX    Source handle X (canvas coordinates)
 * @param sourceSide Handle side of the source node ('left' | 'right')
 * @param targetX    Target handle X (canvas coordinates)
 * @param targetSide Handle side of the target node ('left' | 'right')
 */
export function clampSameSideLabelX(
  labelX: number,
  pillWidth: number,
  sourceX: number,
  sourceSide: string,
  targetX: number,
  targetSide: string,
): number {
  if (pillWidth <= 0) return labelX
  if (sourceSide === 'right' && targetSide === 'right') {
    // C-curve exits right: pill must be entirely to the right of both handles
    const minX =
      Math.max(sourceX, targetX) + pillWidth / 2 + LABEL_PILL_CLAMP_MARGIN
    return Math.max(labelX, minX)
  }
  if (sourceSide === 'left' && targetSide === 'left') {
    // C-curve exits left: pill must be entirely to the left of both handles
    const maxX =
      Math.min(sourceX, targetX) - pillWidth / 2 - LABEL_PILL_CLAMP_MARGIN
    return Math.min(labelX, maxX)
  }
  // Cross-column (right→left or left→right): no clamp needed
  return labelX
}

// ---------------------------------------------------------------------------
// Label-vs-label pairwise collision resolution
// ---------------------------------------------------------------------------

/**
 * Separate overlapping edge-label pills by adjusting unique node positions.
 *
 * For each pair of labelled edges, estimates the label centre as the midpoint
 * between node centres and checks whether the two pill AABBs intersect
 * (including EDGE_LABEL_MARGIN as buffer). When they do, the node unique to
 * the lower-y-label edge is pushed downward. The nudge factor is ×2 because
 * label midY = (S.y + T.y)/2 — moving one endpoint by d shifts midY by d/2.
 *
 * Runs up to POST_PASS_MAX_SWEEPS iterations to converge.
 */
export function enforceLabelLabelGap(
  nodes: Array<SimNode>,
  edges: Array<LayoutInputEdge>,
): void {
  const pillH = computeLabelPillHeight()

  for (let sweep = 0; sweep < POST_PASS_MAX_SWEEPS; sweep++) {
    let anyViolation = false

    // Build estimated label AABB centre for each labelled edge
    const labelBoxes: Array<{
      edgeIdx: number
      cx: number
      cy: number
      w: number
      h: number
    }> = []

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]
      const sourceNode = nodes.find((n) => n.id === edge.source)
      const targetNode = nodes.find((n) => n.id === edge.target)
      if (!sourceNode || !targetNode) continue

      const pillW = computeLabelPillWidth(edge.label ?? '')
      if (pillW <= 0) continue // skip unlabelled edges

      labelBoxes.push({
        edgeIdx: i,
        cx: (sourceNode.x + targetNode.x) / 2,
        cy: (sourceNode.y + targetNode.y) / 2,
        w: pillW,
        h: pillH,
      })
    }

    // Check all pairs for overlap
    for (let i = 0; i < labelBoxes.length; i++) {
      for (let j = i + 1; j < labelBoxes.length; j++) {
        const a = labelBoxes[i]
        const b = labelBoxes[j]

        // Full AABB overlap on X axis
        const overlapX = (a.w + b.w) / 2 - Math.abs(a.cx - b.cx)
        // Y overlap including a margin gap between pills
        const overlapY =
          (a.h + b.h) / 2 + EDGE_LABEL_MARGIN - Math.abs(a.cy - b.cy)

        if (overlapX > 0 && overlapY > 0) {
          anyViolation = true

          const edgeA = edges[a.edgeIdx]
          const edgeB = edges[b.edgeIdx]

          // Lower label = higher cy value (y increases downward in canvas coords)
          const lowerEdge = a.cy >= b.cy ? edgeA : edgeB
          const upperEdge = a.cy >= b.cy ? edgeB : edgeA

          // Nudge ×2: moving one endpoint by d shifts label midY by d/2
          const nudge = 2 * (overlapY + POST_PASS_SLACK)

          // Find the unique node of the lower edge (not shared with upper edge)
          const upperIds = new Set([upperEdge.source, upperEdge.target])
          const uniqueId = upperIds.has(lowerEdge.source)
            ? lowerEdge.target
            : upperIds.has(lowerEdge.target)
              ? lowerEdge.source
              : null // no shared node

          if (uniqueId !== null) {
            const node = nodes.find((n) => n.id === uniqueId)
            if (node) node.y += nudge
          } else {
            // No shared node: push both lower-edge endpoints down by nudge/2 each
            // (combined shift of nudge/2 on midY equals overlapY + slack)
            const srcNode = nodes.find((n) => n.id === lowerEdge.source)
            const tgtNode = nodes.find((n) => n.id === lowerEdge.target)
            if (srcNode) srcNode.y += nudge / 2
            if (tgtNode) tgtNode.y += nudge / 2
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

/**
 * Minimum inter-column gap (px) — a visual floor only.
 * computeRequiredColGap() will raise this per layout run based on actual edge labels.
 * Set to cover cardinality indicators (13px×2) + breathing room (54px) = 80px.
 */
export const COL_GAP = 80
const ROW_GAP = 80 // vertical gap between nodes within a column

// ---------------------------------------------------------------------------
// Edge-bundle separation constants
// ---------------------------------------------------------------------------

/**
 * Inactive stroke width (px) of the main edge path.
 * Source of truth: RelationshipEdge.new.tsx — strokeWidth={isActive ? 2.5 : 1.5}
 * The inactive (default) width is used because bundles pile up during normal
 * (non-selected) rendering.
 */
export const EDGE_STROKE_WIDTH = 1.5

/**
 * Minimum visual gap between adjacent parallel edges in a bundle (px).
 * Small fixed separation gap — acceptable per project rule: a small fixed
 * MARGIN/separation-gap constant is acceptable.
 */
export const EDGE_BUNDLE_MARGIN = 4

/**
 * Centre-to-centre distance between adjacent parallel edges in a bundle (px).
 * Derived from actual stroke width + minimum gap.
 */
export const EDGE_SEP = EDGE_STROKE_WIDTH + EDGE_BUNDLE_MARGIN // 5.5 px

/**
 * Assign each node a column index via longest-path topological sort.
 * Nodes in cycles are placed in the column after the deepest reachable node.
 */
export function assignLayersBFS(
  nodes: Array<LayoutInputNode>,
  edges: Array<LayoutInputEdge>,
): Map<string, number> {
  const nodeSet = new Set(nodes.map((n) => n.id))

  // Build undirected adjacency — FK direction is child→parent, so directed BFS
  // from the hub parent would find no outgoing edges and never expand.
  const adj = new Map<string, Array<string>>()
  const degree = new Map<string, number>()
  for (const n of nodes) {
    adj.set(n.id, [])
    degree.set(n.id, 0)
  }
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
        bestDegree = d
        root = id
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
 *
 * @param colGap  - Inter-column gap (px). Use computeRequiredColGap() to derive from edge labels.
 * @param layers  - Pre-computed layer map from assignLayersBFS (avoids double computation).
 */
function layeredPlacement(
  nodes: Array<LayoutInputNode>,
  colGap: number,
  layers: Map<string, number>,
): Array<SimNode> {
  const layer = layers

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

    leftEdge += colWidth + colGap
  }

  return simNodes
}

// ---------------------------------------------------------------------------
// Edge bundle offset computation
// ---------------------------------------------------------------------------

/**
 * Maximum extra corridor width (px) required to fan parallel edges in the
 * busiest column corridor. Returns 0 when no corridor has more than 1 edge.
 *
 * Formula: max over all (srcCol, tgtCol) corridors of (N − 1) × EDGE_SEP
 * where N = count of edges crossing that corridor.
 *
 * This value is ADDED to effectiveColGap inside computeD3ForceLayout so the
 * fanned vertical step segments fit without competing for space with label pills.
 */
export function computeMaxCorridorBundleWidth(
  edges: Array<LayoutInputEdge>,
  layers: Map<string, number>,
): number {
  const counts = new Map<string, number>()
  for (const edge of edges) {
    const a = layers.get(edge.source) ?? 0
    const b = layers.get(edge.target) ?? 0
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let max = 0
  for (const n of counts.values()) {
    if (n > 1) max = Math.max(max, (n - 1) * EDGE_SEP)
  }
  return max
}

/**
 * Compute per-edge bundle offsets for separating parallel/coincident edges.
 *
 * Pass A — column-corridor centerXOffset:
 *   Groups all edges by (minCol, maxCol) corridor. Within each group (sorted by
 *   edge.id for determinism), assigns centerXOffset = (i − (n−1)/2) × EDGE_SEP.
 *   This fans the vertical step segments of getSmoothStepPath horizontally.
 *
 * Pass B — table-pair handleYOffset:
 *   Groups all edges by normalised (minNodeId, maxNodeId) table pair. Within each
 *   sub-bundle (sorted by edge.id), assigns handleYOffset = (i − (n−1)/2) × EDGE_SEP
 *   when the sub-bundle size > 1. Separates horizontal entry/exit segments for
 *   multi-edges between the same table pair.
 *
 * Middle edge in each group is unshifted (offset = 0). Outer edges receive
 * symmetric positive/negative offsets. Sum of all offsets in a group = 0.
 */
export function computeEdgeBundleOffsets(
  edges: Array<LayoutInputEdge>,
  layers: Map<string, number>,
): Array<LayoutOutputEdge> {
  // Initialise output — one entry per input edge (same order)
  const result: Array<LayoutOutputEdge> = edges.map((e) => ({
    id: e.id ?? '',
    handleYOffset: 0,
    centerXOffset: 0,
  }))

  // ── Pass A: centerXOffset by column corridor ──────────────────────────────
  const corridorGroups = new Map<string, Array<number>>() // key → indices into edges[]
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const a = layers.get(edge.source) ?? 0
    const b = layers.get(edge.target) ?? 0
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    if (!corridorGroups.has(key)) corridorGroups.set(key, [])
    corridorGroups.get(key)!.push(i)
  }

  for (const indices of corridorGroups.values()) {
    const n = indices.length
    if (n <= 1) continue // single edge in corridor — no offset needed
    // Sort by id for determinism
    indices.sort((a, b) => {
      const idA = edges[a].id ?? ''
      const idB = edges[b].id ?? ''
      return idA < idB ? -1 : idA > idB ? 1 : 0
    })
    for (let i = 0; i < n; i++) {
      result[indices[i]].centerXOffset = (i - (n - 1) / 2) * EDGE_SEP
    }
  }

  // ── Pass B: handleYOffset by table-pair sub-bundle ────────────────────────
  const pairGroups = new Map<string, Array<number>>() // key → indices into edges[]
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const a = edge.source
    const b = edge.target
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (!pairGroups.has(key)) pairGroups.set(key, [])
    pairGroups.get(key)!.push(i)
  }

  for (const indices of pairGroups.values()) {
    const n = indices.length
    if (n <= 1) continue // single edge for this table pair — offset stays 0
    // Sort by id for determinism
    indices.sort((a, b) => {
      const idA = edges[a].id ?? ''
      const idB = edges[b].id ?? ''
      return idA < idB ? -1 : idA > idB ? 1 : 0
    })
    for (let i = 0; i < n; i++) {
      result[indices[i]].handleYOffset = (i - (n - 1) / 2) * EDGE_SEP
    }
  }

  return result
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
    clusterRight = connected.reduce(
      (max, n) => Math.max(max, n.x + n.width / 2),
      -Infinity,
    )
    clusterTop = connected.reduce(
      (min, n) => Math.min(min, n.y - n.height / 2),
      Infinity,
    )
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
 * - Every pair of tables is guaranteed an L∞ gap ≥ 48 px.
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
  for (const e of edges) {
    connectedIds.add(e.source)
    connectedIds.add(e.target)
  }
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

  // Compute layer assignments once — reused for both placement and bundle offsets
  const layers = assignLayersBFS(connectedNodes, edges)

  // Derive column gap from actual edge labels and cardinality indicators,
  // then widen by the maximum bundle spread needed across all corridors so that
  // fanned vertical step segments fit without overlapping label pills.
  const labelColGap = computeRequiredColGap(edges)
  const bundleExtra = computeMaxCorridorBundleWidth(edges, layers)
  const effectiveColGap = labelColGap + bundleExtra

  // Layered placement for connected nodes (center coords)
  const connSimNodes = layeredPlacement(connectedNodes, effectiveColGap, layers)
  enforceGapPostPass(connSimNodes)

  // Isolated nodes below the cluster (center coords)
  const isoSimNodes: Array<SimNode> = isolatedNodes.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
    x: 0,
    y: 0,
  }))
  placeIsolatedNodes(isoSimNodes, connSimNodes)

  if (isoSimNodes.length > 0) {
    enforceGapPostPass([...connSimNodes, ...isoSimNodes])
  }

  // Push nodes away from estimated edge-label zones
  enforceEdgeLabelGap(connSimNodes, edges)
  if (isoSimNodes.length > 0) {
    enforceEdgeLabelGap([...connSimNodes, ...isoSimNodes], edges)
  }
  // Separate overlapping label pills (pairwise label-vs-label)
  enforceLabelLabelGap(connSimNodes, edges)
  // Final gap sweep to clean up any node-node overlaps introduced by label-gap expansion
  enforceGapPostPass([...connSimNodes, ...isoSimNodes])

  // Convert center → top-left for React Flow
  return [
    ...connSimNodes.map((n) => ({
      id: n.id,
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
    })),
    ...isoSimNodes.map((n) => ({
      id: n.id,
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
    })),
  ]
}

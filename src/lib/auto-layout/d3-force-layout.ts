// src/lib/auto-layout/d3-force-layout.ts
// Auto Layout engine for ER diagram tables.
//
// Strategy: hub-centred layered (Sugiyama-style) layout.
//   1. Split tables into connected components; isolated tables are 1-node blocks.
//   2. Per component, BFS layers from the hub; hub branches split left and right.
//   3. Port-aware barycenter sweeps reorder each column to cut crossings.
//   4. Isotonic regression aligns FK rows with the rows they reference.
//   5. Each column gap is sized from that corridor's labels and edge bundle.
//   6. Blocks are shelf-packed onto a ~16:10 canvas.
//   7. A post-pass guarantees every pair has >= 48 px L-infinity gap.
//
// Outputs top-left coordinates matching React Flow's node.position contract.
// Returns a Promise so the call-site API is unchanged.

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
  /**
   * Index of the FK column in the source table's `columns`. Positions the
   * edge's port for row alignment; omitted = table middle (e.g. references).
   */
  sourceRow?: number
  /** Index of the referenced column in the target table's `columns`. */
  targetRow?: number
}

export interface LayoutOutputPosition {
  id: string
  x: number
  y: number
}

/**
 * Per-edge bundle offset data returned alongside node positions.
 * Applied by RelationshipEdge.tsx to separate parallel/coincident edges.
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

export interface SimNode {
  id: string
  width: number
  height: number
  x: number
  y: number
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
// Edge-label pill sizing — derived from RelationshipEdge.tsx styles
// ---------------------------------------------------------------------------

/**
 * Font spec for edge labels (mirrors RelationshipEdge.tsx).
 * Used for canvas.measureText() to get accurate text width.
 */
const LABEL_FONT_SPEC = '500 11px sans-serif'

/** Font size for edge labels (px). Matches RelationshipEdge.tsx. */
const LABEL_FONT_SIZE_PX = 11

/**
 * Per-character advance estimate (px/char) — fallback when canvas is unavailable.
 * Derived from RelationshipEdge.tsx input width formula:
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
 * Pill horizontal structure (from RelationshipEdge.tsx):
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
 * Derived from RelationshipEdge.tsx: fontSize=11, line-height≈1.4,
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
// Cardinality indicator extent — mirrors RelationshipEdge.tsx constants
// ---------------------------------------------------------------------------

/**
 * Crow's foot convergence-point distance outward from the handle (px).
 * Mirrors CROW_LENGTH in RelationshipEdge.tsx.
 */
const CROW_LENGTH_EXTENT = 2

/**
 * Distance from multiplicity outer edge to optionality symbol center (px).
 * Mirrors OPT_GAP in RelationshipEdge.tsx.
 */
const OPT_GAP_EXTENT = 7

/**
 * Open circle radius for the optional symbol (px).
 * Mirrors CIRCLE_R in RelationshipEdge.tsx.
 */
const CARDINALITY_SYMBOL_RADIUS = 4

/**
 * How far a cardinality indicator extends outward from the handle into the
 * inter-node gap. Mirrors the indicatorExtent() function in RelationshipEdge.tsx.
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
 * Mirrors CARDINALITY_FLAGS in RelationshipEdge.tsx (only the 'many' booleans needed).
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
// Same-side label X clamping — render-time helper used by RelationshipEdge.tsx
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

/**
 * Minimum inter-column gap (px) — a visual floor only.
 * computeRequiredColGap() will raise this per layout run based on actual edge labels.
 * Set to cover cardinality indicators (13px×2) + breathing room (54px) = 80px.
 */
export const COL_GAP = 80

// ---------------------------------------------------------------------------
// Edge-bundle separation constants
// ---------------------------------------------------------------------------

/**
 * Inactive stroke width (px) of the main edge path.
 * Source of truth: RelationshipEdge.tsx — strokeWidth={isActive ? 2.5 : 1.5}
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
// Hub-centred layered layout
// ---------------------------------------------------------------------------

/** Minimum vertical gap between two tables stacked in one column (px). */
const LAYOUT_ROW_GAP = 64

/** Gap between packed blocks (connected groups and isolated tables) (px). */
const BLOCK_GAP = 120

/** Distance from a table's top edge to the first column row's top (px). */
const PORT_HEADER_HEIGHT = 34

/** Height of one column row (px). */
const PORT_ROW_HEIGHT = 28

/** Room reserved right of a column that carries same-column C-curves (px). */
const C_CURVE_ROOM = 48

/** Target width : height ratio of the packed canvas. */
const TARGET_ASPECT = 1.6

/** Barycenter sweeps used to reduce crossings. */
const ORDER_SWEEPS = 24

/** Alternating sweeps used to align ports vertically. */
const Y_SWEEPS = 12

/** Weight of the all-column pull relative to the sweep-side pull in the ordering barycenter. */
const ALL_COLUMN_WEIGHT = 0.5

/** Weight of a table with no neighbours in the y regression. */
const FREE_TABLE_WEIGHT = 0.25

export interface LayoutOptions {
  /**
   * Table to use as the hub of its connected component (centre column).
   * Ignored when the table is not in the component being laid out.
   */
  rootId?: string
}

interface Adjacency {
  other: string
  ownRow?: number
  otherRow?: number
}

interface Block {
  w: number
  h: number
  pos: Map<string, { x: number; y: number }>
}

/**
 * Weighted isotonic regression with spacing (pool-adjacent-violators).
 * Returns centres c_i that minimise Σ w_i (c_i − d_i)² subject to
 * c_{i+1} − c_i ≥ (h_i + h_{i+1}) / 2 + LAYOUT_ROW_GAP.
 */
function placeInOrder(
  heights: Array<number>,
  desired: Array<number>,
  weights: Array<number>,
): Array<number> {
  const n = heights.length
  const offset = [0]
  for (let i = 1; i < n; i++) {
    offset.push(
      offset[i - 1] + (heights[i - 1] + heights[i]) / 2 + LAYOUT_ROW_GAP,
    )
  }
  const pools: Array<{ v: number; w: number; n: number }> = []
  for (let i = 0; i < n; i++) {
    pools.push({ v: desired[i] - offset[i], w: weights[i], n: 1 })
    while (
      pools.length > 1 &&
      pools[pools.length - 2].v > pools[pools.length - 1].v
    ) {
      const b = pools.pop()!
      const a = pools.pop()!
      pools.push({
        v: (a.v * a.w + b.v * b.w) / (a.w + b.w),
        w: a.w + b.w,
        n: a.n + b.n,
      })
    }
  }
  const out: Array<number> = []
  for (const pool of pools) {
    for (let k = 0; k < pool.n; k++) out.push(pool.v + offset[out.length])
  }
  return out
}

/** Shelf-pack blocks (largest first) into rows of roughly TARGET_ASPECT. */
function packBlocks(blocks: Array<Block>): Array<LayoutOutputPosition> {
  const area = blocks.reduce(
    (sum, b) => sum + (b.w + BLOCK_GAP) * (b.h + BLOCK_GAP),
    0,
  )
  const rowWidth = Math.max(
    Math.max(...blocks.map((b) => b.w)),
    Math.sqrt(area * TARGET_ASPECT),
  )
  const result: Array<LayoutOutputPosition> = []
  let cx = 0
  let cy = 0
  let rowHeight = 0
  for (const b of blocks) {
    if (cx > 0 && cx + b.w > rowWidth) {
      cx = 0
      cy += rowHeight + BLOCK_GAP
      rowHeight = 0
    }
    for (const [id, p] of b.pos) result.push({ id, x: cx + p.x, y: cy + p.y })
    cx += b.w + BLOCK_GAP
    rowHeight = Math.max(rowHeight, b.h)
  }
  return result
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute a hub-centred, layered left-to-right layout for ER diagram tables.
 *
 * - Each connected component is layered by BFS distance from its hub; the hub's
 *   branches split left and right, so every edge spans at most one column.
 * - Columns are ordered by port-aware barycenter sweeps to cut crossings, and
 *   tables shift vertically so FK rows line up with the rows they reference.
 * - Each column gap is sized from that corridor's labels and edge bundle.
 * - Components and isolated tables are shelf-packed onto a ~16:10 canvas.
 * - Every pair of tables is guaranteed an L∞ gap ≥ 48 px, and the output is
 *   deterministic. Returns top-left coordinates (React Flow's contract).
 */
export async function computeD3ForceLayout(
  nodes: Array<LayoutInputNode>,
  rawEdges: Array<LayoutInputEdge>,
  options: LayoutOptions = {},
): Promise<Array<LayoutOutputPosition>> {
  if (nodes.length === 0) throw new Error('No nodes to layout')
  if (nodes.length === 1) return [{ id: nodes[0].id, x: 0, y: 0 }]

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = rawEdges.filter(
    (e) => e.source !== e.target && byId.has(e.source) && byId.has(e.target),
  )

  const adj = new Map<string, Array<Adjacency>>(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    adj.get(e.source)!.push({
      other: e.target,
      ownRow: e.sourceRow,
      otherRow: e.targetRow,
    })
    adj.get(e.target)!.push({
      other: e.source,
      ownRow: e.targetRow,
      otherRow: e.sourceRow,
    })
  }

  // Port offset from a table's top edge; an unknown row maps to the middle.
  const portOffset = (id: string, row?: number): number => {
    const height = byId.get(id)!.height
    return row === undefined
      ? height / 2
      : Math.min(
          PORT_HEADER_HEIGHT + row * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2,
          height,
        )
  }

  // ---- Components -----------------------------------------------------------
  const seen = new Set<string>()
  const components: Array<Array<string>> = []
  const isolated: Array<string> = []
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    if (adj.get(n.id)!.length === 0) {
      isolated.push(n.id)
      continue
    }
    const comp = [n.id]
    for (let head = 0; head < comp.length; head++) {
      for (const a of adj.get(comp[head])!) {
        if (seen.has(a.other)) continue
        seen.add(a.other)
        comp.push(a.other)
      }
    }
    components.push(comp)
  }

  const blocks: Array<Block> = components
    .map((ids) => layoutComponent(ids))
    .sort((a, b) => b.w * b.h - a.w * a.h)
  isolated
    .map((id) => byId.get(id)!)
    .sort((a, b) => b.height - a.height || a.id.localeCompare(b.id))
    .forEach((n) =>
      blocks.push({
        w: n.width,
        h: n.height,
        pos: new Map([[n.id, { x: 0, y: 0 }]]),
      }),
    )

  // Safety net only: the construction above never overlaps.
  const sim: Array<SimNode> = packBlocks(blocks).map((p) => {
    const n = byId.get(p.id)!
    return {
      id: p.id,
      width: n.width,
      height: n.height,
      x: p.x + n.width / 2,
      y: p.y + n.height / 2,
    }
  })
  enforceGapPostPass(sim)
  return sim.map((s) => ({
    id: s.id,
    x: Math.round(s.x - s.width / 2),
    y: Math.round(s.y - s.height / 2),
  }))

  // ---- Per-component layout -------------------------------------------------
  function layoutComponent(ids: Array<string>): Block {
    const degree = (id: string) => adj.get(id)!.length
    const neighbourDegree = (id: string) =>
      adj.get(id)!.reduce((sum, a) => sum + degree(a.other), 0)
    const root =
      options.rootId !== undefined && ids.includes(options.rootId)
        ? options.rootId
        : [...ids].sort(
            (a, b) =>
              degree(b) - degree(a) ||
              neighbourDegree(b) - neighbourDegree(a) ||
              a.localeCompare(b),
          )[0]

    // BFS distance from the root, and each table's branch (depth-1 ancestor).
    const dist = new Map([[root, 0]])
    const branch = new Map<string, string>()
    const bfs = [root]
    for (let head = 0; head < bfs.length; head++) {
      const u = bfs[head]
      for (const a of adj.get(u)!) {
        if (dist.has(a.other)) continue
        dist.set(a.other, dist.get(u)! + 1)
        branch.set(a.other, u === root ? a.other : branch.get(u)!)
        bfs.push(a.other)
      }
    }

    // Branches linked by a non-root edge must share a side (union-find).
    const parent = new Map<string, string>()
    const find = (start: string): string => {
      let x = start
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!)
        x = parent.get(x)!
      }
      return x
    }
    for (const b of new Set(branch.values())) parent.set(b, b)
    for (const e of edges) {
      if (e.source === root || e.target === root || !dist.has(e.source)) {
        continue
      }
      const a = find(branch.get(e.source)!)
      const b = find(branch.get(e.target)!)
      if (a !== b) parent.set(a, b)
    }

    // Branch groups go greedily to the lighter side (right first).
    const groupHeight = new Map<string, number>()
    for (const id of ids) {
      if (id === root) continue
      const g = find(branch.get(id)!)
      groupHeight.set(
        g,
        (groupHeight.get(g) ?? 0) + byId.get(id)!.height + LAYOUT_ROW_GAP,
      )
    }
    const side = new Map<string, number>()
    let rightWeight = 0
    let leftWeight = 0
    for (const [g, h] of [...groupHeight].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      if (rightWeight <= leftWeight) {
        side.set(g, 1)
        rightWeight += h
      } else {
        side.set(g, -1)
        leftWeight += h
      }
    }
    const layerOf = (id: string): number =>
      id === root ? 0 : side.get(find(branch.get(id)!))! * dist.get(id)!

    const layers = new Map<number, Array<string>>()
    for (const id of bfs) {
      const layer = layerOf(id)
      if (!layers.has(layer)) layers.set(layer, [])
      layers.get(layer)!.push(id)
    }
    const layerKeys = [...layers.keys()].sort((a, b) => a - b)

    // ---- Ordering: port-aware barycenter sweeps ----------------------------
    const top = new Map<string, number>()
    const stack = (layer: number) => {
      const col = layers.get(layer)!
      const total =
        col.reduce((sum, id) => sum + byId.get(id)!.height, 0) +
        LAYOUT_ROW_GAP * (col.length - 1)
      let y = -total / 2
      for (const id of col) {
        top.set(id, y)
        y += byId.get(id)!.height + LAYOUT_ROW_GAP
      }
    }
    layerKeys.forEach(stack)

    // Weighted mean of the y that would align this table's ports with its
    // neighbours. `fixed` limits it to those layers; null = every other column.
    const desiredCentre = (
      id: string,
      fixed: Set<number> | null,
    ): { y: number; w: number } | null => {
      let sum = 0
      let count = 0
      for (const a of adj.get(id)!) {
        const otherLayer = layerOf(a.other)
        if (fixed ? !fixed.has(otherLayer) : otherLayer === layerOf(id)) {
          continue
        }
        sum +=
          top.get(a.other)! +
          portOffset(a.other, a.otherRow) -
          portOffset(id, a.ownRow) +
          byId.get(id)!.height / 2
        count++
      }
      return count ? { y: sum / count, w: count } : null
    }

    const countCrossings = (): number => {
      let crossings = 0
      for (let i = 0; i + 1 < layerKeys.length; i++) {
        const segs: Array<[number, number]> = []
        for (const e of edges) {
          if (!dist.has(e.source)) continue
          const ls = layerOf(e.source)
          const lt = layerOf(e.target)
          if (
            Math.min(ls, lt) !== layerKeys[i] ||
            Math.max(ls, lt) !== layerKeys[i + 1]
          ) {
            continue
          }
          const [l, r] =
            ls < lt
              ? [
                  { id: e.source, row: e.sourceRow },
                  { id: e.target, row: e.targetRow },
                ]
              : [
                  { id: e.target, row: e.targetRow },
                  { id: e.source, row: e.sourceRow },
                ]
          segs.push([
            top.get(l.id)! + portOffset(l.id, l.row),
            top.get(r.id)! + portOffset(r.id, r.row),
          ])
        }
        for (let a = 0; a < segs.length; a++) {
          for (let b = a + 1; b < segs.length; b++) {
            if ((segs[a][0] - segs[b][0]) * (segs[a][1] - segs[b][1]) < 0) {
              crossings++
            }
          }
        }
      }
      return crossings
    }

    const snapshot = () =>
      new Map(layerKeys.map((l) => [l, [...layers.get(l)!]]))
    let best = snapshot()
    let bestCrossings = countCrossings()
    for (let s = 0; s < ORDER_SWEEPS && bestCrossings > 0; s++) {
      const forward = s % 2 === 0
      const sequence = forward
        ? layerKeys.slice(1)
        : layerKeys.slice(0, -1).reverse()
      for (const layer of sequence) {
        const fixed = new Set([forward ? layer - 1 : layer + 1])
        const col = layers.get(layer)!
        const key = new Map(
          col.map((id) => {
            const across = desiredCentre(id, fixed)
            const within = desiredCentre(id, null)
            const own = top.get(id)! + byId.get(id)!.height / 2
            // Neighbours in every other column pull in lightly on top of the sweep side.
            const y = across
              ? within
                ? (across.y * across.w +
                    within.y * ALL_COLUMN_WEIGHT * within.w) /
                  (across.w + ALL_COLUMN_WEIGHT * within.w)
                : across.y
              : (within?.y ?? own)
            return [id, y]
          }),
        )
        col.sort((a, b) => key.get(a)! - key.get(b)!)
        stack(layer)
      }
      const crossings = countCrossings()
      if (crossings < bestCrossings) {
        bestCrossings = crossings
        best = snapshot()
      }
    }
    for (const layer of layerKeys) {
      layers.set(layer, best.get(layer)!)
      stack(layer)
    }

    // ---- Y: align ports, keep order and gap (isotonic regression) ----------
    const allLayers = new Set(layerKeys)
    for (let s = 0; s < Y_SWEEPS; s++) {
      const sequence = [...layerKeys].sort((a, b) =>
        s % 2 ? Math.abs(b) - Math.abs(a) : Math.abs(a) - Math.abs(b),
      )
      for (const layer of sequence) {
        const col = layers.get(layer)!
        const others = new Set([...allLayers].filter((x) => x !== layer))
        const want = col.map(
          (id) =>
            desiredCentre(id, others) ?? {
              y: top.get(id)! + byId.get(id)!.height / 2,
              w: FREE_TABLE_WEIGHT,
            },
        )
        const centres = placeInOrder(
          col.map((id) => byId.get(id)!.height),
          want.map((x) => x.y),
          want.map((x) => x.w),
        )
        col.forEach((id, i) =>
          top.set(id, centres[i] - byId.get(id)!.height / 2),
        )
      }
    }

    // ---- X: per-corridor column gaps ---------------------------------------
    const colWidth = new Map(
      layerKeys.map((l) => [
        l,
        Math.max(...layers.get(l)!.map((id) => byId.get(id)!.width)),
      ]),
    )
    const hasIntra = new Set(
      edges
        .filter(
          (e) => dist.has(e.source) && layerOf(e.source) === layerOf(e.target),
        )
        .map((e) => layerOf(e.source)),
    )
    const xLeft = new Map<number, number>()
    let x = 0
    for (let i = 0; i < layerKeys.length; i++) {
      xLeft.set(layerKeys[i], x)
      if (i + 1 === layerKeys.length) break
      const corridor = edges.filter((e) => {
        if (!dist.has(e.source)) return false
        const a = layerOf(e.source)
        const b = layerOf(e.target)
        return (
          Math.min(a, b) === layerKeys[i] && Math.max(a, b) === layerKeys[i + 1]
        )
      })
      const gap =
        computeRequiredColGap(corridor) +
        Math.max(0, corridor.length - 1) * EDGE_SEP +
        (hasIntra.has(layerKeys[i]) ? C_CURVE_ROOM : 0)
      x += colWidth.get(layerKeys[i])! + gap
    }

    const pos = new Map<string, { x: number; y: number }>()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const layer of layerKeys) {
      for (const id of layers.get(layer)!) {
        const n = byId.get(id)!
        const slack = colWidth.get(layer)! - n.width
        // Right-flush when the column carries same-column C-curves (they route
        // along the right edge) or faces the hub from the left; centred on the hub.
        const px =
          xLeft.get(layer)! +
          (layer < 0 || hasIntra.has(layer)
            ? slack
            : layer === 0
              ? slack / 2
              : 0)
        const py = top.get(id)!
        pos.set(id, { x: px, y: py })
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(
          maxX,
          px + n.width + (hasIntra.has(layer) ? C_CURVE_ROOM : 0),
        )
        maxY = Math.max(maxY, py + n.height)
      }
    }
    for (const p of pos.values()) {
      p.x -= minX
      p.y -= minY
    }
    return { w: maxX - minX, h: maxY - minY, pos }
  }
}

// src/lib/auto-layout/d3-force-layout.test.ts
// Unit tests for computeD3ForceLayout — hub-centred layered engine

import { describe, expect, it } from 'vitest'
import {
  COL_GAP,
  EDGE_LABEL_MARGIN,
  EDGE_SEP,
  LABEL_PILL_CLAMP_MARGIN,
  assignLayersBFS,
  clampSameSideLabelX,
  computeD3ForceLayout,
  computeEdgeBundleOffsets,
  computeLabelPillWidth,
  computeMaxCorridorBundleWidth,
  computeRequiredColGap,
  enforceGapPostPass,
} from './d3-force-layout'
import type { LayoutInputEdge, LayoutInputNode } from './d3-force-layout'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, w = 200, h = 100): LayoutInputNode {
  return { id, width: w, height: h }
}

/**
 * Compute L∞ gap between two positioned rectangles (centre-based coords).
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
  const gapX = Math.max(ax - (bx + bw), bx - (ax + aw))
  const gapY = Math.max(ay - (by + bh), by - (ay + ah))
  return Math.max(gapX, gapY)
}

type PosMap = Map<string, { x: number; y: number }>

function posMap(results: Array<{ id: string; x: number; y: number }>): PosMap {
  return new Map(results.map((r) => [r.id, { x: r.x, y: r.y }]))
}

/**
 * Assert L∞ gap ≥ 16 for every pair in results given node dimensions.
 */
function assertAllGaps(
  results: Array<{ id: string; x: number; y: number }>,
  nodes: Array<LayoutInputNode>,
  minGap = 16,
) {
  const dimMap = new Map(nodes.map((n) => [n.id, n]))
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i]
      const b = results[j]
      const aDim = dimMap.get(a.id)!
      const bDim = dimMap.get(b.id)!
      // Output is top-left coordinates — no half-dimension offset needed
      const ax = a.x
      const ay = a.y
      const bx = b.x
      const by = b.y
      const gap = l8Gap(
        ax,
        ay,
        aDim.width,
        aDim.height,
        bx,
        by,
        bDim.width,
        bDim.height,
      )
      expect(
        gap,
        `Pair (${a.id}, ${b.id}) gap ${gap.toFixed(2)} < ${minGap}`,
      ).toBeGreaterThanOrEqual(minGap)
    }
  }
}

// ---------------------------------------------------------------------------
// TC-AL-E-01 — Zero tables: rejects with "No nodes to layout"
// ---------------------------------------------------------------------------

describe('computeD3ForceLayout', () => {
  it('TC-AL-E-01: rejects with error when called with 0 nodes', async () => {
    await expect(computeD3ForceLayout([], [])).rejects.toThrow(
      'No nodes to layout',
    )
  })

  // TC-AL-E-02 — Single table
  it('TC-AL-E-02: single table resolves with a position entry', async () => {
    const nodes: Array<LayoutInputNode> = [makeNode('A')]
    const result = await computeD3ForceLayout(nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('A')
    expect(Number.isFinite(result[0].x)).toBe(true)
    expect(Number.isFinite(result[0].y)).toBe(true)
  })

  // TC-AL-E-03 — Two tables, no FK edges: gap ≥ 16 px
  it('TC-AL-E-03: two tables with no FK edges satisfy L∞ gap ≥ 16 px', async () => {
    const nodes: Array<LayoutInputNode> = [
      makeNode('A', 200, 100),
      makeNode('B', 200, 100),
    ]
    const result = await computeD3ForceLayout(nodes, [])
    assertAllGaps(result, nodes)
  })

  // TC-AL-E-04 — the hub sits in the centre column between its branches
  it('TC-AL-E-04: hub with 2 unlinked branches is centred between the leftmost and rightmost tables', async () => {
    // Chain: T0 -> T1 -> T2. T1 has degree 2 (highest) -> root. T0 and T2 are
    // unlinked branches, so they split to opposite sides of the hub.
    const nodes: Array<LayoutInputNode> = [
      makeNode('T0', 200, 100),
      makeNode('T1', 200, 100),
      makeNode('T2', 200, 100),
    ]
    const edges: Array<LayoutInputEdge> = [
      { source: 'T0', target: 'T1' },
      { source: 'T1', target: 'T2' },
    ]
    const result = await computeD3ForceLayout(nodes, edges)
    const pm = posMap(result)
    const centres = nodes.map((n) => pm.get(n.id)!.x + n.width / 2)
    const hub = pm.get('T1')!.x + 100
    expect(hub).toBeGreaterThan(Math.min(...centres))
    expect(hub).toBeLessThan(Math.max(...centres))
  })

  // TC-AL-E-05 — Gap holds on every pair in a 10-table fixture (3 runs)
  it('TC-AL-E-05: 16 px L∞ gap holds on every pair across 3 consecutive runs', async () => {
    const nodes: Array<LayoutInputNode> = Array.from({ length: 10 }, (_, i) =>
      makeNode(`N${i}`, 200, 100),
    )
    const edges: Array<LayoutInputEdge> = [
      { source: 'N0', target: 'N1' },
      { source: 'N1', target: 'N2' },
      { source: 'N3', target: 'N4' },
      { source: 'N5', target: 'N6' },
    ]

    for (let run = 0; run < 3; run++) {
      const result = await computeD3ForceLayout(nodes, edges)
      assertAllGaps(result, nodes)
    }
  })

  // TC-AL-E-06 — Isolated tables still satisfy gap contract
  it('TC-AL-E-06: isolated tables (no FK) still satisfy L∞ gap ≥ 16 px', async () => {
    const nodes: Array<LayoutInputNode> = [
      makeNode('A', 200, 100),
      makeNode('B', 200, 100),
      makeNode('C', 200, 100), // isolated
      makeNode('D', 200, 100), // isolated
      makeNode('E', 200, 100), // isolated
    ]
    const edges: Array<LayoutInputEdge> = [{ source: 'A', target: 'B' }]
    const result = await computeD3ForceLayout(nodes, edges)
    assertAllGaps(result, nodes)
  })

  // TC-AL-E-07 — Circular FK references satisfy gap contract
  it('TC-AL-E-07: circular FK (A→B→C→A) satisfies L∞ gap ≥ 16 px for all pairs', async () => {
    const nodes: Array<LayoutInputNode> = [
      makeNode('A', 200, 100),
      makeNode('B', 200, 100),
      makeNode('C', 200, 100),
    ]
    const edges: Array<LayoutInputEdge> = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'A' },
    ]
    const result = await computeD3ForceLayout(nodes, edges)
    assertAllGaps(result, nodes)
  })

  // TC-AL-E-08 — Single table, 0 FK: resolves without crash (gap assertion skipped)
  it('TC-AL-E-08: single node with 0 edges resolves without throwing', async () => {
    await expect(
      computeD3ForceLayout([makeNode('X')], []),
    ).resolves.toBeDefined()
  })

  // TC-AL-E-09 — Fully-connected schema: gap contract still asserted
  it('TC-AL-E-09: fully-connected schema (every pair FK) satisfies gap contract', async () => {
    const nodes: Array<LayoutInputNode> = Array.from({ length: 4 }, (_, i) =>
      makeNode(`F${i}`, 200, 100),
    )
    const edges: Array<LayoutInputEdge> = [
      { source: 'F0', target: 'F1' },
      { source: 'F0', target: 'F2' },
      { source: 'F0', target: 'F3' },
      { source: 'F1', target: 'F2' },
      { source: 'F1', target: 'F3' },
      { source: 'F2', target: 'F3' },
    ]
    const result = await computeD3ForceLayout(nodes, edges)
    assertAllGaps(result, nodes)
  })

  // TC-AL-E-12 — Dynamic col gap leaves room for the actual label pill
  it('TC-AL-E-12: dynamic column gap leaves room for a 30-char label pill between adjacent columns', async () => {
    // 30-char label: computeLabelPillWidth = max(60, 30×7) + 22 = 210 + 22 = 232px (jsdom fallback)
    // Required gap = srcExt(11) + margin(16) + 232 + margin(16) + tgtExt(11) = 286px
    // Old fixed COL_GAP=200 would give horizGap=200px — FAILS at 264px assertion.
    // New code: computeRequiredColGap raises gap to 286px — PASSES.
    const label = 'a'.repeat(30)
    const nodes: Array<LayoutInputNode> = [
      makeNode('A', 250, 200),
      makeNode('B', 250, 200),
    ]
    const edges: Array<LayoutInputEdge> = [{ source: 'A', target: 'B', label }]
    const result = await computeD3ForceLayout(nodes, edges)
    const pm = posMap(result)
    const aRight = pm.get('A')!.x + 250
    const bLeft = pm.get('B')!.x
    const horizGap = bLeft - aRight
    const pillWidth = computeLabelPillWidth(label)
    const minRequired = pillWidth + 2 * EDGE_LABEL_MARGIN
    expect(
      horizGap,
      `Horizontal gap ${horizGap.toFixed(2)} < required ${minRequired} (pillWidth=${pillWidth}, COL_GAP floor=${COL_GAP})`,
    ).toBeGreaterThanOrEqual(minRequired)
  })

  // TC-AL-E-15 — All-pairs gap ≥ MIN_GAP=48 still holds after enforceEdgeLabelGap
  it('TC-AL-E-15: 48 px L∞ gap holds on every pair for the full pipeline with 10 nodes and 5 edges', async () => {
    const nodes: Array<LayoutInputNode> = Array.from({ length: 10 }, (_, i) =>
      makeNode(`M${i}`, 250, 150),
    )
    const edges: Array<LayoutInputEdge> = [
      { source: 'M0', target: 'M1' },
      { source: 'M1', target: 'M2' },
      { source: 'M3', target: 'M4' },
      { source: 'M5', target: 'M6' },
      { source: 'M7', target: 'M8' },
    ]
    const result = await computeD3ForceLayout(nodes, edges)
    assertAllGaps(result, nodes, 48)
  })

  // TC-AL-E-16 — Long label (50+ chars) that would fail under a 120px fixed-constant assumption
  it('TC-AL-E-16: 50-char label gets full dynamic gap — fails under fixed EDGE_LABEL_W=120', async () => {
    // 50-char label: computeLabelPillWidth = max(60, 50×7) + 22 = 350 + 22 = 372px (jsdom fallback)
    // Required: 11 + 16 + 372 + 16 + 11 = 426px (ONE_TO_MANY: srcMany=false, tgtMany=true → 13px)
    // Under old approach: COL_GAP=200, EDGE_LABEL_W=120 → zone only 152px wide → FAIL at 404px.
    // Under new approach: effectiveColGap = 426px → gap ≥ 404px → PASS.
    const label = 'a'.repeat(50)
    const nodes: Array<LayoutInputNode> = [
      makeNode('X', 250, 200),
      makeNode('Y', 250, 200),
    ]
    const edges: Array<LayoutInputEdge> = [
      { source: 'X', target: 'Y', label, cardinality: 'ONE_TO_MANY' },
    ]
    const result = await computeD3ForceLayout(nodes, edges)
    const pm = posMap(result)
    const xRight = pm.get('X')!.x + 250
    const yLeft = pm.get('Y')!.x
    const horizGap = yLeft - xRight
    const pillWidth = computeLabelPillWidth(label)
    const minRequired = pillWidth + 2 * EDGE_LABEL_MARGIN // 372 + 32 = 404px
    expect(
      horizGap,
      `Horizontal gap ${horizGap.toFixed(2)} < required ${minRequired}; old fixed 120px constant would only give ~200px gap`,
    ).toBeGreaterThanOrEqual(minRequired)
  })

  // TC-AL-E-17 — computeRequiredColGap scales with label content
  it('TC-AL-E-17: computeRequiredColGap scales with label length, not a fixed constant', () => {
    // Short label (5 chars): min(60, ...) → pill = max(60, 35)+22 = 82px → required = 82+32+22 = 136
    const shortEdges: Array<LayoutInputEdge> = [
      { source: 'A', target: 'B', label: 'hello' },
    ]
    // Long label (40 chars): pill = max(60, 280)+22 = 302px → required = 302+32+22 = 356
    const longEdges: Array<LayoutInputEdge> = [
      { source: 'A', target: 'B', label: 'a'.repeat(40) },
    ]
    const shortGap = computeRequiredColGap(shortEdges)
    const longGap = computeRequiredColGap(longEdges)
    // Long label must demand a larger column gap than short label
    expect(longGap).toBeGreaterThan(shortGap)
    // Short label pill is ≤ 120px (old constant) but gap is still based on real content
    expect(computeLabelPillWidth('hello')).toBeLessThanOrEqual(120)
    // Long label pill exceeds 120px — proves the fix is necessary
    expect(computeLabelPillWidth('a'.repeat(40))).toBeGreaterThan(120)
    // Long gap must cover full pill
    expect(longGap).toBeGreaterThanOrEqual(
      computeLabelPillWidth('a'.repeat(40)) + 2 * EDGE_LABEL_MARGIN,
    )
  })
})

// ---------------------------------------------------------------------------
// clampSameSideLabelX unit tests
// ---------------------------------------------------------------------------

describe('clampSameSideLabelX', () => {
  // TC-AL-E-19 — pushes pill right of source/target handles on right→right routing
  it('TC-AL-E-19: clears pill from both handles on right→right routing', () => {
    // Simulates a long FK label exiting right side of a 200px-wide table at x=0
    // (handle is at sourceX = targetX = 200).
    // getSmoothStepPath midpoint is ~210px — pill extends back leftward into the table.
    const label = 'FK_EmSigEvalCategoryScoreMapping' // 32 chars → pill = max(60,224)+22 = 246px
    const pillW = computeLabelPillWidth(label)
    const sourceX = 200
    const targetX = 200
    const rawLabelX = 210 // path midpoint barely past the right edge

    // Without clamping: pill left edge = 210 - pillW/2 → inside the table
    expect(rawLabelX - pillW / 2).toBeLessThan(sourceX)

    const clamped = clampSameSideLabelX(
      rawLabelX,
      pillW,
      sourceX,
      'right',
      targetX,
      'right',
    )

    // After clamping: pill left edge must clear the rightmost handle + margin
    const minLabelX =
      Math.max(sourceX, targetX) + pillW / 2 + LABEL_PILL_CLAMP_MARGIN
    expect(clamped).toBeGreaterThanOrEqual(minLabelX)

    // Pill left edge clears source table body
    expect(clamped - pillW / 2).toBeGreaterThanOrEqual(
      sourceX + LABEL_PILL_CLAMP_MARGIN - 1,
    )
  })

  // TC-AL-E-20 — is a no-op for cross-column right→left routing
  it('TC-AL-E-20: is a no-op for cross-column right→left routing', () => {
    const label = 'a'.repeat(50)
    const pillW = computeLabelPillWidth(label)
    const labelX = 500 // midpoint in the gap between tables
    const clamped = clampSameSideLabelX(
      labelX,
      pillW,
      200,
      'right',
      800,
      'left',
    )
    expect(clamped).toBe(labelX)
  })
})

// ---------------------------------------------------------------------------
// Edge bundle offset tests — TC-AL-E-21 through TC-AL-E-25
// ---------------------------------------------------------------------------

describe('computeEdgeBundleOffsets', () => {
  // TC-AL-E-21 — single edge gets zero offsets
  it('TC-AL-E-21: single edge in a corridor → both offsets are 0', () => {
    const nodes = [makeNode('A'), makeNode('B')]
    const edges: Array<LayoutInputEdge> = [
      { id: 'e1', source: 'A', target: 'B' },
    ]
    const layers = assignLayersBFS(nodes, edges)
    const result = computeEdgeBundleOffsets(edges, layers)
    expect(result).toHaveLength(1)
    expect(result[0].handleYOffset).toBe(0)
    expect(result[0].centerXOffset).toBe(0)
  })

  // TC-AL-E-22 — 2 edges between same table pair get symmetric offsets
  it('TC-AL-E-22: 2 edges same table pair → centerXOffset and handleYOffset are symmetric', () => {
    const nodes = [makeNode('A'), makeNode('B')]
    const edges: Array<LayoutInputEdge> = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'A', target: 'B' },
    ]
    const layers = assignLayersBFS(nodes, edges)
    const result = computeEdgeBundleOffsets(edges, layers)
    expect(result).toHaveLength(2)
    const xOffsets = result.map((r) => r.centerXOffset).sort((a, b) => a - b)
    expect(xOffsets[0]).toBeCloseTo(-EDGE_SEP / 2)
    expect(xOffsets[1]).toBeCloseTo(+EDGE_SEP / 2)
    expect(xOffsets[0] + xOffsets[1]).toBeCloseTo(0)
    const yOffsets = result.map((r) => r.handleYOffset).sort((a, b) => a - b)
    expect(yOffsets[0]).toBeCloseTo(-EDGE_SEP / 2)
    expect(yOffsets[1]).toBeCloseTo(+EDGE_SEP / 2)
  })

  // TC-AL-E-23 — 3 edges in the same column corridor, all different table pairs
  //   Hub has degree 3 → BFS root → col 0; A, B, C each degree 1 → col 1.
  //   All 3 edges cross corridor (0,1). No same-table-pair sub-bundle size > 1,
  //   so handleYOffset is 0 for all; centerXOffset spreads ±EDGE_SEP.
  it('TC-AL-E-23: 3 edges same column corridor, different table pairs → centerXOffset spread ±EDGE_SEP, handleYOffset all 0', () => {
    const nodes = [makeNode('Hub'), makeNode('A'), makeNode('B'), makeNode('C')]
    const edges: Array<LayoutInputEdge> = [
      { id: 'e1', source: 'A', target: 'Hub' },
      { id: 'e2', source: 'B', target: 'Hub' },
      { id: 'e3', source: 'C', target: 'Hub' },
    ]
    // Hub has degree 3 (highest) → col 0; A, B, C each have degree 1 → col 1.
    // All 3 edges cross corridor (0,1).
    const layers = assignLayersBFS(nodes, edges)
    const result = computeEdgeBundleOffsets(edges, layers)
    expect(result).toHaveLength(3)
    const xOffsets = result.map((r) => r.centerXOffset).sort((a, b) => a - b)
    expect(xOffsets[0]).toBeCloseTo(-EDGE_SEP)
    expect(xOffsets[1]).toBeCloseTo(0)
    expect(xOffsets[2]).toBeCloseTo(+EDGE_SEP)
    // No same-table-pair bundle of size > 1: all handleYOffset = 0
    result.forEach((r) => expect(r.handleYOffset).toBeCloseTo(0))
  })
})

describe('computeMaxCorridorBundleWidth', () => {
  // TC-AL-E-24 — N edges in one corridor → (N-1) × EDGE_SEP
  it('TC-AL-E-24: computeMaxCorridorBundleWidth → (N-1)×EDGE_SEP for N edges in one corridor', () => {
    const nodes = [makeNode('A'), makeNode('B')]
    const edges: Array<LayoutInputEdge> = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'A', target: 'B' },
      { id: 'e3', source: 'A', target: 'B' },
    ]
    const layers = assignLayersBFS(nodes, edges)
    const extra = computeMaxCorridorBundleWidth(edges, layers)
    expect(extra).toBeCloseTo(2 * EDGE_SEP) // (3-1) × EDGE_SEP
  })
})

describe('computeD3ForceLayout — bundle colGap growth', () => {
  // TC-AL-E-25 — 3 parallel edges between same table pair grow colGap by 2×EDGE_SEP
  it('TC-AL-E-25: 3 edges between same table pair grow colGap by 2×EDGE_SEP', async () => {
    const nodes = [makeNode('A', 250, 200), makeNode('B', 250, 200)]
    const edges: Array<LayoutInputEdge> = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'A', target: 'B' },
      { id: 'e3', source: 'A', target: 'B' },
    ]
    const result = await computeD3ForceLayout(nodes, edges)
    const pm = posMap(result)
    const aRight = pm.get('A')!.x + 250
    const bLeft = pm.get('B')!.x
    const horizGap = bLeft - aRight
    // 3 edges → bundle extra = 2×EDGE_SEP; base = computeRequiredColGap (unlabelled = COL_GAP floor)
    const minExpected = computeRequiredColGap(edges) + 2 * EDGE_SEP
    expect(
      horizGap,
      `colGap ${horizGap.toFixed(2)} < base+bundle_extra ${minExpected.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(minExpected)
  })
})

// ---------------------------------------------------------------------------
// enforceGapPostPass unit tests
// ---------------------------------------------------------------------------

describe('enforceGapPostPass', () => {
  it('spreads two overlapping nodes to ≥ 16 px gap', () => {
    const nodes = [
      { id: 'A', x: 0, y: 0, width: 200, height: 100, vx: 0, vy: 0 },
      { id: 'B', x: 50, y: 0, width: 200, height: 100, vx: 0, vy: 0 },
    ]
    enforceGapPostPass(nodes as any)

    const ax = nodes[0].x - nodes[0].width / 2
    const bx = nodes[1].x - nodes[1].width / 2
    const gapX = Math.max(
      ax - (bx + nodes[1].width),
      bx - (ax + nodes[0].width),
    )
    const ay = nodes[0].y - nodes[0].height / 2
    const by = nodes[1].y - nodes[1].height / 2
    const gapY = Math.max(
      ay - (by + nodes[1].height),
      by - (ay + nodes[0].height),
    )
    const gap = Math.max(gapX, gapY)

    expect(gap).toBeGreaterThanOrEqual(16)
  })

  it('does not move nodes that already satisfy the gap', () => {
    const nodes = [
      { id: 'A', x: 0, y: 0, width: 200, height: 100, vx: 0, vy: 0 },
      { id: 'B', x: 500, y: 0, width: 200, height: 100, vx: 0, vy: 0 },
    ]
    const xBefore = nodes[0].x
    enforceGapPostPass(nodes as any)
    expect(nodes[0].x).toBe(xBefore)
  })
})

// ---------------------------------------------------------------------------
// Quality fixtures (ported from the layout benchmark) and quality tests
// ---------------------------------------------------------------------------

interface FixtureNode extends LayoutInputNode {
  cols: number
}
interface FixtureEdge extends LayoutInputEdge {
  id: string
  sourceRow: number
  targetRow: number
}
interface Fixture {
  name: string
  nodes: Array<FixtureNode>
  edges: Array<FixtureEdge>
}

function rng(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIXTURE_LABELS = [
  'places',
  'belongs to',
  'has many line items',
  'owns',
  'references parent',
  'billed via',
  'ships from warehouse',
]

function buildFixture(
  name: string,
  spec: Record<string, number>,
  rels: Array<[string, string]>,
  seed: number,
): Fixture {
  const r = rng(seed)
  const nodes: Array<FixtureNode> = Object.entries(spec).map(([id, cols]) => ({
    id,
    cols,
    width: 200 + Math.floor(r() * 80),
    height: 40 + cols * 28 + 12,
  }))
  const cols = new Map(nodes.map((n) => [n.id, n.cols]))
  const fkNext = new Map<string, number>()
  const edges: Array<FixtureEdge> = rels.map(([source, target], i) => {
    const row = Math.min(cols.get(source)! - 1, fkNext.get(source) ?? 1)
    fkNext.set(source, row + 1)
    return {
      id: `e${String(i).padStart(3, '0')}`,
      source,
      target,
      sourceRow: row,
      targetRow: 0,
      label:
        r() < 0.4
          ? FIXTURE_LABELS[Math.floor(r() * FIXTURE_LABELS.length)]
          : undefined,
      cardinality: 'MANY_TO_ONE',
    }
  })
  // Shuffle to mimic random creation order.
  for (let i = nodes.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
  }
  return { name, nodes, edges }
}

function snowflakeFixture(): Fixture {
  const dims = [
    'dim_date',
    'dim_time',
    'dim_product',
    'dim_store',
    'dim_customer',
    'dim_promo',
    'dim_channel',
    'dim_currency',
    'dim_employee',
    'dim_payment',
    'dim_ship_mode',
    'dim_weather',
    'dim_campaign',
    'dim_device',
  ]
  const spec: Record<string, number> = { fact_sales: 20 }
  for (const d of dims) spec[d] = 6
  Object.assign(spec, {
    dim_brand: 4,
    dim_category: 4,
    dim_department: 3,
    dim_region: 4,
    dim_country: 3,
    dim_segment: 3,
    fact_returns: 9,
  })
  const rels: Array<[string, string]> = dims.map(
    (d) => ['fact_sales', d] as [string, string],
  )
  rels.push(
    ['dim_product', 'dim_brand'],
    ['dim_product', 'dim_category'],
    ['dim_category', 'dim_department'],
    ['dim_store', 'dim_region'],
    ['dim_region', 'dim_country'],
    ['dim_customer', 'dim_segment'],
    ['fact_returns', 'dim_product'],
    ['fact_returns', 'dim_date'],
    ['fact_returns', 'dim_store'],
    ['fact_returns', 'dim_customer'],
  )
  return buildFixture('snowflake', spec, rels, 2)
}

function ecommerceFixture(): Fixture {
  const spec = {
    users: 8,
    addresses: 9,
    orders: 10,
    order_items: 6,
    products: 12,
    categories: 5,
    product_categories: 3,
    reviews: 7,
    carts: 4,
    cart_items: 5,
    payments: 8,
    shipments: 9,
    inventory: 5,
    warehouses: 6,
    suppliers: 7,
    coupons: 6,
    order_coupons: 3,
    wishlists: 4,
    wishlist_items: 4,
    product_images: 5,
    refunds: 6,
    audit_log: 8,
    settings: 4,
    sessions: 5,
    roles: 3,
    user_roles: 3,
  }
  const rels: Array<[string, string]> = [
    ['addresses', 'users'],
    ['orders', 'users'],
    ['orders', 'addresses'],
    ['order_items', 'orders'],
    ['order_items', 'products'],
    ['products', 'categories'],
    ['products', 'suppliers'],
    ['product_categories', 'products'],
    ['product_categories', 'categories'],
    ['reviews', 'products'],
    ['reviews', 'users'],
    ['carts', 'users'],
    ['cart_items', 'carts'],
    ['cart_items', 'products'],
    ['payments', 'orders'],
    ['shipments', 'orders'],
    ['shipments', 'warehouses'],
    ['inventory', 'products'],
    ['inventory', 'warehouses'],
    ['order_coupons', 'orders'],
    ['order_coupons', 'coupons'],
    ['wishlists', 'users'],
    ['wishlist_items', 'wishlists'],
    ['wishlist_items', 'products'],
    ['product_images', 'products'],
    ['refunds', 'payments'],
    ['refunds', 'orders'],
    ['sessions', 'users'],
    ['user_roles', 'users'],
    ['user_roles', 'roles'],
  ]
  return buildFixture('ecommerce', spec, rels, 1)
}

function multiComponentFixture(): Fixture {
  const r = rng(3)
  const spec: Record<string, number> = {}
  const rels: Array<[string, string]> = []
  for (let c = 0; c < 6; c++) {
    const size = 3 + Math.floor(r() * 6)
    for (let i = 0; i < size; i++) {
      spec[`c${c}_t${i}`] = 3 + Math.floor(r() * 10)
      if (i > 0) rels.push([`c${c}_t${i}`, `c${c}_t${Math.floor(r() * i)}`])
    }
    if (size > 4) rels.push([`c${c}_t${size - 1}`, `c${c}_t1`])
  }
  for (let i = 0; i < 14; i++) spec[`iso_${i}`] = 2 + Math.floor(r() * 12)
  return buildFixture('6 components + 14 isolated', spec, rels, 3)
}

/** Random sparse graph for the performance test. */
function randomFixture(tables: number, relationships: number): Fixture {
  const r = rng(7)
  const spec: Record<string, number> = {}
  for (let i = 0; i < tables; i++) spec[`t${i}`] = 3 + Math.floor(r() * 12)
  const rels: Array<[string, string]> = []
  for (let i = 1; i < tables && rels.length < relationships; i++) {
    rels.push([`t${i}`, `t${Math.floor(r() * i)}`])
  }
  while (rels.length < relationships) {
    const a = Math.floor(r() * tables)
    const b = Math.floor(r() * tables)
    if (a !== b) rels.push([`t${a}`, `t${b}`])
  }
  return buildFixture(`random ${tables}t/${relationships}r`, spec, rels, 8)
}

type Seg = [number, number, number, number]

/**
 * Count proper crossings between the orthogonal 3-segment routes the renderer
 * draws: horizontal out of the source port, vertical in the corridor middle,
 * horizontal into the target port. Same-column edges use a C-curve.
 */
function countRouteCrossings(
  fixture: Fixture,
  positions: Array<{ id: string; x: number; y: number }>,
): number {
  const at = new Map(positions.map((p) => [p.id, p]))
  const box = new Map(
    fixture.nodes.map((n) => {
      const p = at.get(n.id)!
      return [n.id, { x: p.x, y: p.y, w: n.width }]
    }),
  )
  const routes: Array<Array<Seg>> = []
  for (const e of fixture.edges) {
    const s = box.get(e.source)!
    const t = box.get(e.target)!
    const sy = s.y + 40 + e.sourceRow * 28 + 14
    const ty = t.y + 40 + e.targetRow * 28 + 14
    let pts: Array<[number, number]>
    if (t.x > s.x + s.w + 20) {
      const sx = s.x + s.w
      const mx = (sx + t.x) / 2
      pts = [
        [sx, sy],
        [mx, sy],
        [mx, ty],
        [t.x, ty],
      ]
    } else if (s.x > t.x + t.w + 20) {
      const tx = t.x + t.w
      const mx = (s.x + tx) / 2
      pts = [
        [s.x, sy],
        [mx, sy],
        [mx, ty],
        [tx, ty],
      ]
    } else {
      const sx = s.x + s.w
      const tx = t.x + t.w
      const cx = Math.max(sx, tx) + 24
      pts = [
        [sx, sy],
        [cx, sy],
        [cx, ty],
        [tx, ty],
      ]
    }
    routes.push(
      [0, 1, 2].map(
        (i) => [pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]] as Seg,
      ),
    )
  }
  const cross = (a: Seg, b: Seg): boolean => {
    const aHorizontal = a[1] === a[3]
    if (aHorizontal === (b[1] === b[3])) return false
    const [h, v] = aHorizontal ? [a, b] : [b, a]
    return (
      v[0] > Math.min(h[0], h[2]) + 0.5 &&
      v[0] < Math.max(h[0], h[2]) - 0.5 &&
      h[1] > Math.min(v[1], v[3]) + 0.5 &&
      h[1] < Math.max(v[1], v[3]) - 0.5
    )
  }
  let crossings = 0
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      for (const a of routes[i]) {
        for (const b of routes[j]) if (cross(a, b)) crossings++
      }
    }
  }
  return crossings
}

describe('computeD3ForceLayout — layout quality', () => {
  const cases: Array<[Fixture, number]> = [
    [snowflakeFixture(), 5],
    [ecommerceFixture(), 16],
    [multiComponentFixture(), 4],
  ]

  it.each(cases)(
    '$0.name: no overlaps, 48 px gaps, crossings within budget, deterministic',
    async (fixture, maxCrossings) => {
      const first = await computeD3ForceLayout(fixture.nodes, fixture.edges)
      expect(first).toHaveLength(fixture.nodes.length)
      // assertAllGaps at 48 also proves 0 node overlaps
      assertAllGaps(first, fixture.nodes, 48)
      expect(countRouteCrossings(fixture, first)).toBeLessThanOrEqual(
        maxCrossings,
      )
      const second = await computeD3ForceLayout(fixture.nodes, fixture.edges)
      expect(second).toEqual(first)
    },
  )

  it('rootId puts the given hub in the centre column', async () => {
    const fixture = snowflakeFixture()
    const widthOf = new Map(fixture.nodes.map((n) => [n.id, n.width]))
    for (const rootId of ['dim_product', 'fact_sales']) {
      const result = await computeD3ForceLayout(fixture.nodes, fixture.edges, {
        rootId,
      })
      const pm = posMap(result)
      const centres = result.map((p) => p.x + widthOf.get(p.id)! / 2)
      const root = pm.get(rootId)!.x + widthOf.get(rootId)! / 2
      expect(root).toBeGreaterThan(Math.min(...centres))
      expect(root).toBeLessThan(Math.max(...centres))
    }
  })

  it('ignores a rootId that is not in the graph', async () => {
    const fixture = ecommerceFixture()
    const without = await computeD3ForceLayout(fixture.nodes, fixture.edges)
    const bogus = await computeD3ForceLayout(fixture.nodes, fixture.edges, {
      rootId: 'no-such-table',
    })
    expect(bogus).toEqual(without)
  })

  it('drops self-loops and edges to unknown tables', async () => {
    const nodes = [makeNode('A'), makeNode('B')]
    const result = await computeD3ForceLayout(nodes, [
      { source: 'A', target: 'A' },
      { source: 'A', target: 'ghost' },
      { source: 'A', target: 'B' },
    ])
    expect(result).toHaveLength(2)
    assertAllGaps(result, nodes, 48)
  })

  it('lays out 300 tables and 400 edges in under 250 ms', async () => {
    const fixture = randomFixture(300, 400)
    const start = performance.now()
    const result = await computeD3ForceLayout(fixture.nodes, fixture.edges)
    const elapsed = performance.now() - start
    expect(result).toHaveLength(300)
    expect(elapsed).toBeLessThan(250)
  })
})

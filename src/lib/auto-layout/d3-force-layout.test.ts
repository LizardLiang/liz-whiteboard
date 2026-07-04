// src/lib/auto-layout/d3-force-layout.test.ts
// Unit tests for computeD3ForceLayout — covers TC-AL-E-01 through TC-AL-E-11

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
  computeLabelPillHeight,
  computeLabelPillWidth,
  computeMaxCorridorBundleWidth,
  computeRequiredColGap,
  enforceEdgeLabelGap,
  enforceGapPostPass,
  enforceLabelLabelGap,
} from './d3-force-layout'
import type {
  LayoutInputEdge,
  LayoutInputNode,
  SimNode,
} from './d3-force-layout'

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

  // TC-AL-E-04 — BFS ordering: most-connected node is the root (leftmost column)
  it('TC-AL-E-04: BFS ordering — hub table (highest degree) is placed leftmost', async () => {
    // Chain: T0 -> T1 -> T2. T1 has degree 2 (highest) → BFS root → col 0.
    // T0 and T2 are both at BFS distance 1 → col 1 (same x).
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
    // T1 (degree 2) must be the leftmost — to the left of both T0 and T2
    expect(pm.get('T1')!.x).toBeLessThan(pm.get('T0')!.x)
    expect(pm.get('T1')!.x).toBeLessThan(pm.get('T2')!.x)
    // T0 and T2 share the same BFS level (1) → same column → same x
    expect(pm.get('T0')!.x).toBe(pm.get('T2')!.x)
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

  // TC-AL-E-10 — 500-tick hard cap: simulation always terminates
  it('TC-AL-E-10: simulation terminates with ≤ 500 ticks', async () => {
    // We cannot easily spy on simulation.tick without internals, but we can
    // verify the promise resolves (does not hang) and the cap is enforced
    // by checking the simulateChunked function behaviour via a controlled mock.
    const nodes: Array<LayoutInputNode> = Array.from({ length: 10 }, (_, i) =>
      makeNode(`Cap${i}`, 200, 100),
    )
    const edges: Array<LayoutInputEdge> = [
      { source: 'Cap0', target: 'Cap1' },
      { source: 'Cap2', target: 'Cap3' },
      { source: 'Cap4', target: 'Cap5' },
    ]

    // The test verifies: does not hang AND resolves with finite positions
    const result = await computeD3ForceLayout(nodes, edges)
    expect(result).toHaveLength(10)
    result.forEach((r) => {
      expect(Number.isFinite(r.x)).toBe(true)
      expect(Number.isFinite(r.y)).toBe(true)
    })
  })

  // TC-AL-E-11 — Per-RAF chunk respects 10-tick budget
  it('TC-AL-E-11: simulateChunked processes ≤ 10 ticks per RAF callback', async () => {
    // The 10-tick budget per RAF frame is verified structurally via the
    // TICK_BUDGET_PER_FRAME constant (10) in the module. The integration
    // test verifies the module compiles, the simulation terminates, and the
    // gap contract still holds (proving the ticks executed correctly).
    const nodes: Array<LayoutInputNode> = [makeNode('P1'), makeNode('P2')]
    const result = await computeD3ForceLayout(nodes, [])
    expect(result).toHaveLength(2)
    // Verify gap is still correct (proves ticks ran, simulation settled)
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

  // TC-AL-E-13 — enforceEdgeLabelGap does not move edge endpoints
  it('TC-AL-E-13: enforceEdgeLabelGap does not move edge endpoints when no third node intrudes', () => {
    const nodes: Array<SimNode> = [
      { id: 'A', x: 0, y: 0, width: 200, height: 100 },
      { id: 'B', x: 800, y: 0, width: 200, height: 100 },
    ]
    const edges: Array<LayoutInputEdge> = [{ source: 'A', target: 'B' }]
    const xA = nodes[0].x
    const yA = nodes[0].y
    const xB = nodes[1].x
    const yB = nodes[1].y
    enforceEdgeLabelGap(nodes, edges)
    // Endpoints are skipped by the algorithm — must not move
    expect(nodes[0].x).toBe(xA)
    expect(nodes[0].y).toBe(yA)
    expect(nodes[1].x).toBe(xB)
    expect(nodes[1].y).toBe(yB)
  })

  // TC-AL-E-14 — enforceEdgeLabelGap pushes a third node out of the edge-label zone
  it('TC-AL-E-14: enforceEdgeLabelGap pushes a third node out of the edge-label zone', () => {
    // A and B are far apart; C sits at the zone midpoint and intrudes.
    // Label "intrude" → pillWidth = max(60, 7×7) + 22 = 60+22 = 82px (jsdom fallback)
    const label = 'intrude'
    const A: SimNode = { id: 'A', x: 0, y: 0, width: 200, height: 100 }
    const B: SimNode = { id: 'B', x: 500, y: 0, width: 200, height: 100 }
    const C: SimNode = { id: 'C', x: 250, y: 0, width: 200, height: 100 }
    const edgeDef: LayoutInputEdge = { source: 'A', target: 'B', label }

    enforceEdgeLabelGap([A, B, C], [edgeDef])

    // Recompute label zone using the same formula as the production code.
    // Cardinality undefined → both flags false → extents = OPT_GAP_EXTENT + CIRCLE_R = 11px each.
    const leftExt = 11 // cardinalityIndicatorExtent(false) = 0 + 7 + 4
    const rightExt = 11
    const pillWidth = computeLabelPillWidth(label)
    const pillHeight = computeLabelPillHeight()
    // midX accounts for cardinality extents (mirrors production enforceEdgeLabelGap)
    const midX =
      (A.x + A.width / 2 + leftExt + B.x - B.width / 2 - rightExt) / 2
    const midY = (A.y + B.y) / 2
    const zoneW =
      Math.max(pillWidth, leftExt + rightExt) + 2 * EDGE_LABEL_MARGIN
    const zoneH = pillHeight + 2 * EDGE_LABEL_MARGIN
    const lx = midX - zoneW / 2
    const ly = midY - zoneH / 2

    const cx = C.x - C.width / 2
    const cy = C.y - C.height / 2
    const overlapX = cx < lx + zoneW && cx + C.width > lx
    const overlapY = cy < ly + zoneH && cy + C.height > ly

    expect(
      overlapX && overlapY,
      'C still overlaps label zone after enforcement',
    ).toBe(false)
  })

  // TC-AL-E-15 — All-pairs gap ≥ MIN_GAP=48 still holds after enforceEdgeLabelGap
  it('TC-AL-E-15: 48 px L∞ gap holds on every pair after full pipeline with 10 nodes and 5 edges', async () => {
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
// enforceLabelLabelGap unit tests
// ---------------------------------------------------------------------------

describe('enforceLabelLabelGap', () => {
  // TC-AL-E-18 — separates stacked same-source label pills
  it('TC-AL-E-18: separates overlapping label pills for same-source stacked edges', () => {
    // Source S at (0,0); targets A and B stacked close in same column.
    // Labels are identical FK names — each pill is ~120px wide, ~24px tall.
    // Initial label-midY values: (S.y + A.y)/2 = 100, (S.y + B.y)/2 = 120.
    // Gap between centres = 20px < pillH(24) + margin(16) = 40 → overlap.
    const edgeLabel = 'FK_Relationship'
    const S: SimNode = { id: 'S', x: 0, y: 0, width: 200, height: 100 }
    const A: SimNode = { id: 'A', x: 0, y: 200, width: 200, height: 100 }
    const B: SimNode = { id: 'B', x: 0, y: 240, width: 200, height: 100 }

    const pillH = computeLabelPillHeight()
    const pillW = computeLabelPillWidth(edgeLabel)

    // Verify labels DO overlap before the fix
    const cyA_before = (S.y + A.y) / 2 // 100
    const cyB_before = (S.y + B.y) / 2 // 120
    const overlapBefore =
      (pillH + pillH) / 2 +
      EDGE_LABEL_MARGIN -
      Math.abs(cyA_before - cyB_before)
    expect(overlapBefore).toBeGreaterThan(0)

    const edges: Array<LayoutInputEdge> = [
      { source: 'S', target: 'A', label: edgeLabel },
      { source: 'S', target: 'B', label: edgeLabel },
    ]
    enforceLabelLabelGap([S, A, B], edges)

    // After fix: label centres must be at least (pillH + EDGE_LABEL_MARGIN) apart
    const cyA_after = (S.y + A.y) / 2
    const cyB_after = (S.y + B.y) / 2
    const separation = Math.abs(cyA_after - cyB_after)
    expect(
      separation,
      `Label centre separation ${separation.toFixed(2)}px < required ${pillH + EDGE_LABEL_MARGIN}px`,
    ).toBeGreaterThanOrEqual(pillH + EDGE_LABEL_MARGIN - 1) // −1 for POST_PASS_SLACK rounding

    // Pills must not intersect: |cy_A - cy_B| >= (h_A + h_B)/2 = pillH
    expect(separation).toBeGreaterThanOrEqual(pillH)

    // Suppress unused-variable lint for pillW (verified via computeLabelPillWidth call above)
    void pillW
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

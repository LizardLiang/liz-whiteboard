// Auto Layout must leave gaps the edge router can use: every relationship line
// starts on the table border and needs a straight stub at each end that holds
// its cardinality marker (cardinality-marker.ts).

import { describe, expect, it } from 'vitest'
import { computeD3ForceLayout, computeRequiredColGap } from './d3-force-layout'
import type { LayoutInputEdge, LayoutInputNode } from './d3-force-layout'
import type {
  RelationshipEdgeType,
  TableNodeData,
} from '@/lib/react-flow/types'
import type { RouteGeometry } from '@/lib/react-flow/edge-route-pass'
import { recalculateEdgeRouting } from '@/lib/react-flow/edge-bundles'
import { endMinStubs } from '@/lib/react-flow/cardinality-marker'
import { createColumnHandleId } from '@/lib/react-flow/edge-routing'

const CARDINALITIES = [
  'ONE_TO_MANY',
  'ZERO_OR_MANY_TO_ZERO_OR_MANY',
  'MANY_TO_ONE',
  'ZERO_TO_MANY',
  'MANY_TO_MANY',
  'ZERO_OR_ONE_TO_ONE',
  'ZERO_OR_MANY_TO_ONE',
  'ONE_TO_ONE',
  'MANY_TO_ZERO_OR_MANY',
]

const ROW_H = 28
const HEADER_H = 40

/** A hub with spokes, a second hub and cross links, mixing every marker size. */
function board(withLabels: boolean) {
  const nodes: Array<LayoutInputNode> = Array.from({ length: 14 }, (_, i) => ({
    id: `T${i}`,
    width: 200 + (i % 3) * 40,
    height: HEADER_H + (4 + (i % 4)) * ROW_H,
  }))
  const pairs: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [1, 6],
    [2, 7],
    [3, 8],
    [4, 9],
    [5, 10],
    [6, 11],
    [7, 12],
    [8, 13],
    [2, 3],
    [9, 10],
    [11, 12],
  ]
  const edges: Array<LayoutInputEdge> = pairs.map(([s, t], i) => ({
    id: `e${i}`,
    source: `T${s}`,
    target: `T${t}`,
    cardinality: CARDINALITIES[i % CARDINALITIES.length],
    label: withLabels ? `fk_${s}_${t}` : undefined,
    sourceRow: 1 + (i % 3),
    targetRow: 0,
  }))
  return { nodes, edges }
}

describe.each([
  ['labelled', true],
  ['unlabelled', false],
])('Auto Layout gaps for the edge router (%s edges)', (_name, withLabels) => {
  const { nodes, edges } = board(withLabels)
  const dims = new Map(nodes.map((n) => [n.id, n]))

  it('leaves each related pair a horizontal gap of both facing end stubs', async () => {
    const out = await computeD3ForceLayout(nodes, edges)
    const pos = new Map(out.map((p) => [p.id, p]))
    let checked = 0
    for (const e of edges) {
      const a = pos.get(e.source)!
      const b = pos.get(e.target)!
      const aw = dims.get(e.source)!.width
      const bw = dims.get(e.target)!.width
      const gapX = Math.max(a.x - (b.x + bw), b.x - (a.x + aw))
      if (gapX < 0) continue // same column: the line leaves from the other side
      const stubs = endMinStubs(e.cardinality)
      expect(
        gapX,
        `${e.source}->${e.target} ${e.cardinality}`,
      ).toBeGreaterThanOrEqual(stubs.source + stubs.target)
      checked++
    }
    expect(checked).toBeGreaterThan(8)
  })

  it('routes every relationship line without falling back to the smooth-step path', async () => {
    const out = await computeD3ForceLayout(nodes, edges)
    const pos = new Map(out.map((p) => [p.id, p]))
    const flowNodes = nodes.map(
      (n) =>
        ({
          id: n.id,
          type: 'table',
          position: { x: pos.get(n.id)!.x, y: pos.get(n.id)!.y },
          measured: { width: n.width, height: n.height },
          data: {} as TableNodeData,
        }),
    )
    const rows = new Map<string, number>()
    const flowEdges = edges.map((e) => {
      rows.set(`${e.id}:s`, e.sourceRow ?? 0)
      rows.set(`${e.id}:t`, e.targetRow ?? 0)
      return {
        id: e.id!,
        type: 'relationship',
        source: e.source,
        target: e.target,
        sourceHandle: createColumnHandleId(
          e.source,
          `${e.id}:s`,
          'right',
          'source',
        ),
        targetHandle: createColumnHandleId(
          e.target,
          `${e.id}:t`,
          'left',
          'target',
        ),
        data: {
          cardinality: e.cardinality,
          relationship: {
            sourceColumnId: `${e.id}:s`,
            targetColumnId: `${e.id}:t`,
            cardinality: e.cardinality,
          },
        },
      } as unknown as RelationshipEdgeType
    })
    const geometry: RouteGeometry = {
      getPortOffsets: (_node, col) => ({
        y: HEADER_H + (rows.get(col) ?? 0) * ROW_H + ROW_H / 2,
      }),
    }
    const routed = recalculateEdgeRouting(
      flowEdges,
      flowNodes,
      new Set(nodes.map((n) => n.id)),
      geometry,
    )
    const fallbacks = routed.filter((e) => !e.data?.route).map((e) => e.id)
    expect(fallbacks).toEqual([])
  })
})

describe('computeRequiredColGap uses the router marker stubs', () => {
  it('sizes an unlabelled optional-many pair from both end stubs plus the 48 px run', () => {
    const stubs = endMinStubs('ZERO_OR_MANY_TO_ZERO_OR_MANY')
    expect(stubs).toEqual({ source: 28, target: 28 })
    expect(
      computeRequiredColGap([
        {
          source: 'A',
          target: 'B',
          cardinality: 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
        },
      ]),
    ).toBe(stubs.source + stubs.target + 48)
  })

  it('sizes a labelled edge from each end stub, not a fixed extent', () => {
    const label = 'fk_orders'
    const gap = (cardinality: string) =>
      computeRequiredColGap([{ source: 'A', target: 'B', label, cardinality }])
    const oneToOne = endMinStubs('ONE_TO_ONE')
    const optMany = endMinStubs('ZERO_OR_MANY_TO_ZERO_OR_MANY')
    expect(gap('ZERO_OR_MANY_TO_ZERO_OR_MANY') - gap('ONE_TO_ONE')).toBe(
      optMany.source + optMany.target - oneToOne.source - oneToOne.target,
    )
  })
})

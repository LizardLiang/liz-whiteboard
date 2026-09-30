import { describe, expect, it } from 'vitest'
import {
  computeEdgeBundleOffsetsFromPositions,
  recalculateEdgeRouting,
} from './edge-bundles'
import { createColumnHandleId } from './edge-routing'
import type { Node } from '@xyflow/react'
import type { RelationshipEdgeType, TableNodeData } from './types'
import { EDGE_SEP } from '@/lib/auto-layout/d3-force-layout'

function makeNode(id: string, x: number, y: number, width = 200): Node {
  return { id, position: { x, y }, width, data: {} } as Node
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceSide: 'left' | 'right',
  targetSide: 'left' | 'right',
): RelationshipEdgeType {
  return {
    id,
    type: 'relationship',
    source,
    target,
    sourceHandle: createColumnHandleId(source, `c-${id}`, sourceSide, 'source'),
    targetHandle: createColumnHandleId(target, `p-${id}`, targetSide, 'target'),
    data: {
      relationship: {
        sourceColumnId: `c-${id}`,
        targetColumnId: `p-${id}`,
      },
    },
  } as unknown as RelationshipEdgeType
}

function toMap(nodes: Array<Node>): Map<string, Node> {
  return new Map(nodes.map((n) => [n.id, n]))
}

describe('computeEdgeBundleOffsetsFromPositions', () => {
  // TC-AL-E-21
  it('TC-AL-E-21: single edge → both offsets are 0', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 500, 0)]
    const result = computeEdgeBundleOffsetsFromPositions(
      [makeEdge('e1', 'A', 'B', 'right', 'left')],
      toMap(nodes),
    )
    expect(result.get('e1')).toEqual({ handleYOffset: 0, centerXOffset: 0 })
  })

  // TC-AL-E-22
  it('TC-AL-E-22: 2 edges same table pair → symmetric offsets', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 500, 0)]
    const result = computeEdgeBundleOffsetsFromPositions(
      [
        makeEdge('e1', 'A', 'B', 'right', 'left'),
        makeEdge('e2', 'A', 'B', 'right', 'left'),
      ],
      toMap(nodes),
    )
    expect(result.get('e1')!.centerXOffset).toBeCloseTo(-EDGE_SEP / 2)
    expect(result.get('e2')!.centerXOffset).toBeCloseTo(EDGE_SEP / 2)
    expect(result.get('e1')!.handleYOffset).toBeCloseTo(-EDGE_SEP / 2)
    expect(result.get('e2')!.handleYOffset).toBeCloseTo(EDGE_SEP / 2)
  })

  // TC-AL-E-23
  it('TC-AL-E-23: 3 edges in one corridor, different pairs → centerXOffset ±EDGE_SEP, handleYOffset 0', () => {
    const nodes = [
      makeNode('Hub', 0, 0),
      makeNode('A', 500, 0),
      makeNode('B', 500, 200),
      makeNode('C', 500, 400),
    ]
    const result = computeEdgeBundleOffsetsFromPositions(
      [
        makeEdge('e1', 'Hub', 'A', 'right', 'left'),
        makeEdge('e2', 'Hub', 'B', 'right', 'left'),
        makeEdge('e3', 'Hub', 'C', 'right', 'left'),
      ],
      toMap(nodes),
    )
    const xs = ['e1', 'e2', 'e3'].map((id) => result.get(id)!.centerXOffset)
    expect(xs[0]).toBeCloseTo(-EDGE_SEP)
    expect(xs[1]).toBeCloseTo(0)
    expect(xs[2]).toBeCloseTo(EDGE_SEP)
    for (const id of ['e1', 'e2', 'e3']) {
      expect(result.get(id)!.handleYOffset).toBe(0)
    }
  })

  it('edges in different corridors do not share a group', () => {
    const nodes = [
      makeNode('A', 0, 0),
      makeNode('B', 500, 0),
      makeNode('C', 1500, 0),
      makeNode('D', 2000, 0),
    ]
    const result = computeEdgeBundleOffsetsFromPositions(
      [
        makeEdge('e1', 'A', 'B', 'right', 'left'),
        makeEdge('e2', 'C', 'D', 'right', 'left'),
      ],
      toMap(nodes),
    )
    expect(result.get('e1')!.centerXOffset).toBe(0)
    expect(result.get('e2')!.centerXOffset).toBe(0)
  })

  it('same-side edges group by side and the larger handle x', () => {
    const nodes = [
      makeNode('A', 0, 0),
      makeNode('B', 0, 300),
      makeNode('C', 0, 600),
    ]
    const result = computeEdgeBundleOffsets2(nodes)
    expect(result.get('e1')!.centerXOffset).toBeCloseTo(-EDGE_SEP / 2)
    expect(result.get('e2')!.centerXOffset).toBeCloseTo(EDGE_SEP / 2)
  })
})

function computeEdgeBundleOffsets2(nodes: Array<Node>) {
  return computeEdgeBundleOffsetsFromPositions(
    [
      makeEdge('e1', 'A', 'B', 'right', 'right'),
      makeEdge('e2', 'B', 'C', 'right', 'right'),
    ],
    toMap(nodes),
  )
}

describe('recalculateEdgeRouting', () => {
  const asTableNodes = (nodes: Array<Node>) =>
    nodes as unknown as Array<Node<TableNodeData>>

  function starEdges() {
    return [
      makeEdge('e1', 'Hub', 'A', 'right', 'left'),
      makeEdge('e2', 'Hub', 'B', 'right', 'left'),
    ]
  }
  const positioned = () => [
    makeNode('Hub', 0, 0),
    makeNode('A', 500, 0),
    makeNode('B', 500, 200),
  ]

  it('load path and post-layout path give identical offsets for the same positions', () => {
    const nodes = asTableNodes(positioned())
    const ids = new Set(nodes.map((n) => n.id))
    // Load path: handles unset, everything is routed.
    const load = recalculateEdgeRouting(
      starEdges().map((e) => ({
        ...e,
        sourceHandle: null,
        targetHandle: null,
      })),
      nodes,
      ids,
    )
    // Post-layout path: edges arrive with stale offsets and handles.
    const stale = starEdges().map((e) => ({
      ...e,
      data: { ...e.data!, bundleCenterXOffset: 99 },
    }))
    const post = recalculateEdgeRouting(stale, nodes, ids)
    expect(post.map((e) => e.data?.bundleCenterXOffset)).toEqual(
      load.map((e) => e.data?.bundleCenterXOffset),
    )
    expect(load.map((e) => e.data?.bundleCenterXOffset)).toEqual([
      -EDGE_SEP / 2,
      EDGE_SEP / 2,
    ])
  })

  it('a dragged table that leaves the corridor drops out of the group', () => {
    const nodes = positioned()
    const ids = new Set(nodes.map((n) => n.id))
    const before = recalculateEdgeRouting(starEdges(), asTableNodes(nodes), ids)
    expect(before[1].data?.bundleCenterXOffset).toBeCloseTo(EDGE_SEP / 2)

    const moved = asTableNodes([nodes[0], nodes[1], makeNode('B', 1800, 200)])
    const after = recalculateEdgeRouting(before, moved, new Set(['B']))
    expect(after[0].data?.bundleCenterXOffset ?? 0).toBe(0)
    expect(after[1].data?.bundleCenterXOffset ?? 0).toBe(0)
  })

  it('returns the same array reference when nothing changes', () => {
    const nodes = asTableNodes(positioned())
    const ids = new Set(nodes.map((n) => n.id))
    const first = recalculateEdgeRouting(starEdges(), nodes, ids)
    expect(recalculateEdgeRouting(first, nodes, ids)).toBe(first)
  })
})

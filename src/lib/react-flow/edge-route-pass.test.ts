import { describe, expect, it } from 'vitest'
import { recalculateEdgeRouting } from './edge-bundles'
import { carryRoutes, nudgeRoutes } from './edge-route-pass'
import { createColumnHandleId, parseColumnHandleId } from './edge-routing'
import { routeClearsRects, segmentHitsRect } from './orthogonal-router'
import type { Node } from '@xyflow/react'
import type { RouteGeometry } from './edge-route-pass'
import type { RelationshipEdgeType, TableNodeData } from './types'
import type { Point, Rect } from './edge-label-placement'
import { EDGE_SEP } from '@/lib/auto-layout/d3-force-layout'

const W = 200
const H = 120

function table(id: string, x: number, y: number): Node<TableNodeData> {
  return {
    id,
    type: 'table',
    position: { x, y },
    measured: { width: W, height: H },
    data: {} as TableNodeData,
  }
}

function edge(
  id: string,
  source: string,
  target: string,
): RelationshipEdgeType {
  return {
    id,
    type: 'relationship',
    source,
    target,
    sourceHandle: createColumnHandleId(source, `c-${id}`, 'right', 'source'),
    targetHandle: createColumnHandleId(target, `p-${id}`, 'left', 'target'),
    data: {
      relationship: { sourceColumnId: `c-${id}`, targetColumnId: `p-${id}` },
    },
  } as unknown as RelationshipEdgeType
}

const geometry: RouteGeometry = {
  getPortOffsets: () => ({ left: { x: 0, y: 40 }, right: { x: W, y: 40 } }),
}

function rectOf(n: Node): Rect {
  return { x: n.position.x, y: n.position.y, width: W, height: H }
}

describe('recalculateEdgeRouting with geometry', () => {
  const a = table('A', 0, 0)
  const b = table('B', 400, 0)
  const c = table('C', 800, 0)

  it('routes around a table that sits on the straight path', () => {
    const out = recalculateEdgeRouting(
      [edge('e1', 'A', 'C')],
      [a, b, c],
      new Set(['A']),
      geometry,
    )
    const route = out[0].data!.route!
    expect(route.length).toBeGreaterThan(2)
    for (let i = 0; i < route.length - 1; i++) {
      expect(segmentHitsRect(route[i], route[i + 1], rectOf(b))).toBe(false)
    }
    expect(route[0]).toEqual({ x: W, y: 40 })
    expect(route[route.length - 1]).toEqual({ x: 800, y: 40 })
    expect(out[0].data!.routeKey).toBeTruthy()
  })

  it('writes the handle ids of the sides the router chose', () => {
    const out = recalculateEdgeRouting(
      [edge('e1', 'A', 'C')],
      [a, b, c],
      new Set(['A']),
      geometry,
    )
    const src = parseColumnHandleId(out[0].sourceHandle!)!
    const tgt = parseColumnHandleId(out[0].targetHandle!)!
    expect(src.tableId).toBe('A')
    expect(tgt.tableId).toBe('C')
    expect(['left', 'right']).toContain(src.side)
    expect(['left', 'right']).toContain(tgt.side)
  })

  it('returns the same array when nothing changed', () => {
    const first = recalculateEdgeRouting(
      [edge('e1', 'A', 'C')],
      [a, b, c],
      new Set(['A']),
      geometry,
    )
    const second = recalculateEdgeRouting(
      first,
      [a, b, c],
      new Set(['A', 'B', 'C']),
      geometry,
    )
    expect(second).toBe(first)
  })

  it('re-routes an edge when an unrelated table moves into its window', () => {
    const near = [a, c]
    const first = recalculateEdgeRouting(
      [edge('e1', 'A', 'C')],
      near,
      new Set(['A']),
      geometry,
    )
    const straight = first[0].data!.route!
    expect(straight).toHaveLength(2)
    // B is not an endpoint of e1, and is the only moved table.
    const second = recalculateEdgeRouting(
      first,
      [a, b, c],
      new Set(['B']),
      geometry,
    )
    expect(second[0]).not.toBe(first[0])
    expect(second[0].data!.route!.length).toBeGreaterThan(2)
  })

  it('skips routing for an edge whose handles are not measured', () => {
    const out = recalculateEdgeRouting(
      [edge('e1', 'A', 'C')],
      [a, b, c],
      new Set(['A']),
      { getPortOffsets: () => null },
    )
    expect(out[0].data!.route).toBeUndefined()
    expect(out[0].data!.routeKey).toBeUndefined()
  })

  it('caches a failed route so it is not searched again', () => {
    const overlap = table('B2', 100, 20)
    const nodes = [a, overlap]
    const first = recalculateEdgeRouting(
      [edge('e1', 'A', 'B2')],
      nodes,
      new Set(['A']),
      geometry,
    )
    expect(first[0].data!.route).toBeUndefined()
    expect(first[0].data!.routeKey).toBeTruthy()
    const second = recalculateEdgeRouting(
      first,
      nodes,
      new Set(['A', 'B2']),
      geometry,
    )
    expect(second).toBe(first)
  })

  it('keeps bundleCenterXOffset at 0 for a routed edge', () => {
    const out = recalculateEdgeRouting(
      [edge('e1', 'A', 'C'), edge('e2', 'A', 'C')],
      [a, b, c],
      new Set(['A']),
      geometry,
    )
    for (const e of out) expect(e.data!.bundleCenterXOffset).toBe(0)
  })

  it('without geometry behaves as before (no route written)', () => {
    const out = recalculateEdgeRouting(
      [edge('e1', 'A', 'C')],
      [a, b, c],
      new Set(['A']),
    )
    expect(out[0].data!.route).toBeUndefined()
  })
})

describe('failed-route keys', () => {
  const a = table('A', 0, 0)
  const b = table('B', 600, 300)
  // Neighbours 5 px from A on both sides leave no room for a stub: no route.
  const left = table('L', -205, 0)
  const right = table('R', 205, 0)

  it('keys a failure that searched the whole board on the whole board', () => {
    const far = table('F', 5000, 5000)
    const nodes = [a, b, left, right, far]
    const first = recalculateEdgeRouting(
      [edge('e1', 'A', 'B')],
      nodes,
      new Set(['A']),
      geometry,
    )
    expect(first[0].data!.route).toBeUndefined()
    const key = first[0].data!.routeKey!
    expect(key.startsWith('X|')).toBe(true)
    // Nothing moved: no new search, same edges back.
    const same = recalculateEdgeRouting(first, nodes, new Set(), geometry)
    expect(same).toBe(first)
    // A far table moved: the whole-board failure is searched again.
    const moved = recalculateEdgeRouting(
      first,
      [a, b, left, right, table('F', 5100, 5000)],
      new Set(['F']),
      geometry,
    )
    expect(moved[0].data!.routeKey).not.toBe(key)
  })
})

describe('routes of an edge with no history', () => {
  it('does not depend on the side the edge handle names', () => {
    const a = table('A', 0, 0)
    const b = table('B', 0, 400)
    const withSides = (s: 'left' | 'right') => {
      const e = edge('e1', 'A', 'B')
      e.sourceHandle = createColumnHandleId('A', 'c-e1', s, 'source')
      e.targetHandle = createColumnHandleId('B', 'p-e1', s, 'target')
      return recalculateEdgeRouting([e], [a, b], new Set(['A']), geometry)[0]
    }
    expect(withSides('left').data!.route).toEqual(
      withSides('right').data!.route,
    )
  })
})

describe('nudgeRoutes', () => {
  // Two routes with the same interior vertical segment at x = 300.
  const mk = (y0: number, y1: number): Array<Point> => [
    { x: 200, y: y0 },
    { x: 216, y: y0 },
    { x: 216, y: 300 },
    { x: 300, y: 300 },
    { x: 300, y: y1 },
    { x: 384, y: y1 },
    { x: 400, y: y1 },
  ]

  it('spreads overlapping parallel segments by EDGE_SEP', () => {
    const out = nudgeRoutes([
      { id: 'a', base: mk(40, 90) },
      { id: 'b', base: mk(60, 110) },
    ])
    const xa = out.get('a')![3].x
    const xb = out.get('b')![3].x
    expect(Math.abs(xa - xb)).toBeCloseTo(EDGE_SEP, 5)
    expect(xa).toBeLessThan(xb)
  })

  it('never moves the end points or the stub segments', () => {
    const base = mk(40, 90)
    const out = nudgeRoutes([
      { id: 'a', base },
      { id: 'b', base: mk(60, 110) },
    ])
    const r = out.get('a')!
    expect(r[0]).toEqual(base[0])
    expect(r[r.length - 1]).toEqual(base[base.length - 1])
    expect(r[0].y).toBe(r[1].y)
    expect(r[r.length - 2].y).toBe(r[r.length - 1].y)
  })

  it('keeps three routes in a 3 px channel clear of the table', () => {
    // Three routes share y = 100; a table's top edge sits at y = 103.
    const route = (): Array<Point> => [
      { x: 0, y: 40 },
      { x: 16, y: 40 },
      { x: 16, y: 100 },
      { x: 600, y: 100 },
      { x: 600, y: 40 },
      { x: 616, y: 40 },
    ]
    const wall: Rect = { x: 100, y: 103, width: 300, height: 200 }
    const items = ['a', 'b', 'c'].map((id) => ({ id, base: route() }))
    const free = nudgeRoutes(items)
    expect([...free.values()].some((r) => !routeClearsRects(r, [wall]))).toBe(
      true,
    )
    const out = nudgeRoutes(items, [wall])
    for (const r of out.values()) expect(routeClearsRects(r, [wall])).toBe(true)
    const ys = [...out.values()].map((r) => r[2].y)
    expect(new Set(ys).size).toBeGreaterThan(1)
  })

  it('leaves a lone route untouched', () => {
    const base = mk(40, 90)
    const out = nudgeRoutes([{ id: 'a', base }])
    expect(out.get('a')).toEqual(base)
  })

  it('is deterministic regardless of input order', () => {
    const items = [
      { id: 'a', base: mk(40, 90) },
      { id: 'b', base: mk(60, 110) },
      { id: 'c', base: mk(80, 130) },
    ]
    const fwd = nudgeRoutes(items)
    const rev = nudgeRoutes([...items].reverse())
    for (const id of ['a', 'b', 'c']) expect(fwd.get(id)).toEqual(rev.get(id))
  })
})

describe('carryRoutes', () => {
  it('copies route, key and handles from the edge on screen', () => {
    const prev = edge('e1', 'A', 'C')
    prev.sourceHandle = createColumnHandleId('A', 'c-e1', 'left', 'source')
    prev.data = {
      ...prev.data!,
      route: [{ x: 1, y: 2 }],
      routeBase: [{ x: 1, y: 2 }],
      routeKey: 'k',
    }
    const [out] = carryRoutes([edge('e1', 'A', 'C')], [prev])
    expect(out.sourceHandle).toBe(prev.sourceHandle)
    expect(out.data!.routeKey).toBe('k')
    expect(out.data!.route).toEqual([{ x: 1, y: 2 }])
  })

  it('leaves edges with no cached route alone', () => {
    const fresh = edge('e1', 'A', 'C')
    const [out] = carryRoutes([fresh], [edge('e1', 'A', 'C')])
    expect(out).toBe(fresh)
  })
})

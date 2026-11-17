import { describe, expect, it } from 'vitest'
import {
  MAX_SCRATCH_STATES,
  ROUTE_MARGIN,
  routeClearsRects,
  routeEdge,
  routeKeyFor,
  scratchStates,
  segmentHitsRect,
} from './orthogonal-router'
import { endMinStubs, markerExtent } from './cardinality-marker'
import { recalculateEdgeRouting } from './edge-bundles'
import { createColumnHandleId } from './edge-routing'
import type { Node } from '@xyflow/react'
import type { Point, Rect } from './edge-label-placement'
import type { RouteGeometry } from './edge-route-pass'
import type { RelationshipEdgeType, TableNodeData } from './types'
import type { RouteEnd, RouteInput } from './orthogonal-router'

const W = 250
const H = 120

function table(x: number, y: number, w = W, h = H): Rect {
  return { x, y, width: w, height: h }
}

/** Ports sit at the table edge, 40 px below the top. */
function end(rect: Rect, portDy = 40): RouteEnd {
  return {
    rect,
    ports: {
      left: { x: rect.x, y: rect.y + portDy },
      right: { x: rect.x + rect.width, y: rect.y + portDy },
    },
  }
}

function input(
  source: Rect,
  target: Rect,
  others: Array<Rect> = [],
  extra: Partial<RouteInput> = {},
): RouteInput {
  return {
    source: end(source),
    target: end(target),
    obstacles: [source, target, ...others],
    ...extra,
  }
}

function padRect(r: Rect, m: number): Rect {
  return {
    x: r.x - m,
    y: r.y - m,
    width: r.width + 2 * m,
    height: r.height + 2 * m,
  }
}

/** Segments of the route, minus the two port legs that touch the endpoint tables. */
function interiorSegments(points: Array<Point>): Array<[Point, Point]> {
  const segs: Array<[Point, Point]> = []
  for (let i = 1; i < points.length - 2; i++)
    segs.push([points[i], points[i + 1]])
  return segs
}

function isOrthogonal(points: Array<Point>): boolean {
  return points.every(
    (p, i) => i === 0 || p.x === points[i - 1].x || p.y === points[i - 1].y,
  )
}

describe('routeEdge', () => {
  it('draws a 3-segment H-V-H route when nothing is in the way', () => {
    const a = table(0, 0)
    const b = table(600, 300)
    const r = routeEdge(input(a, b))!
    expect(r).not.toBeNull()
    expect(r.sourceSide).toBe('right')
    expect(r.targetSide).toBe('left')
    expect(r.points).toHaveLength(4)
    expect(isOrthogonal(r.points)).toBe(true)
    expect(r.points[0]).toEqual({ x: 250, y: 40 })
    expect(r.points[3]).toEqual({ x: 600, y: 340 })
    // The vertical run sits mid-gap.
    expect(r.points[1].x).toBe(425)
    expect(r.expanded).toBe(false)
  })

  it('routes around a table that sits between the endpoints', () => {
    const a = table(0, 0)
    const c = table(1000, 0)
    const blocker = table(450, -20, 250, 200)
    const r = routeEdge(input(a, c, [blocker]))!
    expect(r).not.toBeNull()
    expect(isOrthogonal(r.points)).toBe(true)
    const padded = padRect(blocker, ROUTE_MARGIN)
    for (const [p, q] of interiorSegments(r.points)) {
      expect(segmentHitsRect(p, q, padded)).toBe(false)
    }
  })

  it('keeps clear of every padded obstacle when several tables crowd the gap', () => {
    const a = table(0, 0)
    const c = table(1200, 0)
    const others = [
      table(400, -150, 200, 100),
      table(450, 40, 200, 120),
      table(700, 220, 200, 100),
      table(800, -60, 150, 150),
    ]
    const r = routeEdge(input(a, c, others))!
    expect(r).not.toBeNull()
    for (const o of others) {
      const padded = padRect(o, ROUTE_MARGIN)
      for (const [p, q] of interiorSegments(r.points)) {
        expect(segmentHitsRect(p, q, padded)).toBe(false)
      }
    }
  })

  it('picks the left side when the right side is walled in', () => {
    const a = table(300, 0)
    const c = table(800, 0)
    // A wall of tables hugging A's right edge, with less than 2 margins between them.
    const wall = [
      table(a.x + W + 10, -400, 40, 460),
      table(a.x + W + 10, 70, 40, 460),
    ]
    const r = routeEdge(input(a, c, wall))!
    expect(r).not.toBeNull()
    expect(r.sourceSide).toBe('left')
  })

  it('keeps the current sides on a 5 px move (stickiness)', () => {
    const a = table(0, 0)
    const fresh = routeEdge(input(a, table(600, 5)))!
    expect(fresh.sourceSide).toBe('right')
    expect(fresh.targetSide).toBe('left')
    const moved = routeEdge(
      input(a, table(600, 10), [], {
        currentSides: { source: fresh.sourceSide, target: fresh.targetSide },
      }),
    )!
    expect(moved.sourceSide).toBe(fresh.sourceSide)
    expect(moved.targetSide).toBe(fresh.targetSide)
  })

  it('lets a sticky pair win only inside the STICKY band', () => {
    const a = table(0, 0)
    const c = table(600, 0)
    const near = routeEdge(
      input(a, c, [], {
        currentSides: { source: 'right', target: 'left' },
        sticky: 0,
      }),
    )!
    expect(near.sourceSide).toBe('right')
    // A huge sticky band forces the (worse) current pair.
    const forced = routeEdge(
      input(a, c, [], {
        currentSides: { source: 'left', target: 'right' },
        sticky: 100000,
      }),
    )!
    expect(forced.sourceSide).toBe('left')
    expect(forced.targetSide).toBe('right')
  })

  it('routes a self-relationship', () => {
    const t = table(100, 100, 250, 300)
    const r = routeEdge({
      source: end(t, 40),
      target: end(t, 200),
      obstacles: [t],
    })!
    expect(r).not.toBeNull()
    expect(isOrthogonal(r.points)).toBe(true)
    const padded = padRect(t, ROUTE_MARGIN)
    for (const [p, q] of interiorSegments(r.points)) {
      expect(segmentHitsRect(p, q, padded)).toBe(false)
    }
  })

  it('returns null when the endpoint tables overlap', () => {
    expect(routeEdge(input(table(0, 0), table(100, 50)))).toBeNull()
  })

  it('returns null on non-finite input', () => {
    expect(routeEdge(input(table(NaN, 0), table(600, 0)))).toBeNull()
    expect(routeEdge(input(table(0, 0), table(600, Infinity)))).toBeNull()
    const bad = input(table(0, 0), table(600, 0))
    bad.source.ports.right = { x: NaN, y: 0 }
    expect(routeEdge(bad)).toBeNull()
    expect(
      routeEdge(input(table(0, 0), table(600, 0), [table(0, NaN)])),
    ).toBeNull()
  })

  it('is deterministic', () => {
    const a = table(0, 0)
    const c = table(900, 200)
    const others = [table(400, 20, 200, 150), table(400, 300, 200, 100)]
    const first = routeEdge(input(a, c, others))
    for (let i = 0; i < 5; i++) {
      expect(routeEdge(input(a, c, others))).toEqual(first)
    }
  })

  it('returns null when the expansion cap is hit', () => {
    const a = table(0, 0)
    const c = table(1000, 0)
    const blocker = table(450, -20, 250, 200)
    expect(routeEdge(input(a, c, [blocker], { maxExpansions: 1 }))).toBeNull()
  })

  it('still routes with a zero-size window', () => {
    const r = routeEdge(
      input(table(0, 0), table(600, 0), [], { windowExpand: 0 }),
    )
    expect(r).not.toBeNull()
  })
})

/** Handle strip: a port sits this far outside its table in the app. */

describe('routeEdge in tight gaps', () => {
  const A = table(400, 0)
  const C = table(1100, 0)

  /** Tall neighbours hug both sides of A, `gap` px away. */
  function walled(gap: number): Array<Rect> {
    return [
      table(A.x - gap - 100, -300, 100, 700),
      table(A.x + W + gap, -300, 100, 700),
    ]
  }

  function expectClear(r: ReturnType<typeof routeEdge>, rects: Array<Rect>) {
    expect(r).not.toBeNull()
    expect(isOrthogonal(r!.points)).toBe(true)
    for (const o of rects) {
      for (let i = 0; i + 1 < r!.points.length; i++) {
        expect(segmentHitsRect(r!.points[i], r!.points[i + 1], o)).toBe(false)
      }
    }
  }

  it.each([16, 20, 28])(
    'routes through a %i px gap on both sides without touching a table',
    (gap) => {
      const others = walled(gap)
      const r = routeEdge(input(A, C, others))
      expectClear(r, [A, C, ...others])
      const [p0, p1] = r!.points
      expect(
        Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y),
      ).toBeGreaterThanOrEqual(13)
    },
  )

  // Each end floors at its own marker extent (+ air): a "one" end routes in a
  // smaller gap than a "many"/optional end, and the first and last segments
  // are never shorter than the marker, so it always sits on a straight run.
  const CARDS = [
    'ONE_TO_ONE',
    'ONE_TO_MANY',
    'ZERO_TO_ONE',
    'ZERO_TO_MANY',
    'ZERO_OR_MANY_TO_ZERO_OR_MANY',
  ]
  const seg = (a: Point, b: Point) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y)

  it.each(CARDS)(
    '%s: first and last segments hold each end marker; the target end too',
    (card) => {
      const { source, target } = endMinStubs(card)
      const others = [
        ...walled(source + 3),
        table(C.x - target - 3 - 100, -300, 100, 700),
        table(C.x + W + target + 3, -300, 100, 700),
      ]
      const r = routeEdge({
        ...input(A, C, others),
        source: { ...end(A), minStub: source },
        target: { ...end(C), minStub: target },
      })
      expectClear(r, [A, C, ...others])
      const pts = r!.points
      expect(seg(pts[0], pts[1])).toBeGreaterThanOrEqual(source)
      expect(
        seg(pts[pts.length - 2], pts[pts.length - 1]),
      ).toBeGreaterThanOrEqual(target)
    },
  )

  it.each(CARDS)(
    '%s: a gap below the end floor + 3 px has no route',
    (card) => {
      const { source } = endMinStubs(card)
      const others = walled(source + 2)
      const r = routeEdge({
        ...input(A, C, others),
        source: { ...end(A), minStub: source },
        target: { ...end(C), minStub: 3 },
      })
      expect(r).toBeNull()
    },
  )

  it('a "one" end routes in a gap too small for an optional-many end', () => {
    const oneGap = endMinStubs('ONE_TO_ONE').source + 3
    expect(oneGap).toBeLessThan(markerExtent(true, true))
    const others = walled(oneGap)
    const one = routeEdge({
      ...input(A, C, others),
      source: { ...end(A), minStub: endMinStubs('ONE_TO_ONE').source },
    })
    const many = routeEdge({
      ...input(A, C, others),
      source: {
        ...end(A),
        minStub: endMinStubs('ZERO_OR_MANY_TO_ONE').source,
      },
    })
    expect(one).not.toBeNull()
    expect(many).toBeNull()
  })

  it('is deterministic in a tight gap', () => {
    const others = walled(20)
    const first = routeEdge(input(A, C, others))
    expect(routeEdge(input(A, C, others))).toEqual(first)
  })

  it('leaves a roomy layout unchanged by the reduced-clearance retry', () => {
    const others = walled(60)
    const r = routeEdge(input(A, C, others))!
    expectClear(r, [A, C, ...others])
    const padded = others.map((o) => padRect(o, ROUTE_MARGIN))
    for (const o of padded) {
      for (const [p, q] of interiorSegments(r.points)) {
        expect(segmentHitsRect(p, q, o)).toBe(false)
      }
    }
    expect(Math.abs(r.points[1].x - r.points[0].x)).toBeGreaterThanOrEqual(16)
  })

  it('still returns null when the gap is smaller than the marker reach', () => {
    expect(routeEdge(input(A, C, walled(8)))).toBeNull()
  })

  it('still returns null when a neighbour overlaps an endpoint', () => {
    expect(routeEdge(input(A, table(A.x + 100, 50)))).toBeNull()
  })
})

describe('routeEdge window validation', () => {
  it('does not accept a windowed route that runs through a table beyond the window', () => {
    const a = table(0, 0)
    const c = table(700, 0)
    // A wall between the endpoints, taller than the routing window: the cheap
    // way round runs far past the window edge, where `blocker` sits.
    const wall = table(400, -3000, 50, 6000)
    const blocker = table(150, 1000, 240, 100)
    const obstacles = [a, c, wall, blocker]
    const r = routeEdge({ source: end(a), target: end(c), obstacles })
    expect(r).not.toBeNull()
    expect(routeClearsRects(r!.points, obstacles)).toBe(true)
  })
})

describe('routeEdge grid cap and scratch', () => {
  /** Jittered columns so every table adds its own grid lines. */
  function field(n: number): Array<Rect> {
    const out: Array<Rect> = []
    for (let i = 0; i < n; i++) {
      out.push(
        table(
          (i % 12) * 310 + (i % 7) * 3,
          Math.floor(i / 12) * 190 + (i % 5) * 2,
          250 + (i % 3),
          120 + (i % 4),
        ),
      )
    }
    return out
  }

  it('returns null above the grid cap and routes below it', () => {
    // field(100) builds a 148 757-cell grid (under MAX_GRID_CELLS = 160 000);
    // field(110) builds 165 347 cells, just over the cap.
    const under = field(100)
    const over = field(110)
    const route = (t: Array<Rect>) =>
      routeEdge({
        source: end(t[0]),
        target: end(t[11]),
        obstacles: t,
        windowExpand: Infinity,
      })
    expect(route(under)).not.toBeNull()
    expect(route(over)).toBeNull()
    // The same two endpoints with fewer tables route, so the null is the cap.
    expect(route(over.slice(0, 100))).not.toBeNull()
  })

  it('keeps one scratch allocation within the cap across routes', () => {
    const t = field(100)
    const run = () =>
      routeEdge({
        source: end(t[0]),
        target: end(t[11]),
        obstacles: t,
        windowExpand: Infinity,
      })
    expect(run()).not.toBeNull()
    const grown = scratchStates()
    expect(grown).toBeGreaterThan(0)
    expect(grown).toBeLessThanOrEqual(MAX_SCRATCH_STATES)
    expect(run()).not.toBeNull()
    expect(scratchStates()).toBe(grown)
  })
})

describe('routeKeyFor', () => {
  it('changes when an obstacle in the window moves and not when a far one does', () => {
    const a = table(0, 0)
    const c = table(600, 0)
    const near = table(300, 200)
    const far = table(5000, 5000)
    const base = routeKeyFor(input(a, c, [near, far]))
    expect(routeKeyFor(input(a, c, [near, far]))).toBe(base)
    expect(routeKeyFor(input(a, c, [table(300, 230), far]))).not.toBe(base)
    expect(routeKeyFor(input(a, c, [near, table(5100, 5000)]))).toBe(base)
  })
})

describe('perf: 150 tables, 200 edges', () => {
  const COLS = 15
  const ROWS = 10
  const tables: Array<Rect> = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      tables.push(table(c * 420, r * 300, 250, 120 + ((r * COLS + c) % 5) * 20))
    }
  }
  let seed = 42
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const pairs: Array<[number, number]> = []
  while (pairs.length < 200) {
    const s = Math.floor(rnd() * tables.length)
    const sc = s % COLS
    const sr = Math.floor(s / COLS)
    const tc = Math.min(COLS - 1, Math.max(0, sc + Math.floor(rnd() * 7) - 3))
    const tr = Math.min(ROWS - 1, Math.max(0, sr + Math.floor(rnd() * 5) - 2))
    const t = tr * COLS + tc
    if (t !== s) pairs.push([s, t])
  }

  const nodesOf = (rects: Array<Rect>): Array<Node<TableNodeData>> =>
    rects.map((r, i) => ({
      id: `t${i}`,
      type: 'table',
      position: { x: r.x, y: r.y },
      measured: { width: r.width, height: r.height },
      data: {} as TableNodeData,
    }))
  const freshEdges = (): Array<RelationshipEdgeType> =>
    pairs.map(
      ([s, t], i) =>
        ({
          id: `e${i}`,
          type: 'relationship',
          source: `t${s}`,
          target: `t${t}`,
          sourceHandle: createColumnHandleId(
            `t${s}`,
            `c${i}`,
            'right',
            'source',
          ),
          targetHandle: createColumnHandleId(
            `t${t}`,
            `p${i}`,
            'left',
            'target',
          ),
          data: {
            relationship: { sourceColumnId: `c${i}`, targetColumnId: `p${i}` },
          },
        }) as unknown as RelationshipEdgeType,
    )
  const geometry: RouteGeometry = {
    getPortOffsets: () => ({ y: 40 }),
  }
  // The pass as the canvas wires it: side pass, router, route cache, nudge.
  const wired = (
    edges: Array<RelationshipEdgeType>,
    rects: Array<Rect>,
    moved: Set<string>,
  ) => recalculateEdgeRouting(edges, nodesOf(rects), moved, geometry)
  const allIds = new Set(tables.map((_, i) => `t${i}`))

  const median = (xs: Array<number>) =>
    [...xs].sort((a, b) => a - b)[xs.length >> 1]

  // CPU time of this process, not wall time: the suite runs files in parallel,
  // and wall time here also counts every moment another file kept this
  // process off the CPU. Both clocks are monotonic.
  const cpuMs = () => {
    const u = process.cpuUsage()
    return (u.user + u.system) / 1000
  }

  function measure() {
    const cold = cpuMs()
    const warm = wired(freshEdges(), tables, allIds)
    const coldMs = cpuMs() - cold

    const full: Array<number> = []
    for (let i = 0; i < 20; i++) {
      const t0 = cpuMs()
      wired(warm, tables, allIds)
      full.push(cpuMs() - t0)
    }

    const moved: Array<number> = []
    let reRouted = 0
    for (let i = 0; i < 20; i++) {
      const rects = tables.map((r) => ({ ...r }))
      const victim = 70 + (i % 5)
      rects[victim] = {
        ...rects[victim],
        x: rects[victim].x + 30 + i,
        y: rects[victim].y + 20,
      }
      const t0 = cpuMs()
      const out = wired(warm, rects, new Set([`t${victim}`]))
      moved.push(cpuMs() - t0)
      reRouted = out.filter((e, k) => e !== warm[k]).length
    }
    return {
      coldMs,
      fullMedian: median(full),
      movedMedian: median(moved),
      reRouted,
    }
  }

  // The gate is 8 ms median on a quiet machine. The default suite runs test
  // files in parallel, which slows this one by up to 1.5x, so by default it
  // guards at 2x the gate (a real algorithmic regression is far above that).
  // Run it alone with PERF_STRICT=1 for the exact 8 ms gate:
  //   PERF_STRICT=1 bun run test src/lib/react-flow/orthogonal-router.test.ts
  const GATE_MS = 8
  const budget = process.env.PERF_STRICT === '1' ? GATE_MS : GATE_MS * 2

  it('stays within the median budget for a full key pass and a one-table-moved pass', async () => {
    // Best of 3 attempts, spaced apart, so one CPU spike does not fail it.
    let best = measure()
    for (let a = 1; a < 3; a++) {
      if (best.fullMedian <= budget && best.movedMedian <= budget) break
      await new Promise((resolve) => setTimeout(resolve, 500))
      const next = measure()
      if (
        next.movedMedian + next.fullMedian <
        best.movedMedian + best.fullMedian
      )
        best = next
    }
    console.info(
      `perf budget=${budget}ms cold=${best.coldMs.toFixed(1)}ms fullMedian=${best.fullMedian.toFixed(2)}ms ` +
        `movedMedian=${best.movedMedian.toFixed(2)}ms reRouted(last)=${best.reRouted}`,
    )
    expect(best.fullMedian).toBeLessThanOrEqual(budget)
    expect(best.movedMedian).toBeLessThanOrEqual(budget)
  })
})

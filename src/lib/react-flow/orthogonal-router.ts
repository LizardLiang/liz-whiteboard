// src/lib/react-flow/orthogonal-router.ts
// Pure orthogonal router for relationship edges. Builds a grid of candidate
// lines from padded table rectangles and searches it with A*
// (cost = Manhattan length + a penalty per bend). It also picks the left/right
// side of each end by scoring all four side pairs.
//
// No React, no xyflow: only plain geometry in, a polyline out. The same input
// always gives the same output. Peers draw the same route for the same
// geometry as long as they route the edge from scratch; once an edge re-routes
// during a drag, `currentSides` (the side pair that peer last drew) adds the
// STICKY bonus, so two peers with different histories can pick different sides
// when two side pairs cost within STICKY px of each other.

import type { Point, Rect } from './edge-label-placement'

export type RouteSide = 'left' | 'right'

/** Clear space between a route and any table. Marker reach 13 px + 3 px air. */
export const ROUTE_MARGIN = 16
/** Length of the straight horizontal run that leaves and enters a port. */
export const ROUTE_STUB = 16
/** Shortest stub: the cardinality marker reach (CROW_LENGTH 2 + OPT_GAP 7 + CIRCLE_R 4). */
export const MIN_STUB = 13
/**
 * Reduced clearances tried, in order, when the full margin leaves no route.
 * A side is usable while port-to-neighbour space >= stub + margin. The floor is
 * a 13 px stub and a 3 px margin: the route still clears every unpadded table.
 */
export const CLEARANCE_LADDER: ReadonlyArray<{ margin: number; stub: number }> =
  [
    { margin: 12, stub: 15 },
    { margin: 9, stub: MIN_STUB },
    { margin: 6, stub: MIN_STUB },
    { margin: 3, stub: MIN_STUB },
  ]
/** Cost, in px of path length, of one direction change. */
export const BEND_PENALTY = 40
/** A different side pair must be cheaper than the current one by more than this. */
export const STICKY = 24
/** The routing window is the endpoint bbox grown by this many px. */
export const WINDOW_EXPAND = 200
/** Hard cap on A* expansions per side pair. */
export const MAX_EXPANSIONS = 12000
/**
 * Largest grid (columns x rows) the router builds; a bigger one returns null
 * and the edge draws the smooth-step fallback. The A* state arrays hold 4
 * directions per cell and 16 bytes per state, so 160 000 cells is about 10 MB
 * of scratch. Building and filling the grid also grows with the cell count, so
 * the cap bounds the worst case a full-board retry on a very dense board can
 * cost in one drag frame.
 */
export const MAX_GRID_CELLS = 160_000
/** Scratch (A* states) kept between searches; a bigger buffer is released after the route. */
const SCRATCH_KEEP_STATES = 65_536

export interface PortPair {
  left: Point
  right: Point
}

export interface RouteEnd {
  rect: Rect
  /** Absolute centre of the left and right handle of the connected column. */
  ports: PortPair
}

export interface RouteInput {
  source: RouteEnd
  target: RouteEnd
  /** Every table rect on the board, in absolute coordinates. */
  obstacles: ReadonlyArray<Rect>
  margin?: number
  stub?: number
  currentSides?: { source: RouteSide; target: RouteSide }
  bendPenalty?: number
  sticky?: number
  windowExpand?: number
  maxExpansions?: number
}

export interface RouteResult {
  /** Port to port, collinear points merged. */
  points: Array<Point>
  sourceSide: RouteSide
  targetSide: RouteSide
  cost: number
  /** True when the window had no route and the full board was searched. */
  expanded: boolean
}

const SIDE_PAIRS: ReadonlyArray<[RouteSide, RouteSide]> = [
  ['left', 'left'],
  ['left', 'right'],
  ['right', 'left'],
  ['right', 'right'],
]

interface PRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  )
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/**
 * True when the axis-aligned segment a-b passes through the open interior of
 * the rect. Touching the border is not a hit.
 */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return x0 < r.x + r.width && x1 > r.x && y0 < r.y + r.height && y1 > r.y
}

/**
 * True when no segment of the polyline passes through the interior of any
 * rect. The one definition of "stays clear of unpadded tables" the router, the
 * parallel-line nudge and the tests share.
 */
export function routeClearsRects(
  points: ReadonlyArray<Point>,
  rects: ReadonlyArray<Rect>,
): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    for (const r of rects) {
      if (segmentHitsRect(points[i], points[i + 1], r)) return false
    }
  }
  return true
}

function inputIsFinite(input: RouteInput): boolean {
  const { source, target } = input
  return (
    isFiniteRect(source.rect) &&
    isFiniteRect(target.rect) &&
    isFinitePoint(source.ports.left) &&
    isFinitePoint(source.ports.right) &&
    isFinitePoint(target.ports.left) &&
    isFinitePoint(target.ports.right) &&
    input.obstacles.every(isFiniteRect)
  )
}

function pad(r: Rect, m: number): PRect {
  return {
    x0: r.x - m,
    y0: r.y - m,
    x1: r.x + r.width + m,
    y1: r.y + r.height + m,
  }
}

function windowOf(input: RouteInput, margin: number, expand: number): PRect {
  const a = pad(input.source.rect, margin)
  const b = pad(input.target.rect, margin)
  return {
    x0: Math.min(a.x0, b.x0) - expand,
    y0: Math.min(a.y0, b.y0) - expand,
    x1: Math.max(a.x1, b.x1) + expand,
    y1: Math.max(a.y1, b.y1) + expand,
  }
}

/** Obstacles whose padded rect intersects the routing window (endpoints always included). */
export function windowObstacles(input: RouteInput): Array<Rect> {
  const margin = input.margin ?? ROUTE_MARGIN
  const w = windowOf(input, margin, input.windowExpand ?? WINDOW_EXPAND)
  const out: Array<Rect> = []
  let hasSource = false
  let hasTarget = false
  for (const o of input.obstacles) {
    if (sameRect(o, input.source.rect)) hasSource = true
    if (sameRect(o, input.target.rect)) hasTarget = true
    const p = pad(o, margin)
    if (p.x0 < w.x1 && w.x0 < p.x1 && p.y0 < w.y1 && w.y0 < p.y1) out.push(o)
  }
  if (!hasSource) out.push(input.source.rect)
  if (!hasTarget && !sameRect(input.source.rect, input.target.rect)) {
    out.push(input.target.rect)
  }
  return out
}

/**
 * Cache key for a route: the rounded endpoint rects, ports, current sides and
 * every obstacle in the routing window. Equal keys mean the route is unchanged.
 */
export function routeKeyFor(input: RouteInput): string {
  const obs = windowObstacles(input).map(keyRect).sort().join(';')
  return `${routeKeyHead(input)}#${obs}`
}

function keyRect(q: Rect): string {
  const r = Math.round
  return `${r(q.x)},${r(q.y)},${r(q.width)},${r(q.height)}`
}

/** The obstacle part of a whole-board key; build it once per pass, not per edge. */
export function boardKeyFor(obstacles: ReadonlyArray<Rect>): string {
  return obstacles.map(keyRect).sort().join(';')
}

/** The endpoint rects, ports and current sides of a route key. */
export function routeKeyHead(input: RouteInput): string {
  const r = Math.round
  const pt = (p: Point) => `${r(p.x)},${r(p.y)}`
  const ends = [input.source, input.target]
    .map((e) => `${keyRect(e.rect)}|${pt(e.ports.left)}|${pt(e.ports.right)}`)
    .join(';')
  const sides = input.currentSides
    ? `${input.currentSides.source[0]}${input.currentSides.target[0]}`
    : '-'
  return `${ends}#${sides}`
}

// ---------------------------------------------------------------------------
// Grid

interface Grid {
  xs: Array<number>
  ys: Array<number>
  nx: number
  ny: number
  /** Node strictly inside a padded rect. */
  nodeBlocked: Uint8Array
  /** Edge (i,j)-(i+1,j) crosses a padded interior; index i*ny+j. */
  hBlocked: Uint8Array
  /** Edge (i,j)-(i,j+1) crosses a padded interior; index i*ny+j. */
  vBlocked: Uint8Array
}

function sortedUnique(values: Array<number>): Array<number> {
  values.sort((a, b) => a - b)
  const out: Array<number> = []
  for (const v of values)
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v)
  return out
}

function buildGrid(
  padded: ReadonlyArray<PRect>,
  extraXs: ReadonlyArray<number>,
  extraYs: ReadonlyArray<number>,
): Grid | null {
  const xv: Array<number> = [...extraXs]
  const yv: Array<number> = [...extraYs]
  for (const p of padded) {
    xv.push(p.x0, p.x1)
    yv.push(p.y0, p.y1)
  }
  // Channel centres: the midpoint of the gap between two facing obstacles.
  for (let a = 0; a < padded.length; a++) {
    for (let b = 0; b < padded.length; b++) {
      if (a === b) continue
      const p = padded[a]
      const q = padded[b]
      if (p.x1 < q.x0 && p.y0 < q.y1 && q.y0 < p.y1) xv.push((p.x1 + q.x0) / 2)
      if (p.y1 < q.y0 && p.x0 < q.x1 && q.x0 < p.x1) yv.push((p.y1 + q.y0) / 2)
    }
  }
  const xs = sortedUnique(xv)
  const ys = sortedUnique(yv)
  const nx = xs.length
  const ny = ys.length
  if (nx * ny > MAX_GRID_CELLS) return null
  const xi = new Map<number, number>()
  const yi = new Map<number, number>()
  xs.forEach((v, i) => xi.set(v, i))
  ys.forEach((v, i) => yi.set(v, i))
  const nodeBlocked = new Uint8Array(nx * ny)
  const hBlocked = new Uint8Array(nx * ny)
  const vBlocked = new Uint8Array(nx * ny)
  for (const p of padded) {
    const ix0 = xi.get(p.x0)!
    const ix1 = xi.get(p.x1)!
    const iy0 = yi.get(p.y0)!
    const iy1 = yi.get(p.y1)!
    for (let i = ix0; i <= ix1; i++) {
      const interiorX = i > ix0 && i < ix1
      for (let j = iy0; j <= iy1; j++) {
        const interiorY = j > iy0 && j < iy1
        if (interiorX && interiorY) nodeBlocked[i * ny + j] = 1
        if (interiorY && i < ix1) hBlocked[i * ny + j] = 1
        if (interiorX && j < iy1) vBlocked[i * ny + j] = 1
      }
    }
  }
  return { xs, ys, nx, ny, nodeBlocked, hBlocked, vBlocked }
}

// ---------------------------------------------------------------------------
// A*

const DX = [1, -1, 0, 0]
const DY = [0, 0, 1, -1]
const OPPOSITE = [1, 0, 3, 2]
const EAST = 0
const WEST = 1

/** Min-heap of (f, state) pairs; ties break on the state id, so it is deterministic. */
class Heap {
  private f: Array<number> = []
  private s: Array<number> = []
  get size(): number {
    return this.f.length
  }
  clear(): void {
    this.f.length = 0
    this.s.length = 0
  }
  private less(a: number, b: number): boolean {
    return (
      this.f[a] < this.f[b] ||
      (this.f[a] === this.f[b] && this.s[a] < this.s[b])
    )
  }
  private swap(a: number, b: number): void {
    const tf = this.f[a]
    this.f[a] = this.f[b]
    this.f[b] = tf
    const ts = this.s[a]
    this.s[a] = this.s[b]
    this.s[b] = ts
  }
  push(f: number, s: number): void {
    this.f.push(f)
    this.s.push(s)
    let i = this.f.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }
  /** Pops the smallest entry; read it from `topF` / `topS` afterwards. */
  topF = 0
  topS = 0
  pop(): void {
    this.topF = this.f[0]
    this.topS = this.s[0]
    const lastF = this.f.pop()!
    const lastS = this.s.pop()!
    const n = this.f.length
    if (n === 0) return
    this.f[0] = lastF
    this.s[0] = lastS
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < n && this.less(l, m)) m = l
      if (r < n && this.less(r, m)) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
  }
}

const heap = new Heap()
let gScratch = new Float64Array(0)
let parentScratch = new Int32Array(0)
// A state's g value is valid only when its stamp equals the current search
// number, so a search never clears the whole scratch array.
let stampScratch = new Uint32Array(0)
let searchNumber = 0

/** Drop A* scratch that an oversized search grew, so one dense board does not pin memory. */
function releaseOversizedScratch(): void {
  if (gScratch.length <= SCRATCH_KEEP_STATES) return
  gScratch = new Float64Array(0)
  parentScratch = new Int32Array(0)
  stampScratch = new Uint32Array(0)
  searchNumber = 0
  heap.clear()
}

/** A* states the scratch buffers hold right now. */
export function scratchStates(): number {
  return gScratch.length
}

interface SearchResult {
  nodes: Array<Point>
  cost: number
}

function search(
  grid: Grid,
  start: Point,
  startDir: number,
  goal: Point,
  finalDir: number,
  bend: number,
  midX: number,
  maxExpansions: number,
  bound: number = Infinity,
): SearchResult | null {
  const { xs, ys, nx, ny } = grid
  const si = xs.indexOf(start.x)
  const sj = ys.indexOf(start.y)
  const gi = xs.indexOf(goal.x)
  const gj = ys.indexOf(goal.y)
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return null
  if (grid.nodeBlocked[si * ny + sj] || grid.nodeBlocked[gi * ny + gj])
    return null

  const total = nx * ny * 4
  if (gScratch.length < total) {
    gScratch = new Float64Array(total)
    parentScratch = new Int32Array(total)
    stampScratch = new Uint32Array(total)
    searchNumber = 0
  }
  const g = gScratch
  const parent = parentScratch
  const stamp = stampScratch
  const run = ++searchNumber
  const gOf = (state: number) => (stamp[state] === run ? g[state] : Infinity)
  heap.clear()

  const gx = goal.x
  const gy = goal.y
  // Manhattan distance plus the bend the goal position forces at the least.
  const h = (i: number, j: number, d: number) => {
    const dx = xs[i] - gx
    const dy = ys[j] - gy
    const dist = Math.abs(dx) + Math.abs(dy)
    if (dist === 0) return 0
    const horizontal = d < 2
    const bends =
      dx === 0 ? (horizontal ? 1 : 0) : dy === 0 ? (horizontal ? 0 : 1) : 1
    return dist + bends * bend
  }

  const startState = (si * ny + sj) * 4 + startDir
  g[startState] = 0
  stamp[startState] = run
  parent[startState] = -1
  heap.push(h(si, sj, startDir), startState)

  let expansions = 0
  while (heap.size > 0) {
    heap.pop()
    const f = heap.topF
    const s = heap.topS
    if (s >= total) {
      // Terminal entry for state s - total: the goal was reached with the final bend paid.
      const end = s - total
      const nodes: Array<Point> = []
      for (let cur = end; cur !== -1; cur = parent[cur]) {
        const node = cur >> 2
        nodes.push({ x: xs[Math.floor(node / ny)], y: ys[node % ny] })
      }
      nodes.reverse()
      return { nodes, cost: f }
    }
    const d = s & 3
    const node = s >> 2
    const i = Math.floor(node / ny)
    const j = node - i * ny
    if (f >= bound) return null
    if (f - h(i, j, d) > gOf(s) + 1e-9) continue
    if (++expansions > maxExpansions) return null

    if (i === gi && j === gj && d !== OPPOSITE[finalDir]) {
      const cost = gOf(s) + (d === finalDir ? 0 : bend)
      heap.push(cost, s + total)
    }

    for (let nd = 0; nd < 4; nd++) {
      if (nd === OPPOSITE[d]) continue
      const ni = i + DX[nd]
      const nj = j + DY[nd]
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue
      let blocked: number
      let len: number
      let step: number
      if (nd < 2) {
        blocked = grid.hBlocked[(nd === EAST ? i : ni) * ny + j]
        len = Math.abs(xs[ni] - xs[i])
        step = len
      } else {
        blocked = grid.vBlocked[i * ny + (nd === 2 ? j : nj)]
        len = Math.abs(ys[nj] - ys[j])
        // Tiny pull toward the centre column so ties settle mid-gap.
        step = len * (1 + 1e-4 * Math.abs(xs[i] - midX))
      }
      if (blocked || grid.nodeBlocked[ni * ny + nj]) continue
      const ng = gOf(s) + step + (nd === d ? 0 : bend)
      const ns = (ni * ny + nj) * 4 + nd
      if (ng < gOf(ns)) {
        g[ns] = ng
        stamp[ns] = run
        parent[ns] = s
        heap.push(ng + h(ni, nj, nd), ns)
      }
    }
  }
  return null
}

function simplify(points: ReadonlyArray<Point>): Array<Point> {
  const dedup: Array<Point> = []
  for (const p of points) {
    if (dedup.length === 0) {
      dedup.push(p)
      continue
    }
    const last = dedup[dedup.length - 1]
    if (last.x !== p.x || last.y !== p.y) dedup.push(p)
  }
  const out: Array<Point> = []
  for (const p of dedup) {
    while (out.length >= 2) {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))
        out.pop()
      else break
    }
    out.push(p)
  }
  return out
}

function routeInWindow(
  input: RouteInput,
  obstacles: ReadonlyArray<Rect>,
): Omit<RouteResult, 'expanded'> | null {
  const margin = input.margin ?? ROUTE_MARGIN
  const stub = input.stub ?? ROUTE_STUB
  const bend = input.bendPenalty ?? BEND_PENALTY
  const sticky = input.sticky ?? STICKY
  const maxExp = input.maxExpansions ?? MAX_EXPANSIONS
  const { source, target } = input

  const stubOf = (end: RouteEnd, side: RouteSide): Point => {
    const p = end.ports[side]
    return { x: side === 'left' ? p.x - stub : p.x + stub, y: p.y }
  }
  const sStub = { left: stubOf(source, 'left'), right: stubOf(source, 'right') }
  const tStub = { left: stubOf(target, 'left'), right: stubOf(target, 'right') }

  const padded = obstacles.map((o) => pad(o, margin))
  const extraXs = [sStub.left.x, sStub.right.x, tStub.left.x, tStub.right.x]
  const extraYs = [
    source.ports.left.y,
    source.ports.right.y,
    target.ports.left.y,
    target.ports.right.y,
  ]
  extraXs.push(
    (sStub.left.x + sStub.right.x + tStub.left.x + tStub.right.x) / 4,
  )
  const grid = buildGrid(padded, extraXs, extraYs)
  if (!grid) return null
  const midX = extraXs[extraXs.length - 1]

  type PairResult = { pair: number; cost: number; nodes: Array<Point> }
  const searchPair = (k: number, bound: number): PairResult | null => {
    const [ss, ts] = SIDE_PAIRS[k]
    const r = search(
      grid,
      sStub[ss],
      ss === 'left' ? WEST : EAST,
      tStub[ts],
      // The last leg runs from the stub toward the table.
      ts === 'left' ? EAST : WEST,
      bend,
      midX,
      maxExp,
      bound,
    )
    return r ? { pair: k, cost: r.cost, nodes: r.nodes } : null
  }

  // The current side pair is kept unless another pair is cheaper by more than
  // `sticky`, so the other pairs only matter below that bound. Searching the
  // current pair first lets the others stop as soon as they cannot beat it.
  const cur = input.currentSides
    ? SIDE_PAIRS.findIndex(
        ([a, b]) =>
          a === input.currentSides!.source && b === input.currentSides!.target,
      )
    : -1
  const curR = cur >= 0 ? searchPair(cur, Infinity) : null
  const bound = curR ? curR.cost - sticky : Infinity
  let best: PairResult | null = null
  for (let k = 0; k < SIDE_PAIRS.length; k++) {
    if (k === cur && curR) continue
    const r = searchPair(k, bound)
    if (r && r.cost < bound && (!best || r.cost < best.cost)) best = r
  }
  if (!best) best = curR
  if (!best) return null

  const [ss, ts] = SIDE_PAIRS[best.pair]
  const points = simplify([source.ports[ss], ...best.nodes, target.ports[ts]])
  return { points, sourceSide: ss, targetSide: ts, cost: best.cost }
}

function routeAtClearance(input: RouteInput): RouteResult | null {
  const { source, target } = input
  const local = windowObstacles(input)
  const inWindow = routeInWindow(input, local)
  // The window grid is built from the padded extents of the tables that touch
  // the window, so a line can run past the window edge through a table left
  // out of `local`. Accept a windowed route only when it clears every table.
  const covered = local.length >= input.obstacles.length
  if (
    inWindow &&
    (covered || routeClearsRects(inWindow.points, input.obstacles))
  ) {
    return { ...inWindow, expanded: false }
  }
  if (covered) return null
  const all = [...input.obstacles]
  if (!all.some((o) => sameRect(o, source.rect))) all.push(source.rect)
  if (!all.some((o) => sameRect(o, target.rect))) all.push(target.rect)
  const full = routeInWindow(input, all)
  return full ? { ...full, expanded: true } : null
}

/**
 * True when at least one side of the end can hold the shortest stub: the stub
 * end lies outside every obstacle padded by the smallest ladder margin.
 */
function endHasRoom(
  end: RouteEnd,
  obstacles: ReadonlyArray<Rect>,
  floorMargin: number,
): boolean {
  const padded = obstacles.map((o) => pad(o, floorMargin))
  return (['left', 'right'] as const).some((side) => {
    const p = end.ports[side]
    const x = side === 'left' ? p.x - MIN_STUB : p.x + MIN_STUB
    return !padded.some((q) => x > q.x0 && x < q.x1 && p.y > q.y0 && p.y < q.y1)
  })
}

/**
 * Route one relationship. Returns null when the input is invalid (non-finite,
 * overlapping endpoint tables) or no route exists, so the caller can fall back.
 * With the full clearance first, then each smaller one in CLEARANCE_LADDER, the
 * first clearance that has a route wins; every route clears the unpadded tables.
 */
export function routeEdge(input: RouteInput): RouteResult | null {
  try {
    return routeEdgeUnguarded(input)
  } finally {
    releaseOversizedScratch()
  }
}

function routeEdgeUnguarded(input: RouteInput): RouteResult | null {
  if (!inputIsFinite(input)) return null
  const { source, target } = input
  if (
    !sameRect(source.rect, target.rect) &&
    rectsOverlap(source.rect, target.rect)
  ) {
    return null
  }
  const full = routeAtClearance(input)
  if (full) return full
  const margin = input.margin ?? ROUTE_MARGIN
  const stub = input.stub ?? ROUTE_STUB
  // No retry can help when an end has no side that holds the shortest stub.
  const floor = CLEARANCE_LADDER[CLEARANCE_LADDER.length - 1].margin
  if (
    !endHasRoom(source, input.obstacles, floor) ||
    !endHasRoom(target, input.obstacles, floor)
  ) {
    return null
  }
  for (const level of CLEARANCE_LADDER) {
    if (level.margin >= margin && level.stub >= stub) continue
    const reduced = routeAtClearance({
      ...input,
      margin: Math.min(margin, level.margin),
      stub: Math.min(stub, level.stub),
    })
    if (reduced) return reduced
  }
  return null
}

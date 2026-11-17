/**
 * Edge Route Pass
 *
 * The part of recalculateEdgeRouting that runs the orthogonal router for every
 * relationship edge, caches each route behind a `routeKey`, and nudges
 * parallel lines apart. Pure: nodes and handle geometry in, edges out.
 *
 * Routes depend on tables that are not the edge's own endpoints, so the pass
 * checks EVERY edge's key, not only edges attached to a moved table.
 */

import { createColumnHandleId, parseColumnHandleId } from './edge-routing'
import { ROUTE_STUB, routeEdge, routeKeyFor } from './orthogonal-router'
import type { Node } from '@xyflow/react'
import type { Point, Rect } from './edge-label-placement'
import type { RouteInput, RouteSide } from './orthogonal-router'
import type { RelationshipEdgeType, TableNodeData } from './types'
import { EDGE_SEP } from '@/lib/auto-layout/d3-force-layout'

/** Segments within this many px of the same y (or x) share a corridor. */
const CORRIDOR_BUCKET = 8
/** Largest shift (px) a segment moves when parallel lines are spread. 5 lines at EDGE_SEP fit. */
export const NUDGE_MAX = 2 * EDGE_SEP
/** Prefix of a `routeKey` computed over the whole board instead of the routing window. */
const FULL_KEY_PREFIX = 'X|'

/** Offsets of a column's handle centres from the node's top-left corner. */
export interface PortOffsets {
  left: Point
  right: Point
}

/** Handle geometry the pass cannot read from the node objects. */
export interface RouteGeometry {
  /** Null when the handle is not measured yet; the edge then keeps its fallback path. */
  getPortOffsets: (
    nodeId: string,
    columnId: string,
    type: 'source' | 'target',
  ) => PortOffsets | null
  /** Table rects not in `nodes` (for example reference nodes), by absolute position. */
  getExtraObstacles?: (excludeIds: ReadonlySet<string>) => Array<Rect>
}

function measuredRect(node: Node): Rect | null {
  const w = node.measured?.width ?? node.width
  const h = node.measured?.height ?? node.height
  if (!w || !h) return null
  return { x: node.position.x, y: node.position.y, width: w, height: h }
}

function sidesOf(
  edge: RelationshipEdgeType,
): { source: RouteSide; target: RouteSide } | undefined {
  const s = edge.sourceHandle ? parseColumnHandleId(edge.sourceHandle) : null
  const t = edge.targetHandle ? parseColumnHandleId(edge.targetHandle) : null
  return s && t ? { source: s.side, target: t.side } : undefined
}

function pointsEqual(
  a: ReadonlyArray<Point> | undefined,
  b: ReadonlyArray<Point> | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((p, i) => p.x === b[i].x && p.y === b[i].y)
}

interface Stage {
  edge: RelationshipEdgeType
  base: Array<Point> | undefined
}

/**
 * Route every edge whose key changed. `original` is the edge array before the
 * fallback side pass (it holds the cached routes), `fallback` is the same array
 * after it. Returns edges with `route`, `routeBase`, `routeKey` and the handle
 * ids of the chosen sides written. The array is always a fresh one; unchanged
 * edges keep their object identity.
 */
export function applyEdgeRoutes(
  original: Array<RelationshipEdgeType>,
  fallback: Array<RelationshipEdgeType>,
  nodes: Array<Node<TableNodeData>>,
  handleYOffsets: Map<string, { handleYOffset: number }>,
  geometry: RouteGeometry,
): Array<RelationshipEdgeType> {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const obstacles: Array<Rect> = []
  for (const n of nodes) {
    if (n.type !== 'table' && n.type !== 'externalTable') continue
    if (n.hidden) continue
    const r = measuredRect(n)
    if (r) obstacles.push(r)
  }
  if (geometry.getExtraObstacles) {
    obstacles.push(...geometry.getExtraObstacles(new Set(nodesById.keys())))
  }

  const stages: Array<Stage> = original.map((orig, i) => {
    const fb = fallback[i]
    const rel = orig.data?.relationship
    if (!orig.data || !rel) return { edge: fb, base: undefined }
    const src = nodesById.get(orig.source)
    const tgt = nodesById.get(orig.target)
    if (!src || !tgt) return { edge: fb, base: undefined }
    const srcRect = measuredRect(src)
    const tgtRect = measuredRect(tgt)
    const srcOff = geometry.getPortOffsets(
      orig.source,
      rel.sourceColumnId,
      'source',
    )
    const tgtOff = geometry.getPortOffsets(
      orig.target,
      rel.targetColumnId,
      'target',
    )
    if (!srcRect || !tgtRect || !srcOff || !tgtOff) {
      return { edge: fb, base: orig.data.routeBase }
    }

    const dy = handleYOffsets.get(orig.id)?.handleYOffset ?? 0
    const ports = (rect: Rect, off: PortOffsets) => ({
      left: { x: rect.x + off.left.x, y: rect.y + off.left.y + dy },
      right: { x: rect.x + off.right.x, y: rect.y + off.right.y + dy },
    })
    const input: RouteInput = {
      source: { rect: srcRect, ports: ports(srcRect, srcOff) },
      target: { rect: tgtRect, ports: ports(tgtRect, tgtOff) },
      obstacles,
      currentSides: sidesOf(orig),
    }

    const stored = orig.data.routeKey
    const current = stored?.startsWith(FULL_KEY_PREFIX)
      ? FULL_KEY_PREFIX + routeKeyFor({ ...input, windowExpand: Infinity })
      : routeKeyFor(input)
    if (stored === current) {
      // A cached failure keeps today's fallback sides; a cached route keeps its own.
      return orig.data.routeBase
        ? { edge: orig, base: orig.data.routeBase }
        : { edge: fb, base: undefined }
    }

    const result = routeEdge(input)
    if (!result) {
      const { route: _r, routeBase: _b, ...rest } = fb.data ?? orig.data
      return {
        edge: {
          ...fb,
          data: {
            ...rest,
            routeKey: routeKeyFor({ ...input, currentSides: sidesOf(fb) }),
          },
        },
        base: undefined,
      }
    }
    const sides = { source: result.sourceSide, target: result.targetSide }
    const key =
      (result.expanded ? FULL_KEY_PREFIX : '') +
      routeKeyFor({
        ...input,
        currentSides: sides,
        windowExpand: result.expanded ? Infinity : undefined,
      })
    return {
      edge: {
        ...fb,
        sourceHandle: createColumnHandleId(
          orig.source,
          rel.sourceColumnId,
          result.sourceSide,
          'source',
        ),
        targetHandle: createColumnHandleId(
          orig.target,
          rel.targetColumnId,
          result.targetSide,
          'target',
        ),
        data: {
          ...(fb.data ?? orig.data),
          routeBase: result.points,
          routeKey: key,
        },
      },
      base: result.points,
    }
  })

  const routes = nudgeRoutes(
    stages.flatMap((s, i) =>
      s.base ? [{ id: original[i].id, base: s.base }] : [],
    ),
  )

  return stages.map((s, i) => {
    const orig = original[i]
    if (!s.edge.data) return s.edge
    const route = s.base ? routes.get(orig.id) : undefined
    if (!s.base) {
      // Keep a stale cached route only when routing was skipped (no geometry).
      return s.edge
    }
    if (s.edge === orig && pointsEqual(orig.data?.route, route)) return orig
    return { ...s.edge, data: { ...s.edge.data, route } }
  })
}

interface Seg {
  id: string
  k: number
  horizontal: boolean
  /** y for a horizontal segment, x for a vertical one. */
  c: number
  lo: number
  hi: number
}

/** Allowed shift range of segment k so its neighbours keep a sane length. */
function shiftRange(
  pts: ReadonlyArray<Point>,
  k: number,
  horizontal: boolean,
): [number, number] {
  let lo = -NUDGE_MAX
  let hi = NUDGE_MAX
  const last = pts.length - 2
  for (const j of [k - 1, k + 1]) {
    const a = pts[j]
    const b = pts[j + 1]
    // The point shared with segment k moves along the neighbour's axis.
    const shared = j === k - 1 ? b : a
    const other = j === k - 1 ? a : b
    const sc = horizontal ? shared.y : shared.x
    const oc = horizontal ? other.y : other.x
    const len = Math.abs(sc - oc)
    const sign = sc >= oc ? 1 : -1
    // A stub keeps its full length; a movable neighbour may shrink to half.
    const minLen = j === 0 || j === last ? Math.min(len, ROUTE_STUB) : len / 2
    // New length = len + sign * d, and it must stay >= minLen.
    if (sign > 0) lo = Math.max(lo, minLen - len)
    else hi = Math.min(hi, len - minLen)
  }
  return [lo, hi]
}

/**
 * Spread parallel segments of different edges that share a corridor. Segments
 * are grouped by rounded y (horizontal) or x (vertical) and overlapping range.
 * The first and last segment of a route never move (they hold the ports and
 * stubs). Returns the nudged route per edge id.
 */
export function nudgeRoutes(
  items: ReadonlyArray<{ id: string; base: ReadonlyArray<Point> }>,
): Map<string, Array<Point>> {
  const out = new Map<string, Array<Point>>()
  for (const it of items)
    out.set(
      it.id,
      it.base.map((p) => ({ ...p })),
    )

  const buckets = new Map<string, Array<Seg>>()
  for (const it of items) {
    const pts = it.base
    for (let k = 1; k <= pts.length - 3; k++) {
      const a = pts[k]
      const b = pts[k + 1]
      const horizontal = a.y === b.y
      if (!horizontal && a.x !== b.x) continue
      const seg: Seg = horizontal
        ? {
            id: it.id,
            k,
            horizontal,
            c: a.y,
            lo: Math.min(a.x, b.x),
            hi: Math.max(a.x, b.x),
          }
        : {
            id: it.id,
            k,
            horizontal,
            c: a.x,
            lo: Math.min(a.y, b.y),
            hi: Math.max(a.y, b.y),
          }
      const key = `${horizontal ? 'h' : 'v'}${Math.round(seg.c / CORRIDOR_BUCKET)}`
      const list = buckets.get(key)
      if (list) list.push(seg)
      else buckets.set(key, [seg])
    }
  }

  const baseOf = new Map(items.map((it) => [it.id, it.base]))
  const bucketKeys = [...buckets.keys()].sort()
  for (const key of bucketKeys) {
    const segs = buckets.get(key)!
    if (segs.length < 2) continue
    segs.sort((a, b) => a.lo - b.lo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    let cluster: Array<Seg> = []
    let clusterHi = -Infinity
    const flush = () => {
      if (cluster.length >= 2) spreadCluster(cluster, baseOf, out)
      cluster = []
      clusterHi = -Infinity
    }
    for (const s of segs) {
      if (cluster.length > 0 && s.lo >= clusterHi) flush()
      cluster.push(s)
      clusterHi = Math.max(clusterHi, s.hi)
    }
    flush()
  }
  return out
}

function spreadCluster(
  cluster: Array<Seg>,
  baseOf: Map<string, ReadonlyArray<Point>>,
  out: Map<string, Array<Point>>,
): void {
  const sorted = [...cluster].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : a.k - b.k,
  )
  const n = sorted.length
  for (let i = 0; i < n; i++) {
    const s = sorted[i]
    const wanted = (i - (n - 1) / 2) * EDGE_SEP
    const [lo, hi] = shiftRange(baseOf.get(s.id)!, s.k, s.horizontal)
    const d = Math.min(Math.max(wanted, lo), hi)
    if (d === 0) continue
    const pts = out.get(s.id)!
    if (s.horizontal) {
      pts[s.k].y += d
      pts[s.k + 1].y += d
    } else {
      pts[s.k].x += d
      pts[s.k + 1].x += d
    }
  }
}

/**
 * Props sync rebuilds edges from the server data, which carries no route. Copy
 * the last route, its key and the handle ids from the edges on screen, so the
 * pass keeps a still-valid route (and its sides) instead of routing from
 * scratch and flipping a side the user just saw.
 */
export function carryRoutes(
  fresh: Array<RelationshipEdgeType>,
  previous: ReadonlyArray<{ id: string; type?: string }>,
): Array<RelationshipEdgeType> {
  const prevById = new Map<string, RelationshipEdgeType>()
  for (const e of previous) {
    if (e.type === 'relationship') prevById.set(e.id, e as RelationshipEdgeType)
  }
  return fresh.map((edge) => {
    const prev = prevById.get(edge.id)
    if (!prev?.data?.routeKey || !edge.data) return edge
    return {
      ...edge,
      sourceHandle: prev.sourceHandle,
      targetHandle: prev.targetHandle,
      data: {
        ...edge.data,
        route: prev.data.route,
        routeBase: prev.data.routeBase,
        routeKey: prev.data.routeKey,
      },
    }
  })
}

// src/lib/react-flow/edge-label-placement.ts
// Pure geometry for placing a relationship edge's label so it stays visible.
//
// On the main board the canvas layer paints tables ABOVE the React Flow
// renderer, which holds the edge labels. A label whose pill lands on a table
// rect is painted over and invisible. getSmoothStepPath has no obstacle
// avoidance, so its midpoint can land on a third table. This module slides the
// label along the edge's own path to the nearest point no table covers.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface LabelPlacementInput {
  /** SVG path from getSmoothStepPath: M, L and Q commands only. */
  path: string
  /** Preferred anchor (the path midpoint, after any same-side clamp). */
  mid: Point
  /** Outer size of the whole label box (pill plus delete button slot). */
  labelWidth: number
  labelHeight: number
  /** Table and cardinality-marker rects, absolute flow coordinates. */
  obstacles: ReadonlyArray<Rect>
  /** Clear space kept between the label box and any obstacle. */
  margin?: number
  /** Distance between candidate points along the path. */
  step?: number
}

export interface LabelPlacement {
  x: number
  y: number
  /**
   * True when no point on the whole path is free. The anchor is then `mid`
   * and the caller must draw the label above the canvas table layer.
   */
  covered: boolean
}

export const LABEL_OBSTACLE_MARGIN = 6
const DEFAULT_STEP = 4
const MAX_SAMPLES = 800
const CURVE_SEGMENTS = 8

/** Same fallbacks the edge routing uses when a node has no measured size. */
const FALLBACK_NODE_WIDTH = 250
const FALLBACK_NODE_HEIGHT = 100

/** Minimal slice of an xyflow InternalNode that the obstacle rect needs. */
export interface ObstacleNode {
  type?: string
  hidden?: boolean
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
  internals: { positionAbsolute: Point }
}

/**
 * Rect of a table or cross-file reference node in absolute flow coordinates,
 * or null for any other node type. Uses `internals.positionAbsolute`, never
 * `position`: an area member stores a position RELATIVE to its area.
 */
export function nodeObstacleRect(node: ObstacleNode): Rect | null {
  if (node.type !== 'table' && node.type !== 'externalTable') return null
  if (node.hidden) return null
  const { x, y } = node.internals.positionAbsolute
  return {
    x,
    y,
    width: node.measured?.width ?? node.width ?? FALLBACK_NODE_WIDTH,
    height: node.measured?.height ?? node.height ?? FALLBACK_NODE_HEIGHT,
  }
}

/** Parse a getSmoothStepPath string into a polyline (curves flattened). */
export function flattenSmoothPath(path: string): Array<Point> {
  const tokens = path.match(/[MLQ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const points: Array<Point> = []
  let i = 0
  let cmd = ''
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const tok = tokens[i]
    if (/^[MLQ]$/i.test(tok)) {
      cmd = tok.toUpperCase()
      i++
      continue
    }
    if (cmd === 'M' || cmd === 'L') {
      points.push({ x: num(), y: num() })
    } else if (cmd === 'Q') {
      const cx = num()
      const cy = num()
      const x = num()
      const y = num()
      const from = points[points.length - 1] ?? { x, y }
      for (let k = 1; k <= CURVE_SEGMENTS; k++) {
        const t = k / CURVE_SEGMENTS
        const u = 1 - t
        points.push({
          x: u * u * from.x + 2 * u * t * cx + t * t * x,
          y: u * u * from.y + 2 * u * t * cy + t * t * y,
        })
      }
    } else {
      i++
    }
  }
  return points
}

/** Points along the polyline every `step` px, each with its arc length. */
function samplePolyline(
  poly: ReadonlyArray<Point>,
  step: number,
): Array<{ x: number; y: number; s: number }> {
  const out: Array<{ x: number; y: number; s: number }> = []
  if (poly.length === 0) return out
  out.push({ ...poly[0], s: 0 })
  let travelled = 0
  let nextAt = step
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]
    const b = poly[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    while (len > 0 && nextAt <= travelled + len) {
      const t = (nextAt - travelled) / len
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        s: nextAt,
      })
      nextAt += step
    }
    travelled += len
  }
  const last = poly[poly.length - 1]
  if (out[out.length - 1].s < travelled) {
    out.push({ ...last, s: travelled })
  }
  return out
}

function boxHitsAny(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  obstacles: ReadonlyArray<Rect>,
): boolean {
  const left = cx - halfW
  const right = cx + halfW
  const top = cy - halfH
  const bottom = cy + halfH
  for (const o of obstacles) {
    if (
      left < o.x + o.width &&
      right > o.x &&
      top < o.y + o.height &&
      bottom > o.y
    ) {
      return true
    }
  }
  return false
}

/**
 * Pick the label anchor. Order of preference:
 *  1. `mid`, when its box touches no obstacle;
 *  2. the nearest free point along the path, measured by path distance from
 *     the path point closest to `mid`, searching both directions;
 *  3. `mid` with `covered: true` when every point is blocked.
 */
export function placeEdgeLabel(input: LabelPlacementInput): LabelPlacement {
  const {
    path,
    mid,
    labelWidth,
    labelHeight,
    obstacles,
    margin = LABEL_OBSTACLE_MARGIN,
  } = input
  const halfW = labelWidth / 2 + margin
  const halfH = labelHeight / 2 + margin

  if (!boxHitsAny(mid.x, mid.y, halfW, halfH, obstacles)) {
    return { x: mid.x, y: mid.y, covered: false }
  }

  const poly = flattenSmoothPath(path)
  let length = 0
  for (let i = 1; i < poly.length; i++) {
    length += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y)
  }
  const step = Math.max(input.step ?? DEFAULT_STEP, length / MAX_SAMPLES)
  const samples = samplePolyline(poly, step)
  if (samples.length === 0) return { x: mid.x, y: mid.y, covered: true }

  let nearest = 0
  let nearestDist = Infinity
  for (let i = 0; i < samples.length; i++) {
    const d = Math.hypot(samples[i].x - mid.x, samples[i].y - mid.y)
    if (d < nearestDist) {
      nearestDist = d
      nearest = i
    }
  }

  // Walk outward from the sample nearest the midpoint, alternating sides.
  // Samples are evenly spaced (bar the last), so index distance is path
  // distance; compare real arc length to pick the closer of the two sides.
  let back = nearest - 1
  let fwd = nearest + 1
  const s0 = samples[nearest].s
  while (back >= 0 || fwd < samples.length) {
    const backDist = back >= 0 ? s0 - samples[back].s : Infinity
    const fwdDist = fwd < samples.length ? samples[fwd].s - s0 : Infinity
    const pick = backDist <= fwdDist ? back-- : fwd++
    const p = samples[pick]
    if (!boxHitsAny(p.x, p.y, halfW, halfH, obstacles)) {
      return { x: p.x, y: p.y, covered: false }
    }
  }
  return { x: mid.x, y: mid.y, covered: true }
}

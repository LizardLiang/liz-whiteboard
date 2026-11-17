// src/lib/react-flow/orthogonal-path.ts
// SVG path for an orthogonal polyline with rounded corners. Emits M, L and Q
// commands only, the grammar flattenSmoothPath parses.

import type { Point } from './edge-label-placement'

export const ROUTE_CORNER_RADIUS = 16

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/** Rounded-corner path through `points`. Each corner radius is clamped to half the shorter adjacent segment. */
export function buildRoundedOrthogonalPath(
  points: ReadonlyArray<Point>,
  radius: number = ROUTE_CORNER_RADIUS,
): string {
  if (points.length === 0) return ''
  const first = points[0]
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.max(0, Math.min(radius, inLen / 2, outLen / 2))
    if (r === 0) {
      d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`
      continue
    }
    const ax = cur.x + ((prev.x - cur.x) / inLen) * r
    const ay = cur.y + ((prev.y - cur.y) / inLen) * r
    const bx = cur.x + ((next.x - cur.x) / outLen) * r
    const by = cur.y + ((next.y - cur.y) / outLen) * r
    d += ` L ${fmt(ax)} ${fmt(ay)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(bx)} ${fmt(by)}`
  }
  if (points.length > 1) {
    const last = points[points.length - 1]
    d += ` L ${fmt(last.x)} ${fmt(last.y)}`
  }
  return d
}

/** Point at half the total arc length of the polyline. */
export function pathMidpoint(points: ReadonlyArray<Point>): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    )
  }
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > 0 && left <= len) {
      const t = left / len
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= len
  }
  return { ...points[points.length - 1] }
}

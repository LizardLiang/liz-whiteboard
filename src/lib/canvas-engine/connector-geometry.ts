// src/lib/canvas-engine/connector-geometry.ts
// Where a connector's line actually runs (canvas quick-create-handles
// tactical plan, Wave 2, step 5).
//
// Nothing here is stored. A connector's path is recomputed from its two
// endpoint elements' CURRENT bounds every time it is drawn or hit-tested,
// which is what makes it follow a move or a resize with no edit of its own —
// and what makes a collaborator's drag correct on every other client for
// free. A stored path would be one more thing to keep in sync and one more
// thing to go stale.
//
// WORLD SPACE THROUGHOUT. This module never sees a `Camera` and never
// converts anything to screen pixels. W1 and W3 in this repo were both the
// same bug — a second, divergent transform written at a call site — and the
// structural answer is that geometry modules do not know screens exist.
//
// All three routings return a POLYLINE, including `curved`, which is sampled
// here rather than handed to the renderer as bezier control points. One
// output shape means the arrowhead, the hit-test and the bounds have a single
// implementation instead of three, and a sampled curve hit-tests correctly
// where a control-point curve would need its own root-finding.
//
// Pure module: no React, no DOM, no database, no canvas context.

import type { Point } from './camera'
import type { WorldRect } from './hit-test'
import type {
  CanvasConnectorRouting,
  ConnectorAnchor,
  ConnectorAttach,
} from './scene'

/**
 * One end of a connector, as GEOMETRY — the caller has already resolved an
 * attached endpoint's element into its live bounds.
 *
 * This module never sees a `Scene`, so it cannot do that lookup itself; that
 * is `hit-test.ts`'s `connectorPathOf`, which is the single place the whole
 * app converts a stored connector into a drawable path.
 *
 * `anchor` may be absent on a rect end — connectors predating anchoring carry
 * none — and each end falls back independently to a centre-derived border
 * point rather than the pair being all-or-nothing.
 */
export type EndpointGeometry =
  | { rect: WorldRect; attach?: ConnectorAttach }
  | { point: Point }

/** True for a free end — one that names no element and carries its own point. */
function isFree(end: EndpointGeometry): end is { point: Point } {
  return 'point' in end
}

/**
 * Where an end "is", before the other end is known.
 *
 * A free end is its point; an anchored end is its edge midpoint; an unanchored
 * rect falls back to its centre, which is exactly what the original
 * centre-to-centre derivation used.
 */
function referencePoint(end: EndpointGeometry): Point {
  if (isFree(end)) return end.point
  return end.attach ? attachPoint(end.rect, end.attach) : rectCentre(end.rect)
}

/** Where an end actually meets the line, given where the other end is. */
function resolveEnd(end: EndpointGeometry, other: Point): Point {
  if (isFree(end)) return end.point
  if (end.attach) return attachPoint(end.rect, end.attach)
  const centre = rectCentre(end.rect)
  return borderPoint(end.rect, { x: other.x - centre.x, y: other.y - centre.y })
}

/**
 * The direction an elbow or curve should LEAVE an end travelling.
 *
 * An anchored end has a real edge to depart perpendicular to. A free end has
 * no edge at all, so its direction is derived from the other end — snapped to
 * the dominant axis, because an elbow must stay orthogonal and a diagonal stub
 * would break that.
 */
function departureNormal(
  end: EndpointGeometry,
  self: Point,
  other: Point,
): Point {
  if (!isFree(end) && end.attach) return anchorNormal(attachSide(end.attach))
  const dx = self.x - other.x
  const dy = self.y - other.y
  if (dx === 0 && dy === 0) return { x: 1, y: 0 }
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 }
}

/**
 * True when the pair still takes the ORIGINAL centre-to-centre derivation:
 * two rect ends, neither anchored. Every other combination is resolved
 * per-end, so the legacy path — including its overlap-inversion null — is
 * preserved exactly for the connectors that predate all of this.
 */
function isLegacyPair(source: EndpointGeometry, target: EndpointGeometry): boolean {
  return !isFree(source) && !isFree(target) && !source.attach && !target.attach
}

/** Segments a `curved` connector is sampled into. 24 is smooth at 2x zoom. */
const CURVE_SAMPLES = 24

/**
 * How far a curve's control points are pushed off the endpoints, as a
 * fraction of the endpoint separation, and the range that fraction is held
 * to. Without the minimum, two adjacent elements get a curve
 * indistinguishable from a straight line; without the maximum, two far-apart
 * elements get a wild S-bend that leaves the screen.
 */
const CURVE_TENSION = 0.4
const CURVE_TENSION_MIN = 24
const CURVE_TENSION_MAX = 240

/** Arrowhead half-width as a fraction of its length. */
const ARROW_SPREAD = 0.45

/**
 * How far an elbow or curve pushes straight out of an anchored edge before it
 * is allowed to turn, in world units.
 *
 * Without it an anchored elbow turns the instant it leaves the border, which
 * reads as the line clipping the corner of its own element rather than
 * departing from it.
 */
const ANCHOR_STUB = 24

export function rectCentre(rect: WorldRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** The midpoint of one of a rect's four edges — where an anchored line meets it. */
export function anchorPoint(rect: WorldRect, anchor: ConnectorAnchor): Point {
  switch (anchor) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y }
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 }
  }
}

/** The world point a normalised border attachment resolves to. */
export function attachPoint(rect: WorldRect, attach: ConnectorAttach): Point {
  return {
    x: rect.x + rect.width * attach.x,
    y: rect.y + rect.height * attach.y,
  }
}

/**
 * Which EDGE a normalised attachment lies on.
 *
 * Needed because an elbow and a curve leave perpendicular to the border, and a
 * continuous position carries no side of its own. Corners belong to whichever
 * edge the point is exactly on; the ordering below makes that deterministic
 * rather than depending on floating-point luck.
 */
export function attachSide(attach: ConnectorAttach): ConnectorAnchor {
  if (attach.y <= 0) return 'top'
  if (attach.y >= 1) return 'bottom'
  if (attach.x <= 0) return 'left'
  return 'right'
}

/** The four edge midpoints, as attachments — what a creation handle produces. */
export const ANCHOR_ATTACH: Readonly<Record<ConnectorAnchor, ConnectorAttach>> =
  {
    top: { x: 0.5, y: 0 },
    right: { x: 1, y: 0.5 },
    bottom: { x: 0.5, y: 1 },
    left: { x: 0, y: 0.5 },
  }

/**
 * The point ON `rect`'s border nearest `toward`, normalised.
 *
 * This is what makes an end attachable ANYWHERE along an edge rather than only
 * at the four midpoints: the drop point is projected onto the closest border,
 * so the line meets the shape exactly where it was let go. A point inside the
 * rect is pushed out to whichever edge it is closest to, which is what a user
 * dropping in the middle of a shape means.
 */
export function nearestAttach(
  rect: WorldRect,
  toward: Point,
): ConnectorAttach {
  // Guard a degenerate box before dividing — a connector's own 1x1 placeholder
  // is never an attach target, but a zero-size element would divide by zero.
  const width = rect.width || 1
  const height = rect.height || 1
  const fx = Math.min(1, Math.max(0, (toward.x - rect.x) / width))
  const fy = Math.min(1, Math.max(0, (toward.y - rect.y) / height))

  // Distance to each edge in NORMALISED space, so a wide flat box does not
  // always snap to its long edge purely because it is longer.
  const toLeft = fx
  const toRight = 1 - fx
  const toTop = fy
  const toBottom = 1 - fy
  const nearest = Math.min(toLeft, toRight, toTop, toBottom)

  if (nearest === toLeft) return { x: 0, y: fy }
  if (nearest === toRight) return { x: 1, y: fy }
  if (nearest === toTop) return { x: fx, y: 0 }
  return { x: fx, y: 1 }
}

/** The unit vector pointing straight OUT of an anchored edge. */
export function anchorNormal(anchor: ConnectorAnchor): Point {
  switch (anchor) {
    case 'top':
      return { x: 0, y: -1 }
    case 'right':
      return { x: 1, y: 0 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
  }
}

/**
 * The side of `rect` whose edge midpoint sits closest to `toward`.
 *
 * This is how the TARGET end of a new connector picks its side: the element it
 * is joining is anchored on whichever face is nearest the end it is coming
 * from, which is the side a person would have drawn it to. Ties resolve in
 * `ANCHORS` order, which only matters for a point exactly equidistant from
 * two faces — any choice there looks the same.
 */
export function nearestAnchor(rect: WorldRect, toward: Point): ConnectorAnchor {
  let best: ConnectorAnchor = 'top'
  let bestDistance = Number.POSITIVE_INFINITY
  for (const anchor of ANCHORS) {
    const point = anchorPoint(rect, anchor)
    const distance = Math.hypot(point.x - toward.x, point.y - toward.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = anchor
    }
  }
  return best
}

const ANCHORS: ReadonlyArray<ConnectorAnchor> = [
  'top',
  'right',
  'bottom',
  'left',
]

/** Drop consecutive duplicate points — a zero-length segment gives the arrowhead no direction. */
function compact(points: Array<Point>): Array<Point> {
  return points.filter(
    (point, i) =>
      i === 0 || point.x !== points[i - 1].x || point.y !== points[i - 1].y,
  )
}

/**
 * Where a ray leaving `rect`'s centre in direction `d` crosses the rect's
 * border.
 *
 * Solved analytically rather than by stepping: for an axis-aligned rect the
 * exit is at the SMALLER of the two axis scale factors, because that is the
 * border the ray reaches first. A zero component means the ray is parallel to
 * that pair of edges and can never cross them, which is why it yields
 * Infinity rather than a division guard at the call site.
 */
export function borderPoint(rect: WorldRect, d: Point): Point {
  const centre = rectCentre(rect)
  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  const scaleX = d.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(d.x)
  const scaleY = d.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(d.y)
  const scale = Math.min(scaleX, scaleY)
  // Both infinite means `d` is the zero vector — the caller has already
  // rejected that case (see `endpoints`), but returning the centre is the
  // only non-NaN answer if one ever reaches here.
  if (!Number.isFinite(scale)) return centre
  return { x: centre.x + d.x * scale, y: centre.y + d.y * scale }
}

/**
 * The two points a straight connector runs between, or null when there is no
 * sensible line to draw.
 *
 * Each end is resolved against where the OTHER end is, so a half-anchored or
 * part-free connector still describes ONE line rather than two ends each
 * aiming somewhere different.
 *
 * Null is returned for the degenerate cases, and all of them are reachable by
 * ordinary use: two ends landing on the same point, and — for the legacy
 * centre-to-centre pair only — rects overlapping so far that each border point
 * lies past the other, which would render the segment inside-out. Drawing
 * nothing is the honest answer; the connector reappears the moment either end
 * moves.
 */
export function endpoints(
  source: EndpointGeometry,
  target: EndpointGeometry,
): { from: Point; to: Point } | null {
  if (isLegacyPair(source, target)) {
    // Unchanged from before anchoring and free ends existed. Kept verbatim
    // rather than folded into the general path below: this is what every
    // pre-existing connector still takes, and its overlap-inversion null is a
    // behaviour a "resolve each end against the other" variant quietly loses.
    const a = rectCentre((source as { rect: WorldRect }).rect)
    const b = rectCentre((target as { rect: WorldRect }).rect)
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx === 0 && dy === 0) return null

    const from = borderPoint((source as { rect: WorldRect }).rect, { x: dx, y: dy })
    const to = borderPoint((target as { rect: WorldRect }).rect, { x: -dx, y: -dy })
    const forward = (to.x - from.x) * dx + (to.y - from.y) * dy
    if (forward <= 0) return null
    return { from, to }
  }

  const from = resolveEnd(source, referencePoint(target))
  const to = resolveEnd(target, referencePoint(source))
  if (from.x === to.x && from.y === to.y) return null
  return { from, to }
}

/**
 * A right-angled path.
 *
 * With any anchored or free end, it leaves each end along that end's departure
 * direction, runs an `ANCHOR_STUB` clear before turning, and stays orthogonal
 * throughout. The stub is what keeps the first bend off the corner of the
 * shape it just left; for a free end it simply gives the line somewhere to go
 * before it turns.
 *
 * The legacy pair — two unanchored rects — keeps its original dominant-axis
 * derivation below, turning at the midpoint of the GAP between the two facing
 * edges so the bend sits in the space between the elements.
 */
function elbowPath(
  source: EndpointGeometry,
  target: EndpointGeometry,
): Array<Point> | null {
  if (!isLegacyPair(source, target)) {
    const ends = endpoints(source, target)
    if (!ends) return null
    const n0 = departureNormal(source, ends.from, ends.to)
    const n1 = departureNormal(target, ends.to, ends.from)
    const p0 = {
      x: ends.from.x + n0.x * ANCHOR_STUB,
      y: ends.from.y + n0.y * ANCHOR_STUB,
    }
    const p1 = {
      x: ends.to.x + n1.x * ANCHOR_STUB,
      y: ends.to.y + n1.y * ANCHOR_STUB,
    }
    // Turn on the axis the SOURCE left by: a line departing sideways travels
    // sideways first. Orthogonal throughout, and square-on at both ends.
    const middle =
      n0.x !== 0
        ? [
            { x: (p0.x + p1.x) / 2, y: p0.y },
            { x: (p0.x + p1.x) / 2, y: p1.y },
          ]
        : [
            { x: p0.x, y: (p0.y + p1.y) / 2 },
            { x: p1.x, y: (p0.y + p1.y) / 2 },
          ]
    const path = compact([ends.from, p0, ...middle, p1, ends.to])
    return path.length >= 2 ? path : null
  }

  const sourceRect = (source as { rect: WorldRect }).rect
  const targetRect = (target as { rect: WorldRect }).rect
  const a = rectCentre(sourceRect)
  const b = rectCentre(targetRect)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return null

  if (Math.abs(dx) >= Math.abs(dy)) {
    const fromX = dx >= 0 ? sourceRect.x + sourceRect.width : sourceRect.x
    const toX = dx >= 0 ? targetRect.x : targetRect.x + targetRect.width
    const from = { x: fromX, y: a.y }
    const to = { x: toX, y: b.y }
    if (from.y === to.y) return [from, to]
    const midX = (fromX + toX) / 2
    return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]
  }

  const fromY = dy >= 0 ? sourceRect.y + sourceRect.height : sourceRect.y
  const toY = dy >= 0 ? targetRect.y : targetRect.y + targetRect.height
  const from = { x: a.x, y: fromY }
  const to = { x: b.x, y: toY }
  if (from.x === to.x) return [from, to]
  const midY = (fromY + toY) / 2
  return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]
}

/** One cubic bezier point at parameter `t`. */
function bezierAt(
  p0: Point,
  c0: Point,
  c1: Point,
  p1: Point,
  t: number,
): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c0.x + c * c1.x + d * p1.x,
    y: a * p0.y + b * c0.y + c * c1.y + d * p1.y,
  }
}

/**
 * A cubic curve between the same points a straight connector uses.
 *
 * With any anchored or free end, each control point is pushed along that end's
 * DEPARTURE direction, so the curve leaves and arrives square-on to the side
 * it is tied to. The legacy dominant-axis rule below cannot express that —
 * both ends there share one axis, so a curve between a top end and a left end
 * would depart in a direction the line is not attached along at all.
 *
 * The legacy pair keeps the dominant-axis push, which is what makes two
 * side-by-side elements curve horizontally and two stacked ones curve
 * vertically rather than producing a merely bowed straight line.
 */
function curvedPath(
  source: EndpointGeometry,
  target: EndpointGeometry,
): Array<Point> | null {
  const ends = endpoints(source, target)
  if (!ends) return null

  const distance = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y)
  const tension = Math.min(
    CURVE_TENSION_MAX,
    Math.max(CURVE_TENSION_MIN, distance * CURVE_TENSION),
  )

  let c0: Point
  let c1: Point
  if (!isLegacyPair(source, target)) {
    const n0 = departureNormal(source, ends.from, ends.to)
    const n1 = departureNormal(target, ends.to, ends.from)
    c0 = { x: ends.from.x + n0.x * tension, y: ends.from.y + n0.y * tension }
    c1 = { x: ends.to.x + n1.x * tension, y: ends.to.y + n1.y * tension }
  } else {
    const a = rectCentre((source as { rect: WorldRect }).rect)
    const b = rectCentre((target as { rect: WorldRect }).rect)
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (Math.abs(dx) >= Math.abs(dy)) {
      const push = dx >= 0 ? tension : -tension
      c0 = { x: ends.from.x + push, y: ends.from.y }
      c1 = { x: ends.to.x - push, y: ends.to.y }
    } else {
      const push = dy >= 0 ? tension : -tension
      c0 = { x: ends.from.x, y: ends.from.y + push }
      c1 = { x: ends.to.x, y: ends.to.y - push }
    }
  }

  const points: Array<Point> = []
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    points.push(bezierAt(ends.from, c0, c1, ends.to, i / CURVE_SAMPLES))
  }
  return points
}

/**
 * The polyline a connector is drawn and hit-tested along, or null when there
 * is nothing sensible to draw.
 *
 * A null END means an ATTACHED endpoint whose element is gone — the caller
 * could not resolve it. Callers MUST handle a null RESULT rather than treating
 * it as an error: a missing endpoint element, two ends on the same point and
 * two heavily overlapping elements are all ordinary board states, not faults.
 * The renderer skips, the hit-test misses, and the connector comes back on the
 * next move.
 */
export function connectorPath(
  source: EndpointGeometry | null | undefined,
  target: EndpointGeometry | null | undefined,
  routing: CanvasConnectorRouting,
): Array<Point> | null {
  if (!source || !target) return null
  switch (routing) {
    case 'straight': {
      const ends = endpoints(source, target)
      return ends ? [ends.from, ends.to] : null
    }
    case 'elbow':
      return elbowPath(source, target)
    case 'curved':
      return curvedPath(source, target)
  }
}

/**
 * The filled triangle at the TARGET end, oriented along the path's final
 * segment.
 *
 * Walks backwards from the tip for the first segment with a non-zero length
 * rather than blindly using the last pair of points: a sampled curve can end
 * with two coincident points at low tension, and normalising a zero-length
 * vector yields NaN — an arrowhead that silently vanishes and takes the whole
 * `ctx.fill()` path with it.
 */
export function arrowHead(
  points: ReadonlyArray<Point>,
  size: number,
): Array<Point> | null {
  if (points.length < 2 || size <= 0) return null
  const tip = points[points.length - 1]
  let dx = 0
  let dy = 0
  for (let i = points.length - 2; i >= 0; i -= 1) {
    dx = tip.x - points[i].x
    dy = tip.y - points[i].y
    if (dx !== 0 || dy !== 0) break
  }
  const length = Math.hypot(dx, dy)
  if (length === 0) return null

  const ux = dx / length
  const uy = dy / length
  // Perpendicular, for the two back corners.
  const px = -uy
  const py = ux
  const backX = tip.x - ux * size
  const backY = tip.y - uy * size
  const spread = size * ARROW_SPREAD
  return [
    tip,
    { x: backX + px * spread, y: backY + py * spread },
    { x: backX - px * spread, y: backY - py * spread },
  ]
}

/**
 * The axis-aligned box a path occupies.
 *
 * Used for hit-test culling and for anchoring the routing toolbar — never
 * persisted. A connector's stored width and height are a placeholder that
 * nothing reads (see `createCanvasElementSchema`), and writing this value
 * there would reintroduce exactly the staleness this module exists to avoid.
 */
export function connectorBounds(
  points: ReadonlyArray<Point>,
): WorldRect | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * The point at the middle of a path BY ARC LENGTH, which is where the routing
 * toolbar anchors and where a label would sit.
 *
 * Arc length, not the middle index: a sampled curve's points are not evenly
 * spaced, and an elbow's four points put index-2 at a corner rather than
 * anywhere a user would call the middle.
 */
export function pathMidpoint(points: ReadonlyArray<Point>): Point | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]

  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  if (total === 0) return points[0]

  let travelled = 0
  const half = total / 2
  for (let i = 1; i < points.length; i += 1) {
    const segment = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    )
    if (travelled + segment >= half) {
      const t = segment === 0 ? 0 : (half - travelled) / segment
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      }
    }
    travelled += segment
  }
  return points[points.length - 1]
}

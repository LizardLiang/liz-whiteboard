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
// All three routings return a POLYLINE from `connectorPath`, including
// `curved`, which is sampled here. One output shape means the arrowhead, the
// hit-test and the bounds have a single implementation instead of three, and a
// sampled curve hit-tests correctly where a control-point curve would need its
// own root-finding.
//
// What gets DRAWN is not that sample. `connectorCurve` hands the renderer the
// cubic's own control points, because the sample count is fixed in world space
// and its chords therefore lengthen on screen as the camera zooms in — a
// `curved` connector visibly turned into a 24-sided polygon under
// magnification. Two answers to "where does this line run", but only one
// derivation: the polyline is sampled FROM the curve, never derived beside it.
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
 * The direction an elbow or curve should LEAVE an end travelling: straight OUT
 * of the face it stands on, for EVERY end that stands on a face at all.
 *
 * A rect end has an edge whether or not anyone attached it to one. An
 * unattached end still lands somewhere on the border, and the side it landed
 * on is recovered by projecting that landing point back onto the nearest edge.
 *
 * The dominant axis of the offset between the ends — which is what this used
 * for an unattached rect — DISAGREES with the landing side as soon as the rect
 * stops being square. `borderPoint` compares the rect's half-extents against
 * the offset, not the offset against itself, so a 200x40 box with its partner
 * 100 right and 60 down is exited through the BOTTOM face while the dominant
 * axis is still x. The line then set off sideways out of a face it was
 * standing on, and the head arrived grazing the far one — an arrowhead nearly
 * parallel to the face it points at does not read as an arrow.
 *
 * A free end has no edge at all, so its direction is still derived from the
 * other end — snapped to the dominant axis, because an elbow must stay
 * orthogonal and a diagonal stub would break that.
 */
function departureNormal(
  end: EndpointGeometry,
  self: Point,
  other: Point,
): Point {
  if (!isFree(end)) {
    // `self` IS the landing point, so `nearestAttach` here is a projection
    // back onto the edge that point is already on, not a search. It is also
    // the function a DROP uses to choose a side, which is what stops a dropped
    // end and a derived one ever disagreeing about which face they mean.
    return anchorNormal(attachSide(end.attach ?? nearestAttach(end.rect, self)))
  }
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
function isLegacyPair(
  source: EndpointGeometry,
  target: EndpointGeometry,
): boolean {
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

/**
 * The share of the CHORD a control handle may take, whatever the rules above
 * work out to — the guard that stops a short connector tying itself in a knot.
 *
 * `CURVE_TENSION_MIN` is an absolute length, so on a chord shorter than twice
 * it the two handles are each pushed further than the endpoints are apart and
 * they cross straight over one another. Two facing shapes 39 apart got 24-unit
 * handles: the source's reached past the target and the target's reached back
 * past the source, and the cubic between them looped, doubled back and looped
 * again — measured at 186 degrees of total turning where a connector that
 * reads as one sweep turns through well under 90.
 *
 * At half the chord the handles meet at worst and never trade places, which is
 * the exact condition for the curve to stay a single sweep.
 *
 * This binds ONLY below 48 world units of separation, since above that
 * `CURVE_TENSION_MIN` has already stopped binding and `distance * 0.4` is
 * under half by construction. Every connector longer than that draws the same
 * curve it always did, to the last floating-point bit.
 */
const CURVE_TENSION_CHORD_SHARE = 0.5

/**
 * The widest bow a stored `curvature` is allowed to describe: the curve's
 * middle may sit at most this many CHORD LENGTHS off the straight line.
 *
 * 2 is deliberately generous — a drag cannot realistically exceed it, because
 * the pointer has to physically be that far off the line — so this is not a
 * limit a user meets. It exists for the values a drag never produced: a row
 * hand-edited in SQL, a seed script, a future importer. Without it such a row
 * renders as a loop leaving the viewport in every direction, and the only way
 * back is to find a grip that is itself off-screen.
 */
export const CURVATURE_LIMIT = 2

/**
 * How far the sampled MIDPOINT of a cubic moves when BOTH of its control
 * points are pushed the same distance in the same direction.
 *
 * Not a tuning knob — it is the cubic itself. At t = 0.5 the Bernstein weights
 * are 1/8, 3/8, 3/8, 1/8, so shifting both middle terms by `d` shifts the
 * point by (3/8 + 3/8)·d. Written down because the alternative is a magic
 * 1.333 at the one call site and a later reader with no way to check it.
 */
const MIDPOINT_PER_CONTROL_OFFSET = 0.75

/**
 * Angle between one arrowhead barb and the shaft it sweeps back from, in
 * radians — so the head's full included angle is twice this.
 *
 * 45° (90° included) is a hand-drawn angle, not a printer's one. A narrow
 * head reads as a machine-drawn vector arrow; splaying the barbs out to a
 * near-right angle is what makes the open chevron read as a marker doodle,
 * which is the register the rest of this board is drawn in.
 *
 * Stored as an angle rather than as the old half-width-over-length ratio
 * because `arrowHead` now holds the BARB LENGTH fixed and rotates the barbs.
 * Widening a ratio would have lengthened the barbs at the same time, so the
 * head would have grown as it opened instead of just opening.
 */
const ARROW_HALF_ANGLE = Math.PI / 4

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
export function nearestAttach(rect: WorldRect, toward: Point): ConnectorAttach {
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
  const scaleX =
    d.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(d.x)
  const scaleY =
    d.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(d.y)
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

    const from = borderPoint((source as { rect: WorldRect }).rect, {
      x: dx,
      y: dy,
    })
    const to = borderPoint((target as { rect: WorldRect }).rect, {
      x: -dx,
      y: -dy,
    })
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

/**
 * The unit vector a curvature is measured along: the LEFT-hand side of the
 * source -> target direction AS SEEN ON SCREEN.
 *
 * `(dy, -dx)` and not `(-dy, dx)` because the canvas y axis points DOWN. For a
 * connector running left to right this yields `(0, -1)` — up the screen, which
 * is the side a person walking that direction would call their left. Getting
 * this backwards is invisible in a unit test that only checks magnitude and
 * shows up as every stored bow flipping the day someone "fixes" the sign, so
 * the whole convention is pinned here and read from nowhere else.
 *
 * Null for a zero-length chord: there is no side of a line that has no
 * direction. `endpoints` already rejects that case, so no caller reaches it
 * today, but returning null is the only non-NaN answer if one ever does.
 */
function chordNormal(from: Point, to: Point): Point | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return null
  return { x: dy / length, y: -dx / length }
}

/**
 * A stored curvature, held to `CURVATURE_LIMIT` and to being a number at all.
 *
 * NaN maps to 0 rather than to a clamp bound: every arithmetic path into a
 * curvature divides by a chord length, and a chord of zero yields NaN, which
 * would otherwise propagate into both control points and delete the entire
 * `ctx.stroke()` — the connector would vanish rather than merely go flat. Zero
 * is the honest fallback, because zero is exactly "no hand-applied bow".
 */
export function clampCurvature(curvature: number): number {
  if (!Number.isFinite(curvature)) return 0
  return Math.min(CURVATURE_LIMIT, Math.max(-CURVATURE_LIMIT, curvature))
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
 * `control` with its component ALONG the chord held inside the chord itself,
 * and its perpendicular component left exactly as it was.
 *
 * This is what stops a bowed curve drawing a CUSP — the line shooting
 * backwards past its own endpoint, curling round it and coming back, which is
 * what a `curved` connector with a free or unanchored end did at every
 * non-zero curvature. `departureNormal` points such an end AWAY from the other
 * end, so its control point starts up to `CURVE_TENSION_MAX` BEHIND the
 * endpoint along the chord. On its own that only reads as a short departure
 * stub; add the perpendicular bow on top and the cubic reverses direction into
 * a visible loop.
 *
 * Holding both control points inside `[0, chord]` is not a heuristic that
 * happens to look better — it is exactly the condition that makes the cubic's
 * along-chord derivative non-negative for the whole curve. That derivative is
 * the quadratic bezier through `(a0, a1 - a0, chord - a1)`, which is AFFINE in
 * `a0` and `a1`, so its minimum over the square `[0, chord]^2` sits at one of
 * the four corners, and all four evaluate to a non-negative multiple of
 * `chord`. No reversal is therefore possible at any curvature, for any
 * endpoint pair.
 *
 * Both ends are measured from `from` along the same axis, which is the same
 * condition as "`c1` is within `chord` of `to`, measured backwards" — one
 * projection instead of two, and one fewer sign to get wrong.
 *
 * The PERPENDICULAR component is deliberately untouched: it is the component a
 * curvature is defined as, so holding it back would bow the line by less than
 * the drag asked for and the bend grip would slide out from under the pointer.
 */
function holdAlongChord(
  control: Point,
  from: Point,
  axis: Point,
  chord: number,
): Point {
  const along = (control.x - from.x) * axis.x + (control.y - from.y) * axis.y
  const held = Math.min(chord, Math.max(0, along))
  // Returned unchanged — and byte-identical, not merely equal to within an
  // epsilon — whenever the control point was already inside the chord, which
  // is every connector whose ends both depart towards each other. Only the
  // ends that depart backwards pay anything here.
  if (held === along) return control
  return {
    x: control.x + axis.x * (held - along),
    y: control.y + axis.y * (held - along),
  }
}

/**
 * A `curved` connector as the CUBIC it is — the four points, not a sample of
 * the line through them.
 *
 * Exported (via `connectorCurve`) so the renderer can hand these straight to
 * `bezierCurveTo`. A connector used to be DRAWN by walking its 24-segment
 * sample, and a 24-sided polygon is what it looked like: the sample count is
 * fixed in WORLD space, so every chord in it grows on screen as the camera
 * zooms in and the corners come out. Stroking the curve itself is exact at any
 * magnification, and costs one path command instead of twenty-four.
 *
 * The arithmetic below is unchanged. Only the LEGACY dominant-axis branch is
 * gone: it pushed both control points along whichever axis separated the two
 * centres, which is not necessarily the axis either end is standing on — see
 * `departureNormal`, which now answers that per end for an unattached rect as
 * well as an attached one. On a square pair the two rules already agreed, so
 * this changes nothing there; on a wide or tall one it is the difference
 * between leaving the face and skimming it.
 *
 * `curvature` is the user's own bow, applied ON TOP of the departure push —
 * see `CanvasConnector.curvature`. It pushes BOTH control points along the
 * chord normal, which keeps the bow symmetric. Bending by moving ONE control
 * point would swing that end's departure as it bent, so an anchored end would
 * visibly peel off its own edge as the user dragged.
 */
export interface ConnectorCurve {
  /** Where the line leaves the source, on its border. */
  from: Point
  /** Control point for the source end. */
  c0: Point
  /** Control point for the target end. */
  c1: Point
  /** Where the line meets the target, on its border. */
  to: Point
}

function curveOf(
  source: EndpointGeometry,
  target: EndpointGeometry,
  curvature = 0,
): ConnectorCurve | null {
  const ends = endpoints(source, target)
  if (!ends) return null

  const distance = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y)
  const tension = Math.min(
    CURVE_TENSION_MAX,
    Math.max(CURVE_TENSION_MIN, distance * CURVE_TENSION),
    distance * CURVE_TENSION_CHORD_SHARE,
  )

  const n0 = departureNormal(source, ends.from, ends.to)
  const n1 = departureNormal(target, ends.to, ends.from)
  let c0: Point = {
    x: ends.from.x + n0.x * tension,
    y: ends.from.y + n0.y * tension,
  }
  let c1: Point = {
    x: ends.to.x + n1.x * tension,
    y: ends.to.y + n1.y * tension,
  }

  // Guarded on `!== 0` rather than added unconditionally, so an un-bowed
  // connector's control points are the SAME floating-point values they were
  // before curvature existed — not "the same to within an epsilon". Every
  // connector already stored carries no curvature, and the guarantee those
  // rows need is that they redraw pixel-identically, which an unconditional
  // `+ 0 * n.x` weakens for no gain.
  const bend = clampCurvature(curvature)
  const normal = bend === 0 ? null : chordNormal(ends.from, ends.to)
  if (normal) {
    const chord = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y)
    // Divide, don't guess: `bend * chord` is where the user wants the MIDPOINT,
    // and a control-point offset only moves the midpoint by
    // `MIDPOINT_PER_CONTROL_OFFSET` of itself. Offsetting the controls by the
    // midpoint distance directly would bow the line to only three quarters of
    // the drag, which reads as the grip sliding out from under the pointer.
    const offset = (bend * chord) / MIDPOINT_PER_CONTROL_OFFSET
    c0 = { x: c0.x + normal.x * offset, y: c0.y + normal.y * offset }
    c1 = { x: c1.x + normal.x * offset, y: c1.y + normal.y * offset }

    // ...and only then hold each control point inside the chord, which is what
    // keeps the bow from folding the curve into a cusp around an endpoint —
    // see `holdAlongChord`. Applied INSIDE this guard on purpose: an un-bowed
    // curve with a backwards-departing end does step backwards out of that
    // end, and that stub is what every already-stored connector draws today.
    // Holding it back unconditionally would look tidier and would change the
    // picture for rows nobody edited, so the stub stays and only a bow — which
    // is always a deliberate, current edit — is held.
    //
    // The chord direction is rotated back out of the normal rather than
    // derived a second time: `chordNormal` is `(dy, -dx) / L`, so `(-n.y, n.x)`
    // is `(dx, dy) / L`. Two derivations of the same axis is how W1 and W3 both
    // started.
    const axis = { x: -normal.y, y: normal.x }
    c0 = holdAlongChord(c0, ends.from, axis, chord)
    c1 = holdAlongChord(c1, ends.from, axis, chord)
  }

  return { from: ends.from, c0, c1, to: ends.to }
}

/**
 * The direction a curve is travelling as it ARRIVES at its target — the exact
 * tangent, which is what the arrowhead is oriented along.
 *
 * `to - c1`, not the last sampled chord. On an un-bowed curve `c1` sits on the
 * target face's outward normal, so this is that normal reversed to
 * floating-point exactness and the head points straight INTO the face it lands
 * on. The final sampled chord only approaches that as the sample count rises,
 * and at 14px of barb the difference shows on a tight curve.
 *
 * Not normalised — `arrowHead` normalises whatever it is handed.
 */
export function curveEndDirection(curve: ConnectorCurve): Point {
  return { x: curve.to.x - curve.c1.x, y: curve.to.y - curve.c1.y }
}

/**
 * The curve a connector is STROKED along, or null when it has none — anything
 * but `curved` routing, or a pair with no sensible line between them.
 *
 * The routing gate lives here rather than at the call site for the same reason
 * `connectorPath` accepts a curvature for every routing: one function that
 * answers "what does this connector look like" beats a branch repeated at
 * every renderer.
 */
export function connectorCurve(
  source: EndpointGeometry | null | undefined,
  target: EndpointGeometry | null | undefined,
  routing: CanvasConnectorRouting,
  curvature?: number,
): ConnectorCurve | null {
  if (!source || !target || routing !== 'curved') return null
  return curveOf(source, target, curvature)
}

/**
 * The same curve, flattened — what hit-testing, bounds, the bend grip and the
 * arrowhead read. No longer what gets drawn; see `curveOf`.
 */
function curvedPath(
  source: EndpointGeometry,
  target: EndpointGeometry,
  curvature = 0,
): Array<Point> | null {
  const curve = curveOf(source, target, curvature)
  if (!curve) return null

  const points: Array<Point> = []
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    points.push(
      bezierAt(curve.from, curve.c0, curve.c1, curve.to, i / CURVE_SAMPLES),
    )
  }
  return points
}

/**
 * The point on a path that the BEND GRIP sits on, or null when there is none.
 *
 * The sample at t = 0.5 — deliberately NOT `pathMidpoint`, which measures by
 * arc length. The two coincide on a symmetric curve and drift apart on an
 * asymmetric one, and this one has to be the t = 0.5 point because that is
 * what `curvature` is defined against: anything else would make the grip lag
 * behind the pointer during a drag, by a distance that changes with the bow.
 *
 * `curvedPath` samples uniformly in `t` over `CURVE_SAMPLES + 1` points, so
 * for a curve the middle index IS t = 0.5. The even-length branch exists
 * because nothing in the type stops a caller handing this a four-point elbow;
 * interpolating is a truthful answer rather than an off-by-one silently
 * favouring one half.
 */
export function bendMidpoint(
  points: ReadonlyArray<Point> | null | undefined,
): Point | null {
  if (!points || points.length < 2) return null
  const middle = (points.length - 1) / 2
  const lower = Math.floor(middle)
  const upper = Math.ceil(middle)
  if (lower === upper) return points[lower]
  return {
    x: (points[lower].x + points[upper].x) / 2,
    y: (points[lower].y + points[upper].y) / 2,
  }
}

/**
 * The curvature that puts a `curved` connector's bend point exactly under
 * `toward`, or null when the pair has no curve to bend.
 *
 * The INVERSE of what `curvedPath` does with a curvature, and it exists so the
 * drag has one: `use-canvas-input` must not carry its own copy of the
 * perpendicular-distance-over-chord-length arithmetic, for the same
 * export-what-you-draw reason `connectorEndpointRects` is exported rather than
 * re-derived at the press site.
 *
 * Measured against the UN-BOWED path's own bend point rather than against the
 * chord, which is what makes the answer round-trip: feeding the result back
 * into `connectorPath` lands the bend point on `toward` to floating-point
 * precision. Measuring from the chord instead would be off by whatever bow the
 * routing already had, and an anchored connector would jump the instant it was
 * grabbed.
 *
 * Stateless — recomputed from the CURRENT pointer every frame, never
 * accumulated from the last one. Same rationale as `resize`'s `startBounds`:
 * a per-frame delta would compound its own clamp.
 */
export function curvatureForPoint(
  source: EndpointGeometry | null | undefined,
  target: EndpointGeometry | null | undefined,
  toward: Point,
): number | null {
  if (!source || !target) return null
  const ends = endpoints(source, target)
  if (!ends) return null
  const normal = chordNormal(ends.from, ends.to)
  if (!normal) return null
  const chord = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y)
  const base = bendMidpoint(curvedPath(source, target))
  if (!base) return null
  const along = (point: Point): number =>
    (point.x - ends.from.x) * normal.x + (point.y - ends.from.y) * normal.y
  return clampCurvature((along(toward) - along(base)) / chord)
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
 *
 * `curvature` is accepted for EVERY routing and consumed by exactly one, and
 * that asymmetry is deliberate. `straight` and `elbow` have no bow to scale —
 * a straight line with a bend in it is not straight, and an elbow with one is
 * no longer orthogonal — so they IGNORE the value rather than reinterpreting
 * it, and a connector flipped to one of them and back keeps the bow it had.
 * Callers therefore pass a connector's stored curvature through
 * unconditionally instead of branching on routing at every call site, which is
 * one fewer place to forget.
 */
export function connectorPath(
  source: EndpointGeometry | null | undefined,
  target: EndpointGeometry | null | undefined,
  routing: CanvasConnectorRouting,
  curvature?: number,
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
      return curvedPath(source, target, curvature)
  }
}

/**
 * The three points of the open chevron at the TARGET end, oriented along the
 * path's final segment: `[tip, barbA, barbB]`, to be stroked barbA → tip →
 * barbB.
 *
 * `size` is the length of ONE BARB, not the head's reach back along the
 * shaft — the barbs sit at `ARROW_HALF_ANGLE` either side of it, so the head
 * only reaches `size * cos(ARROW_HALF_ANGLE)` backwards. Sizing by the barb
 * is what lets the angle be retuned without also resizing the head, since
 * the barb is the stroke a reader actually sees.
 *
 * Walks backwards from the tip for the first segment with a non-zero length
 * rather than blindly using the last pair of points: a sampled curve can end
 * with two coincident points at low tension, and normalising a zero-length
 * vector yields NaN — an arrowhead that silently vanishes and takes the whole
 * stroked path with it.
 *
 * `direction` overrides that walk with the EXACT arrival tangent, which a
 * `curved` connector has and a sampled polyline can only approach — see
 * `curveEndDirection`. It is what sits the head square to the face it points
 * at rather than square to the last 1/24th of the curve. Needs no
 * normalising, and a zero vector falls back to the walk rather than to NaN.
 */
export function arrowHead(
  points: ReadonlyArray<Point>,
  size: number,
  direction?: Point | null,
): Array<Point> | null {
  if (points.length < 2 || size <= 0) return null
  const tip = points[points.length - 1]
  let dx = direction?.x ?? 0
  let dy = direction?.y ?? 0
  if (dx === 0 && dy === 0) {
    for (let i = points.length - 2; i >= 0; i -= 1) {
      dx = tip.x - points[i].x
      dy = tip.y - points[i].y
      if (dx !== 0 || dy !== 0) break
    }
  }
  const length = Math.hypot(dx, dy)
  if (length === 0) return null

  const ux = dx / length
  const uy = dy / length
  // Perpendicular, for the two barb ends.
  const px = -uy
  const py = ux
  // Decomposing the rotation into "back along the shaft" + "out to the side"
  // rather than rotating (ux, uy) twice: both barbs share the back offset, so
  // this is the same two trig calls for the pair instead of four.
  const reach = size * Math.cos(ARROW_HALF_ANGLE)
  const spread = size * Math.sin(ARROW_HALF_ANGLE)
  const backX = tip.x - ux * reach
  const backY = tip.y - uy * reach
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
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    )
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

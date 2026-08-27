// src/lib/canvas-engine/hit-test.ts
// Pointer-to-element resolution for the canvas engine (tactical plan Wave 1,
// step 3).
//
// A canvas has no DOM and therefore no `document.elementFromPoint`: every
// "what did I just click?" answer in the engine comes from here. That makes
// this module the counterpart to `camera.ts` — the camera decides WHERE a
// pointer is in world space, and this decides WHAT is there.
//
// Linear reverse-z scan, deliberately. The plan records the ceiling: this
// runs per pointermove, so somewhere in the low thousands of elements it
// needs a spatial index. When that day comes, the index goes BEHIND these
// signatures and no caller changes.
//
// Pure module: no React, no DOM, no database.

import { bounds, effectiveCornerRadius } from './scene'
import {
  connectorBounds,
  connectorCurve,
  connectorPath,
} from './connector-geometry'
import type { ConnectorCurve, EndpointGeometry  } from './connector-geometry'
import type { CanvasElement, ConnectorEndpoint, Scene } from './scene'
import type { Point } from './camera'

export interface WorldRect {
  x: number
  y: number
  width: number
  height: number
}

/** Does a world point fall inside an axis-aligned rect? */
export function rectContainsPoint(rect: WorldRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** Do two axis-aligned rects overlap at all? Touching edges do not count. */
export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/**
 * Does a world point fall inside the ellipse INSCRIBED in a rect?
 *
 * The normalised-radius form: a point is inside when the sum of its squared
 * offsets from the centre, each measured in units of that axis's own radius,
 * is at most 1. Written this way rather than as a circle test with a scale
 * factor because it reads as the equation it is, and it handles a wide, flat
 * ellipse identically to a tall one.
 *
 * A zero-width or zero-height rect has no interior and reports false rather
 * than dividing by zero — the same "there is nothing there" answer the
 * renderer gives a degenerate element.
 */
export function ellipseContainsPoint(rect: WorldRect, point: Point): boolean {
  const rx = rect.width / 2
  const ry = rect.height / 2
  if (rx <= 0 || ry <= 0) return false
  const dx = (point.x - (rect.x + rx)) / rx
  const dy = (point.y - (rect.y + ry)) / ry
  return dx * dx + dy * dy <= 1
}

/**
 * Does a world point fall inside the diamond INSCRIBED in a rect — the rhombus
 * through the four edge midpoints?
 *
 * The L1 (taxicab) counterpart of the ellipse test above: same normalised
 * offsets, summed as absolute values instead of squares. That is not a
 * coincidence — a diamond is the unit ball of the L1 norm exactly as an
 * ellipse is the unit ball of the L2 norm — and stating it this way is why
 * this needs no per-edge line-side arithmetic.
 */
export function diamondContainsPoint(rect: WorldRect, point: Point): boolean {
  const rx = rect.width / 2
  const ry = rect.height / 2
  if (rx <= 0 || ry <= 0) return false
  const dx = Math.abs(point.x - (rect.x + rx)) / rx
  const dy = Math.abs(point.y - (rect.y + ry)) / ry
  return dx + dy <= 1
}

/**
 * Does a world point fall inside the triangle INSCRIBED in a rect — apex at
 * the top edge's midpoint, base along the whole bottom edge?
 *
 * That orientation is fixed here and in `render.ts`'s tracing of the same
 * shape, and the two must agree or a click near the apex selects nothing
 * while the pixels plainly show a shape there.
 *
 * Solved as a linear interpolation rather than three half-plane tests: at
 * height `t` down from the apex the triangle spans `t` of the full width,
 * centred — so the test is "is this point within that span?". Points on an
 * edge count as inside, matching `rectContainsPoint`'s inclusive bounds.
 */
export function triangleContainsPoint(rect: WorldRect, point: Point): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  const t = (point.y - rect.y) / rect.height
  if (t < 0 || t > 1) return false
  const halfSpan = (rect.width / 2) * t
  const centreX = rect.x + rect.width / 2
  return Math.abs(point.x - centreX) <= halfSpan
}

/**
 * Containment for a rounded rectangle: inside the box, and — when the point
 * falls in a corner's quadrant — inside that corner's arc.
 *
 * The counterpart of the `rectangle` arm of `render.ts`'s `traceShapePath`,
 * and the reason a radius could not simply be drawn and left at that: a
 * rounded shape whose hit region stayed square would swallow clicks in the
 * four corners it no longer covers, so a shape tucked behind another one's
 * corner would be unselectable with nothing on screen to explain it.
 *
 * The centre of each arc sits one radius in from both of its edges, which
 * makes the whole test "is the point further than `radius` from the nearest
 * corner centre?" — no per-corner special-casing, and the straight edges fall
 * out of it because a point beside a corner centre is inside by construction.
 */
export function roundedRectContainsPoint(
  rect: WorldRect,
  radius: number,
  point: Point,
): boolean {
  if (!rectContainsPoint(rect, point)) return false
  if (radius <= 0) return true
  // How far the point lies INTO the corner region on each axis: zero anywhere
  // along the straight part of an edge, which is what makes those inside.
  const dx = Math.max(
    rect.x + radius - point.x,
    point.x - (rect.x + rect.width - radius),
    0,
  )
  const dy = Math.max(
    rect.y + radius - point.y,
    point.y - (rect.y + rect.height - radius),
    0,
  )
  return dx * dx + dy * dy <= radius * radius
}

/**
 * Per-kind containment — the dispatch point the scan below never has to know
 * about.
 *
 * A shape's hit region is its DRAWN outline, not its bounding box: clicking
 * the empty corner outside an ellipse has to fall through to whatever is
 * behind it, or a circle behaves like the square it was drawn inside and
 * overlapping shapes become impossible to pick apart. Each case here is the
 * exact counterpart of the path `render.ts` traces for that kind.
 *
 * TEXT stays rectangular deliberately: its hit region is the block it lays
 * out in, which is a box regardless of the glyph shapes inside it.
 */
export function elementContainsPoint(
  element: CanvasElement,
  point: Point,
): boolean {
  switch (element.kind) {
    case 'rectangle':
      return roundedRectContainsPoint(
        bounds(element),
        effectiveCornerRadius(element),
        point,
      )
    case 'text':
      return rectContainsPoint(bounds(element), point)
    case 'ellipse':
      return ellipseContainsPoint(bounds(element), point)
    case 'diamond':
      return diamondContainsPoint(bounds(element), point)
    case 'triangle':
      return triangleContainsPoint(bounds(element), point)
    case 'connector':
      // A connector's stored bounds are a 1x1 placeholder that means nothing
      // (see createCanvasElementSchema) and its real shape needs its two
      // endpoint elements, which this signature deliberately does not have.
      // Resolving them here would give a pure predicate a hidden dependency
      // on the whole scene; `hitTest` below owns the connector case instead.
      return false
  }
}

/**
 * Distance from a point to a polyline, and whether it is within `tolerance`.
 *
 * This is how a connector is clicked. A line has no area, so a containment
 * test can never hit one — the tolerance IS the hit target, and it is
 * supplied by the caller in world units (converted from a fixed screen
 * distance, so a connector stays equally easy to click at any zoom).
 */
export function pointNearPolyline(
  points: ReadonlyArray<Point>,
  point: Point,
  tolerance: number,
): boolean {
  if (points.length === 0) return false
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= tolerance
  }
  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegment(points[i - 1], points[i], point) <= tolerance) {
      return true
    }
  }
  return false
}

/**
 * Shortest distance from `point` to the segment `a`-`b`.
 *
 * Clamped projection, not distance to the infinite line: an unclamped version
 * reports a point far past a segment's end as being right on it, which would
 * make the empty space beyond a short connector select that connector.
 */
function distanceToSegment(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y)
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  )
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/**
 * An element's bounds for hit-testing and marquee purposes — the connector-
 * aware counterpart to `scene.ts`'s `bounds`.
 *
 * Returns null for a connector whose path cannot be built (a missing or
 * concentric endpoint), which is the same "there is nothing there" answer the
 * renderer gives it.
 */
export function resolvedBounds(
  scene: Scene,
  element: CanvasElement,
): WorldRect | null {
  if (!element.connector) return bounds(element)
  const path = connectorPathOf(scene, element)
  return path ? connectorBounds(path) : null
}

/**
 * One endpoint resolved into the geometry `connector-geometry.ts` speaks.
 *
 * Null means an ATTACHED end whose element is gone — the connector has no
 * drawable path. A FREE end always resolves: its point is the whole of it.
 */
export function endpointGeometry(
  scene: Scene,
  endpoint: ConnectorEndpoint,
): EndpointGeometry | null {
  if (endpoint.kind === 'point') return { point: endpoint.point }
  const element = scene.byId.get(endpoint.elementId)
  if (!element) return null
  return {
    rect: bounds(element),
    ...(endpoint.attach ? { attach: endpoint.attach } : {}),
  }
}

/**
 * The polyline a stored connector is drawn and hit-tested along, or null.
 *
 * The SINGLE place the app turns a `CanvasConnector` into a path: the
 * renderer, the selection overlay, the hit-test, the bounds and the routing
 * toolbar all come through here. They used to spell the same four-line
 * lookup out separately, which is five chances to resolve one end and forget
 * the other — and after free ends, five chances to mishandle an unattached
 * one.
 */
export function connectorPathOf(
  scene: Scene,
  element: CanvasElement,
): Array<Point> | null {
  const link = element.connector
  if (!link) return null
  return connectorPath(
    endpointGeometry(scene, link.source),
    endpointGeometry(scene, link.target),
    link.routing,
    // Passed unconditionally, not gated on `routing === 'curved'`. This is the
    // single place a stored connector becomes a path, so gating here would be
    // gating everywhere — and `connectorPath` already ignores the value for
    // the two routings that have no bow. One caller, one rule, no branch to
    // forget when a fourth routing arrives.
    link.curvature,
  )
}

/**
 * The same connector as the CURVE it is stroked along, or null when it has
 * none — `straight` and `elbow` are polylines and have no curve to give.
 *
 * The twin of `connectorPathOf`, and it exists for exactly one reason: what a
 * `curved` connector is DRAWN as is a pair of cubics, while what it is
 * hit-tested, bounded and arrow-headed by is the flattened sample. Both have
 * to come from one resolution of the two endpoint elements, or the line and
 * the thing you can click will drift apart on the frame an element moves.
 */
export function connectorCurveOf(
  scene: Scene,
  element: CanvasElement,
): ConnectorCurve | null {
  const link = element.connector
  if (!link) return null
  return connectorCurve(
    endpointGeometry(scene, link.source),
    endpointGeometry(scene, link.target),
    link.routing,
    link.curvature,
  )
}

/**
 * The topmost element under a world point, or null.
 *
 * Walks in REVERSE z-order because the scene stores ascending z (last
 * paints on top), so the first match walking backwards is the one the user
 * can actually see under the cursor. Getting this direction wrong yields
 * the classic "clicking a stack always selects the bottom item" bug.
 */
export function hitTest(
  scene: Scene,
  point: Point,
  /**
   * How close a pointer must come to a connector's line to grab it, in WORLD
   * units. Callers convert a fixed screen distance through the camera's zoom,
   * so a connector is equally clickable however far the board is zoomed out.
   */
  connectorTolerance: number = DEFAULT_CONNECTOR_TOLERANCE,
): CanvasElement | null {
  // Non-connectors first, in reverse z. Connectors are painted BENEATH every
  // other element (render.ts's two-pass draw), so a connector running under a
  // rectangle must not be grabbed through it — hit-testing has to agree with
  // what the user can see, or clicking a shape sometimes selects the arrow
  // behind it.
  for (let i = scene.elements.length - 1; i >= 0; i -= 1) {
    const element = scene.elements[i]
    if (element.connector) continue
    if (elementContainsPoint(element, point)) return element
  }
  for (let i = scene.elements.length - 1; i >= 0; i -= 1) {
    const element = scene.elements[i]
    if (!element.connector) continue
    const path = connectorPathOf(scene, element)
    if (path && pointNearPolyline(path, point, connectorTolerance)) {
      return element
    }
  }
  return null
}

/**
 * Default grab distance for a connector, in world units at 1x zoom — roughly
 * the same forgiveness a 16px-tall click target gives.
 */
export const DEFAULT_CONNECTOR_TOLERANCE = 8

/**
 * Every element intersecting a world rect — a marquee selection.
 *
 * Returned in ASCENDING z-order (scene order), not reverse: a selection is
 * a set, and callers that render it want natural paint order.
 *
 * Intersection, not containment: dragging a marquee that clips an element's
 * corner selects it, which is what every editor does. Requiring full
 * containment makes large elements almost impossible to marquee-select.
 *
 * CONNECTORS ARE THE EXCEPTION: one is selected only when BOTH of its
 * endpoints are also selected by the same marquee. Intersection would be
 * actively wrong for them — a connector spanning the whole board intersects
 * almost any marquee, so a small drag in the middle of nowhere would sweep up
 * every long arrow that happened to pass through. Requiring both ends means a
 * marquee grabs exactly the sub-graph it visibly encloses, which is what
 * makes "select these three boxes and their arrows and move them" work.
 */
export function hitTestRect(
  scene: Scene,
  rect: WorldRect,
): Array<CanvasElement> {
  const normalised = normaliseRect(rect)
  const selected = scene.elements.filter(
    (element) =>
      !element.connector && rectsIntersect(bounds(element), normalised),
  )
  const selectedIds = new Set(selected.map((element) => element.id))
  // A connector joins the selection only when BOTH its ends are inside the
  // marquee — an ATTACHED end by its element being selected, a FREE end by its
  // own point falling inside the rect. Intersection would be actively wrong
  // here: a board-spanning connector crosses almost any marquee, so a small
  // drag in empty space would sweep up every long line passing through.
  const endInside = (endpoint: ConnectorEndpoint): boolean =>
    endpoint.kind === 'element'
      ? selectedIds.has(endpoint.elementId)
      : pointInRect(endpoint.point, normalised)
  const connectors = scene.elements.filter(
    (element) =>
      element.connector !== undefined &&
      endInside(element.connector.source) &&
      endInside(element.connector.target),
  )
  // Re-filtered from `scene.elements` rather than concatenated, so the result
  // keeps ascending z-order as this function's contract promises — a
  // connector's z can sit anywhere among the elements it joins.
  const all = new Set([...selectedIds, ...connectors.map((c) => c.id)])
  return scene.elements.filter((element) => all.has(element.id))
}

/** Whether a world point falls inside a (already normalised) rect. */
function pointInRect(point: Point, rect: WorldRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * Turn a drag from any corner into a positive-width/height rect. A marquee
 * dragged up-and-left produces negative extents, and every containment test
 * silently returns false for those — so normalising is not cosmetic.
 */
export function normaliseRect(rect: WorldRect): WorldRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

/** The rect spanned by two world points, always positive-sized. */
export function rectFromPoints(a: Point, b: Point): WorldRect {
  return normaliseRect({
    x: a.x,
    y: a.y,
    width: b.x - a.x,
    height: b.y - a.y,
  })
}

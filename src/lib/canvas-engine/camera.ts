// src/lib/canvas-engine/camera.ts
// The canvas engine's camera: the ONE canonical screen<->world transform
// pair for the whole engine (tactical plan Wave 1, step 1).
//
// Why one pair, exported and tested, rather than inline maths at each call
// site: W1 and W3 in the React Flow surface were BOTH the same bug class —
// screen-space and flow-space coordinates mixed at the point of use, with
// no compiler error and no visible symptom until a gesture landed in the
// wrong place. A single shared pair makes that mistake impossible to write
// here: rendering and hit-testing consume the same functions, so they can
// never disagree about where a point is.
//
// Pure module: imports no React, no DOM, no React Flow. Unit-testable in
// complete isolation, exactly as `shape-geometry.ts` is.

/** A point in either space — the type does not distinguish them; the function names do. */
export interface Point {
  x: number
  y: number
}

/**
 * The camera over the board.
 *
 * `x`/`y` are the WORLD coordinate currently at the viewport's top-left
 * corner, and `zoom` is world-units-to-screen-pixels. So a world point is
 * on screen at `(world - camera) * zoom`, which is the whole transform.
 */
export interface Camera {
  x: number
  y: number
  zoom: number
}

/**
 * Zoom limits. Matched to the React Flow surface's existing
 * ZOOM_CONSTRAINTS so the two surfaces feel the same to use, rather than
 * inventing a second scale for no reason.
 */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 2

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

export function clampZoom(zoom: number): number {
  // NaN is the only input with no meaningful direction to clamp toward, so
  // it falls back to 1. Infinity does have one and clamps like any other
  // out-of-range value — resetting it to 1 instead would silently undo a
  // user's zoom rather than pinning it at the limit.
  if (Number.isNaN(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Screen (viewport-relative CSS pixels) -> world (board units). */
export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  }
}

/** World (board units) -> screen (viewport-relative CSS pixels). */
export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }
}

/**
 * Zoom by `factor` while keeping the world point currently under
 * `screenAnchor` pinned to that same screen position — the behaviour every
 * wheel-zoom needs and the one that is easy to get subtly wrong by
 * zooming about the viewport centre instead.
 *
 * Returns a NEW camera; never mutates. Zoom is clamped, and the anchor
 * invariant holds for the CLAMPED zoom, so pinning stays exact even at the
 * limits (a version that clamped after solving for the pan would drift at
 * MIN_ZOOM/MAX_ZOOM).
 */
export function zoomAt(
  camera: Camera,
  screenAnchor: Point,
  factor: number,
): Camera {
  const nextZoom = clampZoom(camera.zoom * factor)
  // The world point that must stay under the anchor.
  const worldAnchor = screenToWorld(camera, screenAnchor)
  // Solve worldToScreen(next, worldAnchor) === screenAnchor for next.x/y.
  return {
    x: worldAnchor.x - screenAnchor.x / nextZoom,
    y: worldAnchor.y - screenAnchor.y / nextZoom,
    zoom: nextZoom,
  }
}

/**
 * Pan by a SCREEN-space delta (what a pointer drag produces). Dividing by
 * zoom here is the step most often forgotten, which makes panning feel
 * wrong at every zoom level except 1.
 */
export function panByScreenDelta(camera: Camera, delta: Point): Camera {
  return {
    x: camera.x - delta.x / camera.zoom,
    y: camera.y - delta.y / camera.zoom,
    zoom: camera.zoom,
  }
}

/** The world-space rectangle currently visible in a viewport of this size. */
export function visibleWorldRect(
  camera: Camera,
  viewport: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  }
}

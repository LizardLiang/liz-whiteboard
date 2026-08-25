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

import { bounds } from './scene'
import type { CanvasElement, Scene } from './scene'
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
 * Per-kind containment. Both milestone-1 kinds are rectangular, so this is
 * one branch today — but it exists as the dispatch point so an ellipse or a
 * diamond can be added without touching the scan below, mirroring how
 * `shape-geometry.ts` dispatches on kind.
 */
export function elementContainsPoint(
  element: CanvasElement,
  point: Point,
): boolean {
  switch (element.kind) {
    case 'rectangle':
    case 'text':
      return rectContainsPoint(bounds(element), point)
  }
}

/**
 * The topmost element under a world point, or null.
 *
 * Walks in REVERSE z-order because the scene stores ascending z (last
 * paints on top), so the first match walking backwards is the one the user
 * can actually see under the cursor. Getting this direction wrong yields
 * the classic "clicking a stack always selects the bottom item" bug.
 */
export function hitTest(scene: Scene, point: Point): CanvasElement | null {
  for (let i = scene.elements.length - 1; i >= 0; i -= 1) {
    const element = scene.elements[i]
    if (elementContainsPoint(element, point)) return element
  }
  return null
}

/**
 * Every element intersecting a world rect — a marquee selection.
 *
 * Returned in ASCENDING z-order (scene order), not reverse: a selection is
 * a set, and callers that render it want natural paint order.
 *
 * Intersection, not containment: dragging a marquee that clips an element's
 * corner selects it, which is what every editor does. Requiring full
 * containment makes large elements almost impossible to marquee-select.
 */
export function hitTestRect(scene: Scene, rect: WorldRect): Array<CanvasElement> {
  const normalised = normaliseRect(rect)
  return scene.elements.filter((element) =>
    rectsIntersect(bounds(element), normalised),
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

// src/lib/canvas-engine/camera-focus.ts
// Bring a world rectangle into view (board-undo tactical plan, Wave 4, step
// 12) — a pure SIBLING of camera.ts, not a second transform.
//
// camera.ts deliberately exports exactly one screen<->world transform pair
// (see its own file header on why: W1 and W3 were both a second, divergent
// transform at a call site). This module does not add another one. It reuses
// camera.ts's own `visibleWorldRect` to decide whether a pan is even needed,
// and derives the new camera algebraically from the SAME `screen = (world -
// camera) * zoom` relationship `Camera`'s own doc comment states and
// `zoomAt` already solves the same way (pin a world point under a screen
// point, then solve for `camera.x`/`camera.y`) — here pinning a rect's
// centre under the viewport's centre instead of a pointer position.

import { visibleWorldRect } from './camera'
import type { Camera } from './camera'
import type { WorldRect } from './hit-test'

/** CSS-pixel viewport size — same domain `visibleWorldRect` already takes. */
export interface FocusViewport {
  width: number
  height: number
}

/** Whether `rect` is FULLY inside the camera's current visible area. */
export function isRectVisible(
  camera: Camera,
  viewport: FocusViewport,
  rect: WorldRect,
): boolean {
  const visible = visibleWorldRect(camera, viewport)
  return (
    rect.x >= visible.x &&
    rect.y >= visible.y &&
    rect.x + rect.width <= visible.x + visible.width &&
    rect.y + rect.height <= visible.y + visible.height
  )
}

/**
 * Pan (never zoom) so `rect` is centred in the viewport, but only if it is
 * not already fully visible. Returns the SAME camera reference when no pan
 * is needed, so a caller can skip a `setCamera` call — and the redraw it
 * would trigger — for an element already on screen.
 */
export function focusOnRect(
  camera: Camera,
  viewport: FocusViewport,
  rect: WorldRect,
): Camera {
  if (isRectVisible(camera, viewport, rect)) return camera
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  // Reuses `visibleWorldRect` (already imported, already called by
  // `isRectVisible` above) rather than re-deriving `viewport / camera.zoom`
  // inline — a second, ad hoc `/ camera.zoom` outside camera.ts is exactly
  // the seed the single-transform-pair rule (this file's own header) exists
  // to prevent, even though the arithmetic here was correct.
  const visible = visibleWorldRect(camera, viewport)
  return {
    x: centerX - visible.width / 2,
    y: centerY - visible.height / 2,
    zoom: camera.zoom,
  }
}

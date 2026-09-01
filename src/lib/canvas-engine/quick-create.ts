// src/lib/canvas-engine/quick-create.ts
// Where a quick-created element lands (canvas quick-create-handles tactical
// plan, Wave 2, step 6).
//
// Clicking a creation handle says WHICH WAY, not where. This module turns
// that direction into a position: one gap out from the source's edge, centred
// on the source's other axis, then pushed further out until it overlaps
// nothing already on the board.
//
// World space throughout — this module never sees a camera, for the same
// reason `connector-geometry.ts` does not.
//
// Pure module: no React, no DOM, no database.

import { rectsIntersect } from './hit-test'
import { snapPoint } from './grid'
import type { WorldRect } from './hit-test'

/** The four sides a creation handle can sit on. */
export type QuickCreateDirection = 'top' | 'right' | 'bottom' | 'left'

export const QUICK_CREATE_DIRECTIONS: ReadonlyArray<QuickCreateDirection> = [
  'top',
  'right',
  'bottom',
  'left',
]

/**
 * Distance from the source's edge to the new element's edge, in world units,
 * and the step size the collision search advances by.
 *
 * A whole multiple of `GRID_SIZE`, and that is a requirement rather than a
 * round number for its own sake: a quick-created element has to land on the
 * dot grid like every other new element, and a gap of, say, 48 would knock a
 * grid-aligned source's sibling half a cell off it on the search axis. At two
 * cells the snapping below is a no-op along that axis, so "exactly one gap
 * between the two edges" still holds for any source already on the grid.
 */
export const QUICK_CREATE_GAP = 40

/**
 * Runaway guard on the collision search.
 *
 * A board dense enough to occupy 40 consecutive slots in one direction is a
 * board where sliding further is no longer helping, and an unbounded loop
 * here would hang the gesture on the pointerup that started it. On exhaustion
 * the last candidate is used as-is: an overlapping element the user can drag
 * apart beats a click that silently did nothing.
 */
export const QUICK_CREATE_MAX_SLIDE_STEPS = 40

/**
 * Board coordinate bounds, mirroring `boardCoordSchema` in src/data/schema.ts.
 *
 * Duplicated rather than imported because this directory imports nothing (see
 * scene.ts) — importing it would pull Zod into the pure engine's graph, which
 * is exactly what `canvas-element-adapter.ts` exists to prevent. The
 * duplication is not left on trust: `quick-create.test.ts` imports BOTH and
 * asserts they are equal, so a change on either side fails a test rather than
 * silently producing positions the write path rejects.
 */
export const MAX_BOARD_COORD = 10_000_000

function clampCoord(value: number): number {
  return Math.min(MAX_BOARD_COORD, Math.max(-MAX_BOARD_COORD, value))
}

/** Unit step for one direction, in world space (y grows downward). */
function stepFor(direction: QuickCreateDirection): { x: number; y: number } {
  switch (direction) {
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
 * The first candidate position: one gap beyond the source's edge on the
 * chosen side, centred on the source across the other axis.
 *
 * Centred, not corner-aligned, because a chain of differently-sized elements
 * built by repeated clicks should read as a row, not a staircase.
 */
function firstCandidate(
  source: WorldRect,
  direction: QuickCreateDirection,
  size: { width: number; height: number },
): { x: number; y: number } {
  const centreX = source.x + source.width / 2 - size.width / 2
  const centreY = source.y + source.height / 2 - size.height / 2
  switch (direction) {
    case 'top':
      return { x: centreX, y: source.y - QUICK_CREATE_GAP - size.height }
    case 'right':
      return { x: source.x + source.width + QUICK_CREATE_GAP, y: centreY }
    case 'bottom':
      return { x: centreX, y: source.y + source.height + QUICK_CREATE_GAP }
    case 'left':
      return { x: source.x - QUICK_CREATE_GAP - size.width, y: centreY }
  }
}

/**
 * Where to put an element quick-created from `source` towards `direction`.
 *
 * Walks outward one `QUICK_CREATE_GAP` at a time until the candidate rect
 * overlaps nothing in `occupied`, then clamps into the board's coordinate
 * range so the write path can never reject the result.
 *
 * `occupied` should hold every element already on the board EXCEPT the source
 * itself — including connectors is harmless (their stored bounds are a
 * placeholder, so they never block) but pointless; callers filter them out.
 *
 * Note the order: search first, clamp last. Clamping inside the loop would
 * pin every remaining step to the same position and spin out the full step
 * budget against a candidate that can no longer move.
 */
export function quickCreatePlacement(
  source: WorldRect,
  direction: QuickCreateDirection,
  size: { width: number; height: number },
  occupied: ReadonlyArray<WorldRect> = [],
): { x: number; y: number } {
  const step = stepFor(direction)
  const raw = firstCandidate(source, direction, size)
  // Snapped BEFORE the overlap test, not after it. Snapping the answer on the
  // way out would move it by up to half a cell into an element the search had
  // just proved it clear of; snapping each candidate first means the rect
  // that was tested is the rect that is returned. The CROSS axis is what
  // makes this necessary — centring halves a size difference, which produces
  // half-cell offsets even when both elements are themselves on the grid.
  const candidate = snapPoint(raw)

  for (let i = 0; i < QUICK_CREATE_MAX_SLIDE_STEPS; i += 1) {
    const rect: WorldRect = {
      ...candidate,
      width: size.width,
      height: size.height,
    }
    const blocked = occupied.some((other) => rectsIntersect(rect, other))
    if (!blocked) break
    // Advance by the gap, then re-snap. The gap is a whole number of cells,
    // so for a grid-aligned candidate the re-snap changes nothing and the
    // step is exactly `QUICK_CREATE_GAP`; for one inherited from an off-grid
    // source it is at most half a cell either side of it. Strictly outward
    // either way, so the search terminates exactly as it did before.
    const next = snapPoint({
      x: candidate.x + step.x * QUICK_CREATE_GAP,
      y: candidate.y + step.y * QUICK_CREATE_GAP,
    })
    candidate.x = next.x
    candidate.y = next.y
  }

  return { x: clampCoord(candidate.x), y: clampCoord(candidate.y) }
}

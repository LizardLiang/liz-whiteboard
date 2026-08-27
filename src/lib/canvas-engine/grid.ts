// src/lib/canvas-engine/grid.ts
// The board's dot grid: where the dots are, and how a newly created element
// is made to land on them.
//
// FigJam's board reads as paper because two things agree: the dots are
// evenly spaced in WORLD units (they pan and zoom with the board rather than
// sitting on the glass), and a new shape's borders land exactly on them. Both
// facts come from the single `GRID_SIZE` below — nothing else in the codebase
// may invent its own spacing, or the dots and the snapping would drift apart
// and the board would look almost-aligned, which is worse than not snapping
// at all.
//
// Pure module: no React, no DOM, no database, no `window`. The camera arrives
// as an argument the same way it does everywhere else in this directory. The
// one browser-shaped thing here is `dotGridBackground`, and it returns plain
// strings — CSS values, not a style object applied to a node.

import type { Camera } from './camera'
import type { WorldRect } from './hit-test'

/**
 * Distance between two neighbouring dots, in WORLD units.
 *
 * Chosen so the two default sizes in `use-canvas-input.ts` are whole
 * multiples of it (160x100 for a shape, 240x40 for text): a click-created
 * element then has all four borders on dots without any size adjustment.
 */
export const GRID_SIZE = 20

/**
 * The smallest on-screen gap, in CSS pixels, the drawn dots are allowed to
 * shrink to before the grid is thinned.
 *
 * Below roughly this, neighbouring dots blur into a flat grey wash that reads
 * as a dirty background rather than as a grid. At 12 the base grid survives
 * down to 0.6x zoom and only then starts doubling.
 */
export const MIN_GRID_SCREEN_STEP = 12

/** Drawn radius of one dot, in CSS pixels — constant at every zoom. */
export const GRID_DOT_RADIUS = 1

/**
 * The world-space spacing actually drawn at this zoom.
 *
 * Always `GRID_SIZE * 2^n`, never an arbitrary multiple: every dot drawn at a
 * thinned spacing is still a real grid point, so an element snapped with
 * `snapCoord` (which always uses the full-resolution `GRID_SIZE`) can never
 * land between two VISIBLE dots — it can only land on a dot the current zoom
 * has chosen not to draw.
 */
export function gridSpacingFor(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return GRID_SIZE
  let spacing = GRID_SIZE
  // Bounded by construction: `MIN_ZOOM` is 0.1, so this doubles at most four
  // times. The explicit ceiling is a guard against a future zoom floor, not
  // against today's.
  while (spacing * zoom < MIN_GRID_SCREEN_STEP && spacing < GRID_SIZE * 1024) {
    spacing *= 2
  }
  return spacing
}

/**
 * One world coordinate, moved to the nearest grid line.
 *
 * The `|| 0` is not decoration: `Math.round(-9 / 20) * 20` is negative zero,
 * which survives into stored coordinates and makes `Object.is` comparisons
 * (which is what `toBe` and `toEqual` use) fail against a plain 0 for reasons
 * that have nothing to do with the geometry.
 */
export function snapCoord(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE || 0
}

/** One world point, moved to the nearest dot. */
export function snapPoint(point: { x: number; y: number }): {
  x: number
  y: number
} {
  return { x: snapCoord(point.x), y: snapCoord(point.y) }
}

/**
 * A size rounded to whole cells, never smaller than `minCells` of them.
 *
 * Used for the default-sized element a plain click creates: snapping the
 * origin alone would put the top-left on a dot and leave the other two
 * borders between them.
 */
export function snapSize(
  size: { width: number; height: number },
  minCells = 1,
): { width: number; height: number } {
  const min = GRID_SIZE * minCells
  return {
    width: Math.max(min, snapCoord(size.width)),
    height: Math.max(min, snapCoord(size.height)),
  }
}

/**
 * A rectangle with all FOUR borders on grid lines.
 *
 * Each edge is snapped independently — left/top and right/bottom — rather
 * than snapping the origin and keeping the dragged size. Snapping the origin
 * alone moves the whole rectangle and leaves its far borders off the dots,
 * which is precisely the thing the user asked not to happen.
 *
 * The far edges are then held at least `minCells` away from the near ones, so
 * a drag shorter than half a cell still produces a visible element instead of
 * a zero-sized one the write path would reject.
 */
export function snapRect(rect: WorldRect, minCells = 1): WorldRect {
  const min = GRID_SIZE * minCells
  const left = snapCoord(rect.x)
  const top = snapCoord(rect.y)
  const right = Math.max(snapCoord(rect.x + rect.width), left + min)
  const bottom = Math.max(snapCoord(rect.y + rect.height), top + min)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The two dot colours, one per theme. */
export const GRID_DOT_COLOR = {
  light: 'rgba(15, 23, 42, 0.24)',
  dark: 'rgba(226, 232, 240, 0.22)',
} as const

/** The CSS declarations that paint the dot grid for this camera. */
export interface DotGridBackground {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
}

/**
 * The dot grid as a repeating CSS background rather than canvas draw calls.
 *
 * Deliberate, and worth the note: the renderer clears to transparent and the
 * board's surface colour is already a themed CSS background (see `drawScene`),
 * so the grid belongs on the same layer. Drawing it on the canvas would mean
 * thousands of fill calls on EVERY frame — a full redraw is what this engine
 * does — to paint something that never changes except when the camera does.
 * As a background it is composited once by the browser, and it is also why
 * exported images carry no grid, which matches FigJam.
 *
 * The tile is one cell with the dot at its centre, so the background origin
 * is pulled back half a cell to put a dot exactly on the world-space grid
 * line through 0. CSS repeats the tile in both directions from there, in both
 * signs, which is what makes the phase correct at any pan.
 */
export function dotGridBackground(
  camera: Camera,
  theme: 'light' | 'dark' = 'light',
): DotGridBackground {
  const spacing = gridSpacingFor(camera.zoom)
  const step = spacing * camera.zoom
  const color = GRID_DOT_COLOR[theme]
  const r = GRID_DOT_RADIUS
  return {
    // Two stops rather than one hard edge: the outer stop is what antialiases
    // the dot, which at a 1px radius is the difference between a dot and a
    // square speck.
    backgroundImage: `radial-gradient(circle at center, ${color} 0, ${color} ${r}px, transparent ${r + 0.5}px)`,
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${-camera.x * camera.zoom - step / 2}px ${-camera.y * camera.zoom - step / 2}px`,
  }
}

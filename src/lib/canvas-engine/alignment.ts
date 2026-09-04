// src/lib/canvas-engine/alignment.ts
// Alignment guides: the red lines that appear while a shape is dragged or
// resized next to its neighbours, and the small pull that makes the two
// actually line up.
//
// WHY THIS IS A SEPARATE SNAP FROM `grid.ts`
// The dot grid snaps a NEW element's borders onto fixed world coordinates.
// This snaps a MOVING element onto whatever its neighbours happen to sit at,
// which is almost never a grid coordinate. The two answer different questions
// and would fight if both ran on the same gesture, so the surface keeps them
// apart by phase rather than by priority: `grid.ts` owns creation, this owns
// move and resize. `use-canvas-input.ts` is where that split is enforced, and
// its `'move'`/`'resize'` cases carry the note.
//
// Six alignments per pair, three per axis: left/centre/right on x, and
// top/middle/bottom on y. There is no seventh case — "same size as" and
// "equally spaced from" are different features (see `AlignmentGuide` on why
// the shape of this data leaves room for the second one).
//
// TOLERANCE IS A SCREEN DISTANCE, ALWAYS. A world-space tolerance is a
// plausible-looking bug: at 0.1x zoom every element on the board is within a
// few world units of every other one, so the whole board snaps to itself and
// nothing can be placed. `alignmentTolerance` converts once, at the call
// site, from the one number a user can actually perceive — pixels on glass.
//
// Pure module: no React, no DOM, no timers. The camera and the viewport
// arrive as arguments, the same contract every other file in this directory
// follows.

import { visibleWorldRect } from './camera'
import type { Camera } from './camera'
import type { WorldRect } from './hit-test'
import type { Scene } from './scene'

/**
 * How close two lines must come, in SCREEN pixels, before they snap.
 *
 * Six is deliberately smaller than `CLICK_SLOP` (4) plus a grip's half-width:
 * a snap that engages from further away feels like the board is grabbing the
 * element, and it makes deliberate near-misses impossible to place.
 */
export const ALIGN_TOLERANCE_PX = 6

/** `ALIGN_TOLERANCE_PX` in world units at this zoom — see the file header. */
export function alignmentTolerance(camera: Camera): number {
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1
  return ALIGN_TOLERANCE_PX / zoom
}

/**
 * One guide line, in WORLD space.
 *
 * `axis: 'x'` means a VERTICAL line standing at world x = `position` — the
 * axis names the coordinate the line is pinned to, not the direction it runs
 * in, which is the convention `linesOf` below also uses. `from`/`to` are its
 * extent along the other axis.
 *
 * The extent is carried per guide rather than derived by the renderer because
 * the guide only spans the elements that are actually aligned (decision 4 in
 * the ticket): a line drawn edge-to-edge across the viewport is louder than
 * the thing it is reporting, and on a dense board several of them at once are
 * unreadable. It is also the field an equal-spacing indicator would extend
 * later, which is why this is a rectangle-agnostic segment and not a pair of
 * element ids.
 */
export interface AlignmentGuide {
  axis: 'x' | 'y'
  position: number
  from: number
  to: number
}

/** The result of aligning a rect that is being MOVED. */
export interface AlignmentOutcome {
  /** Shift to add to the moving rect. Zero on an axis that found no match. */
  dx: number
  dy: number
  guides: ReadonlyArray<AlignmentGuide>
}

export const NO_ALIGNMENT: AlignmentOutcome = { dx: 0, dy: 0, guides: [] }

/** The result of aligning a rect that is being RESIZED. */
export interface ResizeAlignment {
  rect: WorldRect
  guides: ReadonlyArray<AlignmentGuide>
}

/** Which edge of a resized rect a grip moves on one axis. */
export type AlignEdge = 'min' | 'max'

/** The three alignable lines a rect offers on one axis. */
interface AxisLines {
  min: number
  mid: number
  max: number
}

/**
 * How close two world coordinates must be to count as the SAME line when
 * deciding which guides to draw.
 *
 * This is not a second tolerance: by the time `guidesFor` runs, the shift has
 * already been applied, so genuinely aligned lines differ only by the float
 * error of `min + size / 2`. Reusing the snap tolerance here instead would
 * draw guides for neighbours that were merely nearby and did NOT get aligned,
 * which is the one thing a guide must never claim.
 */
const COINCIDENT = 1e-6

function linesOf(rect: WorldRect, axis: 'x' | 'y'): AxisLines {
  const min = axis === 'x' ? rect.x : rect.y
  const size = axis === 'x' ? rect.width : rect.height
  return { min, mid: min + size / 2, max: min + size }
}

function valuesOf(lines: AxisLines): [number, number, number] {
  return [lines.min, lines.mid, lines.max]
}

/**
 * The single best shift along one axis, or null when nothing is in range.
 *
 * "Best" is the smallest movement, not the first match: with a neighbour's
 * left edge 5px away and its centre 2px away, the element goes to the centre.
 * Ties keep the EARLIER candidate — `>= bestDistance` rather than `>` — so a
 * board with two neighbours at mirrored distances snaps the same way every
 * frame instead of flickering between them.
 */
function bestShift(
  movingValues: ReadonlyArray<number>,
  candidates: ReadonlyArray<WorldRect>,
  axis: 'x' | 'y',
  tolerance: number,
): number | null {
  let bestDistance = Number.POSITIVE_INFINITY
  let shift: number | null = null
  for (const candidate of candidates) {
    for (const target of valuesOf(linesOf(candidate, axis))) {
      for (const value of movingValues) {
        const delta = target - value
        const distance = Math.abs(delta)
        if (distance > tolerance || distance >= bestDistance) continue
        bestDistance = distance
        shift = delta
      }
    }
  }
  return shift
}

/**
 * Every guide to draw on one axis, given a rect that has ALREADY been shifted.
 *
 * Candidates sharing a position are merged into one line whose extent covers
 * all of them plus the moving rect, so three left-aligned shapes produce one
 * guide rather than three stacked on the same pixel.
 */
function guidesFor(
  moving: WorldRect,
  movingValues: ReadonlyArray<number>,
  candidates: ReadonlyArray<WorldRect>,
  axis: 'x' | 'y',
): Array<AlignmentGuide> {
  const other = axis === 'x' ? 'y' : 'x'
  const movingSpan = linesOf(moving, other)
  // Keyed by a fixed-precision string rather than the raw number: two
  // candidates whose centres are the same line arithmetically can differ in
  // the last bit, and a Map keyed on the float would draw both.
  const byPosition = new Map<
    string,
    { position: number; from: number; to: number }
  >()
  for (const candidate of candidates) {
    for (const target of valuesOf(linesOf(candidate, axis))) {
      if (!movingValues.some((value) => Math.abs(value - target) <= COINCIDENT))
        continue
      const span = linesOf(candidate, other)
      const key = target.toFixed(4)
      const existing = byPosition.get(key)
      if (existing) {
        existing.from = Math.min(existing.from, span.min)
        existing.to = Math.max(existing.to, span.max)
        continue
      }
      byPosition.set(key, {
        position: target,
        from: Math.min(movingSpan.min, span.min),
        to: Math.max(movingSpan.max, span.max),
      })
    }
  }
  return [...byPosition.values()].map((line) => ({ axis, ...line }))
}

/**
 * Align a rect that is being dragged.
 *
 * `moving` is where the pointer alone would put it; the returned `dx`/`dy` are
 * the correction on top of that. Applying them to the DRAG's own offset — not
 * to the element's live position — is what keeps a drag from accumulating its
 * own corrections frame after frame and creeping away from the pointer.
 *
 * Guides come back even when both shifts are zero. That is the already-aligned
 * case, and it is exactly when the user most needs to be told.
 */
export function alignMovedRect(
  moving: WorldRect,
  candidates: ReadonlyArray<WorldRect>,
  tolerance: number,
): AlignmentOutcome {
  if (candidates.length === 0) return NO_ALIGNMENT
  const dx =
    bestShift(valuesOf(linesOf(moving, 'x')), candidates, 'x', tolerance) ?? 0
  const dy =
    bestShift(valuesOf(linesOf(moving, 'y')), candidates, 'y', tolerance) ?? 0
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const guides = [
    ...guidesFor(snapped, valuesOf(linesOf(snapped, 'x')), candidates, 'x'),
    ...guidesFor(snapped, valuesOf(linesOf(snapped, 'y')), candidates, 'y'),
  ]
  return { dx, dy, guides }
}

/** Move ONE edge of a rect along one axis, refusing a shift that would collapse it. */
function withEdgeShifted(
  rect: WorldRect,
  axis: 'x' | 'y',
  edge: AlignEdge,
  shift: number,
  minSize: number,
): WorldRect {
  const sizeKey = axis === 'x' ? 'width' : 'height'
  const size = rect[sizeKey]
  const next = edge === 'min' ? size - shift : size + shift
  // A snap is a convenience; the minimum size is a constraint. When they
  // disagree the constraint wins and the edge simply does not snap — clamping
  // to `minSize` instead would move the edge somewhere the user did not aim
  // and no guide would explain.
  if (next < minSize) return rect
  const origin = edge === 'min' ? rect[axis] + shift : rect[axis]
  return { ...rect, [axis]: origin, [sizeKey]: next }
}

/**
 * Align a rect that is being resized.
 *
 * Only the edges the grip actually moves take part, on either axis — a `se`
 * drag aligns right and bottom and leaves left and top exactly where they
 * were. The rect's centres are deliberately not candidates here: a centre is
 * not something a resize grip can place, so snapping to one would move an
 * edge the user is not holding.
 *
 * `edges` is derived from the grip by the caller rather than from a
 * `ResizeHandle` here, so this module stays free of `render.ts` and the two
 * cannot form an import cycle.
 */
export function alignResizedRect(
  moving: WorldRect,
  candidates: ReadonlyArray<WorldRect>,
  tolerance: number,
  edges: { x: AlignEdge | null; y: AlignEdge | null },
  minSize: number,
): ResizeAlignment {
  if (candidates.length === 0) return { rect: moving, guides: [] }
  let rect = moving
  for (const axis of ['x', 'y'] as const) {
    const edge = edges[axis]
    if (!edge) continue
    const lines = linesOf(rect, axis)
    const shift = bestShift([lines[edge]], candidates, axis, tolerance)
    if (shift === null || shift === 0) continue
    rect = withEdgeShifted(rect, axis, edge, shift, minSize)
  }
  const guides: Array<AlignmentGuide> = []
  for (const axis of ['x', 'y'] as const) {
    const edge = edges[axis]
    if (!edge) continue
    guides.push(
      ...guidesFor(rect, [linesOf(rect, axis)[edge]], candidates, axis),
    )
  }
  return { rect, guides }
}

/**
 * The neighbours a gesture may align against.
 *
 * Three exclusions, each of which is a real defect if dropped:
 *
 * - `exclude` holds the ids being moved. Without it an element aligns to
 *   itself and every drag snaps back to where it started. For a group drag
 *   the caller passes the whole subtree, since the members move too.
 * - Connectors carry a 1x1 placeholder rect, not a real box (see
 *   `CanvasElement.connector`), so their "edges" are a point at an
 *   arbitrary coordinate that nothing on screen sits at.
 * - Off-screen elements are dropped because this runs on every
 *   `pointermove` and `hit-test.ts` already records that a linear scan of
 *   the whole scene tops out in the low thousands of elements. Filtering to
 *   what the user can see also matches what a guide can usefully point at.
 *
 * The visible rect is grown by the tolerance first, so an element just past
 * the edge of the viewport whose line is still within snapping distance is
 * not silently skipped.
 */
export function alignmentCandidates(
  scene: Scene,
  camera: Camera,
  viewport: { width: number; height: number },
  exclude: ReadonlySet<string>,
): Array<WorldRect> {
  const tolerance = alignmentTolerance(camera)
  const visible = visibleWorldRect(camera, viewport)
  const left = visible.x - tolerance
  const top = visible.y - tolerance
  const right = visible.x + visible.width + tolerance
  const bottom = visible.y + visible.height + tolerance

  const candidates: Array<WorldRect> = []
  for (const element of scene.elements) {
    if (exclude.has(element.id)) continue
    if (element.connector) continue
    if (element.width <= 0 || element.height <= 0) continue
    if (element.x > right || element.x + element.width < left) continue
    if (element.y > bottom || element.y + element.height < top) continue
    candidates.push({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    })
  }
  return candidates
}

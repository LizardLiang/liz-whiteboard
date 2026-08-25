// src/lib/react-flow/shape-geometry.ts
// Pure boundary-intersection maths for shape-to-shape connectors (D-3,
// floating-edge attachment). Imports no React and no React Flow runtime —
// only types — so it is unit-testable in complete isolation (tech-spec §4).
//
// `edge-routing.ts` is NOT reusable here: it is 100% column-handle-ID
// shaped (createColumnHandleId/parseColumnHandleId, calculateBestSides).
// Do not import from it or extend it for shapes.

import type { QuickCreateDirection } from '@/lib/react-flow/types'
import type { ShapeKind } from '@/data/schema'
import { MAX_BOARD_COORD } from '@/data/schema'
import {
  QUICK_CREATE_GAP,
  QUICK_CREATE_MAX_SLIDE_STEPS,
} from '@/lib/react-flow/types'

export interface ShapeBounds {
  kind: ShapeKind
  /** Top-left, flow coordinates. */
  x: number
  y: number
  width: number
  height: number
}

/** Below this, two centres are treated as coincident (guard 1). */
const COINCIDENT_EPSILON = 1e-6

/** Floor applied to a zero-size half-extent before computing (guard 2). */
const MIN_HALF_EXTENT = 0.5

/**
 * The point where the ray from `bounds`'s centre toward `toward` exits
 * `bounds`'s boundary, per tech-spec §4's per-kind closed-form solutions.
 *
 * Three degenerate guards, all required (tech-spec §4):
 * 1. Coincident centres (`hypot(dx, dy) < 1e-6`): substitute direction
 *    (0, -1) and return the top-centre of the bounds. Without this the
 *    ellipse/diamond formulas divide by zero and emit NaN into an SVG `d`
 *    attribute, silently blanking the whole edge layer in some browsers.
 * 2. Zero-size bounds (a === 0 or b === 0, possible transiently before React
 *    Flow has measured a node): clamp both half-extents to 0.5.
 * 3. Unmeasured node fallback is the CALLER's responsibility
 *    (connectorEndpoints below) — this function only ever sees real numbers.
 */
export function boundaryPoint(
  bounds: ShapeBounds,
  toward: { x: number; y: number },
): { x: number; y: number } {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2

  let dx = toward.x - cx
  let dy = toward.y - cy

  // Guard 1: coincident centres — substitute (0, -1) (top-centre direction).
  if (Math.hypot(dx, dy) < COINCIDENT_EPSILON) {
    dx = 0
    dy = -1
  }

  // Guard 2: zero-size bounds — clamp half-extents before dividing.
  const a = Math.max(bounds.width / 2, MIN_HALF_EXTENT)
  const b = Math.max(bounds.height / 2, MIN_HALF_EXTENT)

  let t: number
  switch (bounds.kind) {
    case 'rectangle':
    case 'text': {
      // max(|X|/a, |Y|/b) = 1  =>  t = min(a/|dx|, b/|dy|), zero divisor -> +Infinity
      const tx = dx === 0 ? Number.POSITIVE_INFINITY : a / Math.abs(dx)
      const ty = dy === 0 ? Number.POSITIVE_INFINITY : b / Math.abs(dy)
      t = Math.min(tx, ty)
      break
    }
    case 'ellipse': {
      // (X/a)^2 + (Y/b)^2 = 1  =>  t = 1 / sqrt((dx/a)^2 + (dy/b)^2)
      t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
      break
    }
    case 'diamond': {
      // |X|/a + |Y|/b = 1  =>  t = 1 / (|dx|/a + |dy|/b)
      t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
      break
    }
    case 'line':
      // Never called: a line is not a valid connector endpoint (tech-spec §4).
      throw new Error('boundaryPoint: line shapes have no defined boundary')
  }

  return { x: cx + dx * t, y: cy + dy * t }
}

/**
 * Guard 3 (unmeasured node): React Flow may not have reported
 * `measured.width`/`measured.height` yet (e.g. the first render after a
 * shape is created). Falling back to the persisted `width`/`height` from
 * `data.shape` means an edge is never rendered from `undefined` — which
 * would otherwise reach `boundaryPoint` as `NaN` and blank the whole SVG
 * edge layer in some browsers (tech-spec §4, Known Trap).
 */
export function resolveMeasuredSize(
  measured: { width?: number; height?: number } | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: measured?.width ?? fallback.width,
    height: measured?.height ?? fallback.height,
  }
}

/**
 * Both endpoints of a connector, each on its own shape's boundary, aimed at
 * the OTHER shape's centre (the standard floating-edge formulation — cheap,
 * stable, symmetric).
 */
export function connectorEndpoints(
  source: ShapeBounds,
  target: ShapeBounds,
): { sx: number; sy: number; tx: number; ty: number } {
  const targetCentre = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  }
  const sourceCentre = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  }
  const s = boundaryPoint(source, targetCentre)
  const t = boundaryPoint(target, sourceCentre)
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y }
}

/** An axis-aligned box in flow coordinates — any node type's footprint. */
export interface OccupiedRect {
  x: number
  y: number
  width: number
  height: number
}

function overlaps(a: OccupiedRect, b: OccupiedRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/**
 * Where a quick-created shape goes when a connect marker is clicked
 * (approved plan, decision D1).
 *
 * Starts one QUICK_CREATE_GAP beyond the source's edge on the clicked side,
 * centred on the source across the other axis, then slides one gap further
 * out for as long as the candidate rect overlaps anything in `occupied` —
 * so clicking "right" four times on a dense board yields a clean row rather
 * than a stack. `QUICK_CREATE_MAX_SLIDE_STEPS` bounds the walk; a board
 * pathological enough to exhaust it gets the last candidate rather than a
 * hang.
 *
 * Pure, and works entirely in FLOW units — it never touches
 * screenToFlowPosition. That is deliberate: W1/W3 were both draw-preview
 * bugs caused by mixing screen and flow space.
 *
 * `occupied` may include the source shape itself; a rect identical to the
 * source's own bounds is ignored, so callers can pass the whole node list
 * unfiltered.
 */
export function quickCreatePlacement(
  source: ShapeBounds,
  direction: QuickCreateDirection,
  size: { width: number; height: number },
  occupied: Array<OccupiedRect>,
): { positionX: number; positionY: number } {
  const sourceRect: OccupiedRect = {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
  }
  const obstacles = occupied.filter(
    (rect) =>
      !(
        rect.x === sourceRect.x &&
        rect.y === sourceRect.y &&
        rect.width === sourceRect.width &&
        rect.height === sourceRect.height
      ),
  )

  // Centred on the source across the axis we are NOT moving along.
  const centredX = source.x + source.width / 2 - size.width / 2
  const centredY = source.y + source.height / 2 - size.height / 2

  function candidateAt(distance: number): { x: number; y: number } {
    switch (direction) {
      case 'right':
        return { x: source.x + source.width + distance, y: centredY }
      case 'left':
        return { x: source.x - size.width - distance, y: centredY }
      case 'bottom':
        return { x: centredX, y: source.y + source.height + distance }
      case 'top':
        return { x: centredX, y: source.y - size.height - distance }
    }
  }

  // Slide by JUMPING past the blocking rects rather than by one gap at a
  // time: shapes are routinely wider than the gap, so a fixed-step walk
  // both takes several passes and lands at an arbitrary offset instead of a
  // clean gap beyond the obstacle. Each pass clears every rect the current
  // candidate hits, so this converges in one or two passes in practice; the
  // step budget only bounds pathological input.
  /** How far from the source's edge the far side of every hit rect sits. */
  function clearingDistance(hits: Array<OccupiedRect>): number {
    switch (direction) {
      case 'right':
        return Math.max(
          ...hits.map((r) => r.x + r.width - (source.x + source.width)),
        )
      case 'left':
        return Math.max(...hits.map((r) => source.x - r.x))
      case 'bottom':
        return Math.max(
          ...hits.map((r) => r.y + r.height - (source.y + source.height)),
        )
      case 'top':
        return Math.max(...hits.map((r) => source.y - r.y))
    }
  }

  let distance = QUICK_CREATE_GAP
  let placed = candidateAt(distance)
  for (let step = 0; step < QUICK_CREATE_MAX_SLIDE_STEPS; step += 1) {
    placed = candidateAt(distance)
    const candidate: OccupiedRect = { ...placed, ...size }
    const hits = obstacles.filter((rect) => overlaps(candidate, rect))
    if (hits.length === 0) break
    distance = clearingDistance(hits) + QUICK_CREATE_GAP
  }

  const clamp = (v: number) =>
    Math.min(MAX_BOARD_COORD, Math.max(-MAX_BOARD_COORD, v))

  return { positionX: clamp(placed.x), positionY: clamp(placed.y) }
}

// src/lib/react-flow/shape-geometry.ts
// Pure boundary-intersection maths for shape-to-shape connectors (D-3,
// floating-edge attachment). Imports no React and no React Flow runtime —
// only types — so it is unit-testable in complete isolation (tech-spec §4).
//
// `edge-routing.ts` is NOT reusable here: it is 100% column-handle-ID
// shaped (createColumnHandleId/parseColumnHandleId, calculateBestSides).
// Do not import from it or extend it for shapes.

import type { ShapeKind } from '@/data/schema'

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

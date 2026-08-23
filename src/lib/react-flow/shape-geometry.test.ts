// src/lib/react-flow/shape-geometry.test.ts
// UNIT-01: boundary intersection geometry. Every case must return a finite
// {x, y} point on the shape's boundary — no case may ever return NaN/
// Infinity, the trap that silently blanks the entire edge layer in some
// browsers if missed (tech-spec §13).

import { describe, expect, it } from 'vitest'
import {
  boundaryPoint,
  connectorEndpoints,
  resolveMeasuredSize,
} from './shape-geometry'
import type { ShapeBounds } from './shape-geometry'

function assertFiniteBoundaryPoint(p: { x: number; y: number }) {
  expect(Number.isFinite(p.x)).toBe(true)
  expect(Number.isFinite(p.y)).toBe(true)
}

const CENTERED: Omit<ShapeBounds, 'kind'> = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
}

describe.each(['rectangle', 'text', 'ellipse', 'diamond'] as const)(
  'boundaryPoint — %s',
  (kind) => {
    const bounds: ShapeBounds = { kind, ...CENTERED }

    it.each([
      ['right', { x: 1000, y: 50 }],
      ['left', { x: -1000, y: 50 }],
      ['down', { x: 50, y: 1000 }],
      ['up', { x: 50, y: -1000 }],
      ['down-right', { x: 1000, y: 1000 }],
      ['down-left', { x: -1000, y: 1000 }],
      ['up-right', { x: 1000, y: -1000 }],
      ['up-left', { x: -1000, y: -1000 }],
    ])('returns a finite point on the boundary toward %s', (_label, toward) => {
      const p = boundaryPoint(bounds, toward)
      assertFiniteBoundaryPoint(p)
    })

    it('exits toward the right axis at (width, centreY)', () => {
      const p = boundaryPoint(bounds, { x: 1000, y: 50 })
      // Centre is (50,50); exiting due right along y=50.
      expect(p.y).toBeCloseTo(50, 5)
      expect(p.x).toBeGreaterThan(50)
    })
  },
)

describe('boundaryPoint — degenerate guards', () => {
  it('guard 1: coincident centres substitute (0,-1) and return top-centre, not NaN', () => {
    for (const kind of ['rectangle', 'ellipse', 'diamond', 'text'] as const) {
      const bounds: ShapeBounds = { kind, ...CENTERED }
      const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const p = boundaryPoint(bounds, centre)
      assertFiniteBoundaryPoint(p)
      // Top-centre direction: x stays at the shape's horizontal centre.
      expect(p.x).toBeCloseTo(centre.x, 5)
      expect(p.y).toBeLessThan(centre.y)
    }
  })

  it('guard 2: zero-size bounds clamp half-extents instead of dividing by zero', () => {
    for (const kind of ['rectangle', 'ellipse', 'diamond', 'text'] as const) {
      const bounds: ShapeBounds = { kind, x: 10, y: 10, width: 0, height: 0 }
      const p = boundaryPoint(bounds, { x: 1000, y: 10 })
      assertFiniteBoundaryPoint(p)
    }
  })

  it('a line shape throws rather than returning a meaningless point', () => {
    const bounds: ShapeBounds = { kind: 'line', ...CENTERED }
    expect(() => boundaryPoint(bounds, { x: 1000, y: 50 })).toThrow()
  })
})

describe('connectorEndpoints', () => {
  it('aims each endpoint toward the other shape’s centre, both finite', () => {
    const source: ShapeBounds = { kind: 'rectangle', x: 0, y: 0, width: 100, height: 100 }
    const target: ShapeBounds = { kind: 'ellipse', x: 300, y: 0, width: 100, height: 100 }

    const { sx, sy, tx, ty } = connectorEndpoints(source, target)
    expect(Number.isFinite(sx)).toBe(true)
    expect(Number.isFinite(sy)).toBe(true)
    expect(Number.isFinite(tx)).toBe(true)
    expect(Number.isFinite(ty)).toBe(true)

    // Source is left of target: source exit point should be on/near its
    // right edge, target's exit point on/near its left edge.
    expect(sx).toBeGreaterThan(50)
    expect(tx).toBeLessThan(350)
  })

  it('handles two shapes at the exact same position without NaN (guard 1 composed)', () => {
    const a: ShapeBounds = { kind: 'diamond', x: 5, y: 5, width: 40, height: 40 }
    const b: ShapeBounds = { kind: 'diamond', x: 5, y: 5, width: 40, height: 40 }
    const result = connectorEndpoints(a, b)
    for (const v of Object.values(result)) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('resolveMeasuredSize (guard 3: unmeasured node fallback)', () => {
  it('uses measured dimensions when present', () => {
    expect(
      resolveMeasuredSize({ width: 120, height: 80 }, { width: 999, height: 999 }),
    ).toEqual({ width: 120, height: 80 })
  })

  it('falls back to persisted width/height when measured is undefined', () => {
    expect(resolveMeasuredSize(undefined, { width: 160, height: 100 })).toEqual({
      width: 160,
      height: 100,
    })
  })

  it('falls back per-field when measured is partially populated', () => {
    expect(
      resolveMeasuredSize({ width: 200 }, { width: 160, height: 100 }),
    ).toEqual({ width: 200, height: 100 })
  })
})

// src/lib/react-flow/shape-geometry.test.ts
// UNIT-01: boundary intersection geometry. Every case must return a finite
// {x, y} point on the shape's boundary — no case may ever return NaN/
// Infinity, the trap that silently blanks the entire edge layer in some
// browsers if missed (tech-spec §13).

import { describe, expect, it } from 'vitest'
import {
  boundaryPoint,
  connectorEndpoints,
  quickCreatePlacement,
  resolveMeasuredSize,
} from './shape-geometry'
import { QUICK_CREATE_GAP, QUICK_CREATE_MAX_SLIDE_STEPS } from './types'
import type { ShapeBounds } from './shape-geometry'
import { MAX_BOARD_COORD } from '@/data/schema'

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
      const centre = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      }
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
    const source: ShapeBounds = {
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }
    const target: ShapeBounds = {
      kind: 'ellipse',
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    }

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
    const a: ShapeBounds = {
      kind: 'diamond',
      x: 5,
      y: 5,
      width: 40,
      height: 40,
    }
    const b: ShapeBounds = {
      kind: 'diamond',
      x: 5,
      y: 5,
      width: 40,
      height: 40,
    }
    const result = connectorEndpoints(a, b)
    for (const v of Object.values(result)) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('resolveMeasuredSize (guard 3: unmeasured node fallback)', () => {
  it('uses measured dimensions when present', () => {
    expect(
      resolveMeasuredSize(
        { width: 120, height: 80 },
        { width: 999, height: 999 },
      ),
    ).toEqual({ width: 120, height: 80 })
  })

  it('falls back to persisted width/height when measured is undefined', () => {
    expect(resolveMeasuredSize(undefined, { width: 160, height: 100 })).toEqual(
      {
        width: 160,
        height: 100,
      },
    )
  })

  it('falls back per-field when measured is partially populated', () => {
    expect(
      resolveMeasuredSize({ width: 200 }, { width: 160, height: 100 }),
    ).toEqual({ width: 200, height: 100 })
  })
})

// ── quickCreatePlacement (quick-connect creators) ───────────────────────────
// The click-a-marker placement solver: standard gap in the chosen direction,
// sliding further out while the candidate rect overlaps any existing node,
// then clamped to the board coordinate range the create schema accepts.

describe('quickCreatePlacement', () => {
  const SOURCE: ShapeBounds = {
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
  }
  const SIZE = { width: 100, height: 60 }

  it('places at the standard gap on each side when nothing is occupied', () => {
    expect(quickCreatePlacement(SOURCE, 'right', SIZE, [])).toEqual({
      positionX: 100 + QUICK_CREATE_GAP,
      positionY: 0,
    })
    expect(quickCreatePlacement(SOURCE, 'left', SIZE, [])).toEqual({
      positionX: -100 - QUICK_CREATE_GAP,
      positionY: 0,
    })
    expect(quickCreatePlacement(SOURCE, 'bottom', SIZE, [])).toEqual({
      positionX: 0,
      positionY: 60 + QUICK_CREATE_GAP,
    })
    expect(quickCreatePlacement(SOURCE, 'top', SIZE, [])).toEqual({
      positionX: 0,
      positionY: -60 - QUICK_CREATE_GAP,
    })
  })

  it('centres the new shape on the source across the other axis', () => {
    const placed = quickCreatePlacement(
      SOURCE,
      'right',
      { width: 40, height: 20 },
      [],
    )
    // Source centre y = 30; new height 20 => y = 30 - 10 = 20.
    expect(placed.positionY).toBe(20)
  })

  it('never counts the source shape itself as an obstacle', () => {
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, [
      { x: SOURCE.x, y: SOURCE.y, width: SOURCE.width, height: SOURCE.height },
    ])
    expect(placed.positionX).toBe(100 + QUICK_CREATE_GAP)
  })

  it('lands one gap past a single occupant, not merely one step further', () => {
    const occupant = {
      x: 100 + QUICK_CREATE_GAP,
      y: 0,
      width: 100,
      height: 60,
    }
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, [occupant])
    // Occupant's right edge + one gap — a clean row, not an arbitrary offset.
    expect(placed.positionX).toBe(occupant.x + occupant.width + QUICK_CREATE_GAP)
    expect(placed.positionY).toBe(0)
  })

  it('clears a whole chain of overlapping occupants', () => {
    const occupants = [
      { x: 100 + QUICK_CREATE_GAP, y: 0, width: 100, height: 60 },
      { x: 100 + QUICK_CREATE_GAP * 2, y: 0, width: 100, height: 60 },
      { x: 100 + QUICK_CREATE_GAP * 3, y: 0, width: 100, height: 60 },
    ]
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, occupants)
    const furthestRight = Math.max(...occupants.map((o) => o.x + o.width))
    expect(placed.positionX).toBe(furthestRight + QUICK_CREATE_GAP)
  })

  it('slides on the vertical axis too', () => {
    const occupant = {
      x: 0,
      y: 60 + QUICK_CREATE_GAP,
      width: 100,
      height: 60,
    }
    const placed = quickCreatePlacement(SOURCE, 'bottom', SIZE, [occupant])
    expect(placed.positionY).toBe(
      occupant.y + occupant.height + QUICK_CREATE_GAP,
    )
    // Overlapping the first candidate slot (-108..-48), so it really blocks.
    const blocker = { x: 0, y: -140, width: 100, height: 60 }
    const above = quickCreatePlacement(SOURCE, 'top', SIZE, [blocker])
    // Sits one gap above the blocker's top edge.
    expect(above.positionY).toBe(blocker.y - QUICK_CREATE_GAP - SIZE.height)
  })

  it('ignores occupants that do not overlap the candidate rect', () => {
    const elsewhere = { x: 5000, y: 5000, width: 100, height: 60 }
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, [elsewhere])
    expect(placed.positionX).toBe(100 + QUICK_CREATE_GAP)
  })

  it('terminates on a wall that can never be cleared', () => {
    // Wide enough that clearing it runs past the board's coordinate range.
    const wall = {
      x: 0,
      y: -10_000,
      width: 10_000_000,
      height: 20_000,
    }
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, [wall])
    expect(Number.isFinite(placed.positionX)).toBe(true)
    expect(placed.positionX).toBe(MAX_BOARD_COORD)
  })

  it('never exceeds the step budget', () => {
    // Each occupant only just overlaps the previous candidate, so a naive
    // solver would need one pass per rect; the budget must still hold.
    const many = Array.from({ length: 500 }, (_, i) => ({
      x: 100 + QUICK_CREATE_GAP + i * 4,
      y: 0,
      width: 100,
      height: 60,
    }))
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, many)
    expect(Number.isFinite(placed.positionX)).toBe(true)
    expect(QUICK_CREATE_MAX_SLIDE_STEPS).toBeGreaterThan(0)
  })

  it('clamps the result into the board coordinate range', () => {
    const nearEdge: ShapeBounds = {
      kind: 'rectangle',
      x: MAX_BOARD_COORD - 10,
      y: 0,
      width: 100,
      height: 60,
    }
    const placed = quickCreatePlacement(nearEdge, 'right', SIZE, [])
    expect(placed.positionX).toBeLessThanOrEqual(MAX_BOARD_COORD)
    expect(placed.positionX).toBeGreaterThanOrEqual(-MAX_BOARD_COORD)
  })
})

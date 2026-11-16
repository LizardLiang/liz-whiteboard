import { describe, expect, it } from 'vitest'
import {
  flattenSmoothPath,
  nodeObstacleRect,
  placeEdgeLabel,
} from './edge-label-placement'
import type { Rect } from './edge-label-placement'

// A straight horizontal edge from x=0 to x=1000 at y=0.
const PATH = 'M0 0L1000 0'
const base = {
  path: PATH,
  mid: { x: 500, y: 0 },
  labelWidth: 60,
  labelHeight: 24,
  margin: 0,
  step: 4,
}
const table = (x: number, width: number): Rect => ({
  x,
  y: -50,
  width,
  height: 100,
})

describe('placeEdgeLabel', () => {
  it('keeps the midpoint when no table covers it', () => {
    const r = placeEdgeLabel({ ...base, obstacles: [table(0, 100)] })
    expect(r).toEqual({ x: 500, y: 0, covered: false })
  })

  it('slides along the path when the midpoint is covered', () => {
    const r = placeEdgeLabel({ ...base, obstacles: [table(400, 200)] })
    expect(r.covered).toBe(false)
    expect(r.y).toBe(0)
    // Pill (60 wide) must clear the table: centre >= 600 + 30 or <= 400 - 30.
    expect(r.x >= 630 || r.x <= 370).toBe(true)
  })

  it('returns at once for a path whose length overflows to Infinity', () => {
    // Positions near Number.MAX_VALUE: the length overflows, and an infinite
    // sample step used to spin the sampling loop forever.
    const r = placeEdgeLabel({
      ...base,
      path: 'M-1e308 0L1e308 0',
      mid: { x: 0, y: 0 },
      obstacles: [{ x: -1e308, y: -50, width: 1e308, height: 100 }],
    })
    expect(r).toEqual({ x: 0, y: 0, covered: true })
  })

  it('stays bounded on a huge but finite path', () => {
    const r = placeEdgeLabel({
      ...base,
      path: 'M0 0L1e300 0',
      mid: { x: 5e299, y: 0 },
      obstacles: [{ x: -1, y: -50, width: 1e301, height: 100 }],
    })
    expect(r.covered).toBe(true)
  })

  it('slides the shorter way', () => {
    // Table spans 450..650: the left exit (centre 420) is 80 away, the right
    // exit (centre 680) is 180 away.
    const left = placeEdgeLabel({ ...base, obstacles: [table(450, 200)] })
    expect(left.x).toBeLessThanOrEqual(420)
    expect(left.x).toBeGreaterThan(400)
    // Mirror: table 350..550, midpoint 500 is closer to the right exit.
    const right = placeEdgeLabel({ ...base, obstacles: [table(350, 200)] })
    expect(right.x).toBeGreaterThanOrEqual(580)
    expect(right.x).toBeLessThan(600)
  })

  it('flags the fallback when every point on the path is covered', () => {
    const r = placeEdgeLabel({ ...base, obstacles: [table(-100, 1200)] })
    expect(r).toEqual({ x: 500, y: 0, covered: true })
  })

  it('treats a cardinality-marker rect as an obstacle', () => {
    const marker: Rect = { x: 480, y: -10, width: 40, height: 20 }
    const r = placeEdgeLabel({ ...base, obstacles: [marker] })
    expect(r.covered).toBe(false)
    expect(Math.abs(r.x - 500)).toBeGreaterThanOrEqual(50)
  })

  it('follows a bent path, not a straight line', () => {
    // Down 200 then right 200: midpoint is the corner region.
    const path = 'M0 0L0 100Q 0,116 16,116L 200,116'
    const r = placeEdgeLabel({
      ...base,
      path,
      mid: { x: 0, y: 100 },
      obstacles: [{ x: -40, y: 80, width: 80, height: 40 }],
    })
    expect(r.covered).toBe(false)
    const onPath = r.x === 0 || r.y === 116 || (r.x > 0 && r.x < 16)
    expect(onPath).toBe(true)
  })
})

describe('nodeObstacleRect', () => {
  it('uses the absolute position for an area member, not the relative one', () => {
    const rect = nodeObstacleRect({
      type: 'table',
      measured: { width: 300, height: 120 },
      internals: { positionAbsolute: { x: 1000, y: 700 } },
      // The relative position lives on `position`, which is ignored.
      ...({ position: { x: 20, y: 40 } } as object),
    })
    expect(rect).toEqual({ x: 1000, y: 700, width: 300, height: 120 })
  })

  it('skips areas, shapes and hidden nodes', () => {
    const internals = { positionAbsolute: { x: 0, y: 0 } }
    expect(nodeObstacleRect({ type: 'area', internals })).toBeNull()
    expect(nodeObstacleRect({ type: 'shape', internals })).toBeNull()
    expect(
      nodeObstacleRect({ type: 'table', hidden: true, internals }),
    ).toBeNull()
  })

  it('includes cross-file reference nodes', () => {
    const rect = nodeObstacleRect({
      type: 'externalTable',
      width: 200,
      height: 80,
      internals: { positionAbsolute: { x: 5, y: 6 } },
    })
    expect(rect).toEqual({ x: 5, y: 6, width: 200, height: 80 })
  })
})

describe('flattenSmoothPath', () => {
  it('flattens quadratic corners into points ending at the corner target', () => {
    const pts = flattenSmoothPath('M0 0L0 10Q 0,20 10,20L 50,20')
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 50, y: 20 })
    expect(pts.length).toBeGreaterThan(4)
  })
})

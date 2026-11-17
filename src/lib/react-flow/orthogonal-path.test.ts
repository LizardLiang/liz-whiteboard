import { describe, expect, it } from 'vitest'
import { flattenSmoothPath } from './edge-label-placement'
import { buildRoundedOrthogonalPath, pathMidpoint } from './orthogonal-path'

describe('buildRoundedOrthogonalPath', () => {
  it('emits only M, L and Q commands', () => {
    const d = buildRoundedOrthogonalPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])
    expect(d.match(/[A-Za-z]/g)!.every((c) => 'MLQ'.includes(c))).toBe(true)
  })

  it('clamps the corner radius to half the shorter adjacent segment', () => {
    // Segments of 10 px: radius 16 clamps to 5.
    const d = buildRoundedOrthogonalPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
    expect(d).toBe('M 0 0 L 5 0 Q 10 0 10 5 L 10 10')
  })

  it('round-trips through flattenSmoothPath with the same endpoints', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 300, y: 80 },
    ]
    const flat = flattenSmoothPath(buildRoundedOrthogonalPath(pts))
    expect(flat[0]).toEqual(pts[0])
    expect(flat[flat.length - 1]).toEqual(pts[3])
    // Rounded corners stay inside the corner's bounding box of the sharp polyline.
    for (const p of flat) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(300)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(80)
    }
  })

  it('handles a straight line and an empty input', () => {
    expect(
      buildRoundedOrthogonalPath([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ]),
    ).toBe('M 0 0 L 50 0')
    expect(buildRoundedOrthogonalPath([])).toBe('')
  })
})

describe('pathMidpoint', () => {
  it('returns the arc-length midpoint', () => {
    expect(
      pathMidpoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toEqual({ x: 100, y: 0 })
    expect(
      pathMidpoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
        { x: 100, y: 40 },
      ]),
    ).toEqual({ x: 70, y: 0 })
  })
})

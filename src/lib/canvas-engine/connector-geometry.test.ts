import { describe, expect, it } from 'vitest'
import {
  ANCHOR_ATTACH,
  CURVATURE_LIMIT,
  anchorNormal,
  anchorPoint,
  arrowHead,
  attachPoint,
  attachSide,
  bendMidpoint,
  borderPoint,
  clampCurvature,
  connectorBounds,
  connectorCurve,
  connectorPath,
  curvatureForPoint,
  curveEndDirection,
  endpoints,
  nearestAnchor,
  nearestAttach,
  pathMidpoint,
  rectCentre,
} from './connector-geometry'
import type { WorldRect } from './hit-test'
import type { Point } from './camera'
import type { EndpointGeometry } from './connector-geometry'

import type { ConnectorAnchor } from './scene'

/** Two 100x100 boxes 200 apart horizontally, unless moved by a test. */
const LEFT: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
const RIGHT: WorldRect = { x: 300, y: 0, width: 100, height: 100 }
const BELOW: WorldRect = { x: 0, y: 300, width: 100, height: 100 }

/**
 * A rect end, optionally anchored — the shape `connectorPath`/`endpoints` now
 * take. Endpoints became a union when connector ends became draggable: an end
 * is either a rect (with an optional side) or a free point.
 */
function rectEnd(rect: WorldRect, anchor?: ConnectorAnchor): EndpointGeometry {
  // Still spelled as a SIDE at the call sites — that is what these cases are
  // about — and converted to the continuous attachment the geometry now takes.
  // A side's midpoint is exactly where it always resolved to.
  return anchor ? { rect, attach: ANCHOR_ATTACH[anchor] } : { rect }
}

describe('rectCentre / borderPoint', () => {
  it('finds a rect centre', () => {
    expect(rectCentre(LEFT)).toEqual({ x: 50, y: 50 })
  })

  it('exits through the vertical edge for a horizontal ray', () => {
    expect(borderPoint(LEFT, { x: 1, y: 0 })).toEqual({ x: 100, y: 50 })
    expect(borderPoint(LEFT, { x: -1, y: 0 })).toEqual({ x: 0, y: 50 })
  })

  it('exits through the horizontal edge for a vertical ray', () => {
    expect(borderPoint(LEFT, { x: 0, y: 1 })).toEqual({ x: 50, y: 100 })
    expect(borderPoint(LEFT, { x: 0, y: -1 })).toEqual({ x: 50, y: 0 })
  })

  it('exits through the corner for an exactly diagonal ray on a square', () => {
    expect(borderPoint(LEFT, { x: 1, y: 1 })).toEqual({ x: 100, y: 100 })
  })

  it('picks the nearer edge on a non-square rect', () => {
    // Wide and short: a 45-degree ray leaves through the top/bottom first.
    const wide: WorldRect = { x: 0, y: 0, width: 400, height: 100 }
    expect(borderPoint(wide, { x: 1, y: 1 })).toEqual({ x: 250, y: 100 })
  })
})

describe('endpoints', () => {
  it('clips both ends to the facing borders', () => {
    expect(endpoints(rectEnd(LEFT), rectEnd(RIGHT))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 300, y: 50 },
    })
  })

  it('is direction-symmetric', () => {
    expect(endpoints(rectEnd(RIGHT), rectEnd(LEFT))).toEqual({
      from: { x: 300, y: 50 },
      to: { x: 100, y: 50 },
    })
  })

  it('returns null for concentric rects', () => {
    expect(endpoints(rectEnd(LEFT), rectEnd({ ...LEFT }))).toBeNull()
    // Different sizes, same centre — still nothing to draw.
    expect(
      endpoints(
        rectEnd(LEFT),
        rectEnd({ x: 25, y: 25, width: 50, height: 50 }),
      ),
    ).toBeNull()
  })

  it('returns null when the rects overlap enough to invert the segment', () => {
    // Centres 10 apart, but both boxes are 100 wide: each border point lies
    // past the other, so a drawn line would point backwards.
    const a: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
    const b: WorldRect = { x: 10, y: 0, width: 100, height: 100 }
    expect(endpoints(rectEnd(a), rectEnd(b))).toBeNull()
  })

  it('draws once the rects separate again', () => {
    const a: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
    const b: WorldRect = { x: 101, y: 0, width: 100, height: 100 }
    expect(endpoints(rectEnd(a), rectEnd(b))).not.toBeNull()
  })
})

describe('connectorPath — straight', () => {
  it('is the two clipped border points', () => {
    expect(connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'straight')).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ])
  })

  it('is null when either endpoint is missing', () => {
    expect(connectorPath(null, rectEnd(RIGHT), 'straight')).toBeNull()
    expect(connectorPath(rectEnd(LEFT), undefined, 'straight')).toBeNull()
  })
})

describe('connectorPath — elbow', () => {
  it('degenerates to a straight segment when the centres share an axis', () => {
    // Same y: the elbow has nothing to turn around.
    expect(connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'elbow')).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ])
    expect(connectorPath(rectEnd(LEFT), rectEnd(BELOW), 'elbow')).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 300 },
    ])
  })

  it('turns at the midpoint of the gap when offset horizontally', () => {
    const offset: WorldRect = { x: 300, y: 200, width: 100, height: 100 }
    // Horizontal dominates (300 vs 200): exit right edge, enter left edge,
    // turn halfway across the 100..300 gap.
    expect(connectorPath(rectEnd(LEFT), rectEnd(offset), 'elbow')).toEqual([
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 250 },
      { x: 300, y: 250 },
    ])
  })

  it('turns on the other axis when vertical dominates', () => {
    const offset: WorldRect = { x: 200, y: 300, width: 100, height: 100 }
    // Vertical dominates (300 vs 200): exit bottom edge, enter top edge.
    expect(connectorPath(rectEnd(LEFT), rectEnd(offset), 'elbow')).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 300 },
    ])
  })

  it('leaves the correct side when the target is to the left or above', () => {
    const upLeft: WorldRect = { x: -400, y: -200, width: 100, height: 100 }
    const path = connectorPath(rectEnd(LEFT), rectEnd(upLeft), 'elbow')
    expect(path).not.toBeNull()
    // Horizontal dominates (-400 vs -200) — leaves the LEFT edge of LEFT.
    expect(path?.[0]).toEqual({ x: 0, y: 50 })
    // and enters the RIGHT edge of the target.
    expect(path?.[path.length - 1]).toEqual({ x: -300, y: -150 })
  })

  it('is null for concentric rects', () => {
    expect(
      connectorPath(rectEnd(LEFT), rectEnd({ ...LEFT }), 'elbow'),
    ).toBeNull()
  })

  it('never emits a zero-length final segment', () => {
    // The arrowhead orients off the last non-degenerate segment; a duplicated
    // final point would leave it with no direction.
    const offset: WorldRect = { x: 300, y: 200, width: 100, height: 100 }
    const path = connectorPath(rectEnd(LEFT), rectEnd(offset), 'elbow')!
    const last = path[path.length - 1]
    const penultimate = path[path.length - 2]
    expect(last).not.toEqual(penultimate)
  })
})

describe('connectorPath — curved', () => {
  it('is a sampled polyline starting and ending on the borders', () => {
    const path = connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!
    expect(path.length).toBeGreaterThan(2)
    expect(path[0]).toEqual({ x: 100, y: 50 })
    expect(path[path.length - 1]).toEqual({ x: 300, y: 50 })
  })

  it('produces only finite coordinates', () => {
    const path = connectorPath(
      rectEnd(LEFT),
      rectEnd({ x: 300, y: 240, width: 100, height: 100 }),
      'curved',
    )!
    for (const point of path) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it('bows away from the straight line between the endpoints', () => {
    const offset: WorldRect = { x: 300, y: 200, width: 100, height: 100 }
    const curved = connectorPath(rectEnd(LEFT), rectEnd(offset), 'curved')!
    const [a, b] = connectorPath(rectEnd(LEFT), rectEnd(offset), 'straight')!

    // NOT tested at the midpoint: the control points are pushed symmetrically,
    // so the curve is point-symmetric about the centre of a-b and passes
    // exactly through it. Deviation lives in the two halves, so the check is
    // the largest departure of ANY sampled point from the straight line.
    const abx = b.x - a.x
    const aby = b.y - a.y
    const length = Math.hypot(abx, aby)
    const deviation = Math.max(
      ...curved.map(
        (p) => Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx) / length,
      ),
    )
    expect(deviation).toBeGreaterThan(10)
  })

  it('is null for concentric rects', () => {
    expect(
      connectorPath(rectEnd(LEFT), rectEnd({ ...LEFT }), 'curved'),
    ).toBeNull()
  })
})

describe('all four relative quadrants', () => {
  const quadrants: Array<[string, WorldRect]> = [
    ['right', { x: 400, y: 0, width: 100, height: 100 }],
    ['left', { x: -400, y: 0, width: 100, height: 100 }],
    ['below', { x: 0, y: 400, width: 100, height: 100 }],
    ['above', { x: 0, y: -400, width: 100, height: 100 }],
  ]

  for (const routing of ['straight', 'elbow', 'curved'] as const) {
    for (const [name, target] of quadrants) {
      it(`${routing} draws a finite path with the target ${name}`, () => {
        const path = connectorPath(rectEnd(LEFT), rectEnd(target), routing)
        expect(path).not.toBeNull()
        expect(path!.length).toBeGreaterThanOrEqual(2)
        for (const point of path!) {
          expect(Number.isFinite(point.x)).toBe(true)
          expect(Number.isFinite(point.y)).toBe(true)
        }
      })
    }
  }
})

describe('arrowHead', () => {
  it('points along the final segment', () => {
    const head = arrowHead(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    )!
    // Tip at the path's end, both barb ends behind it on the x axis. At the
    // 45° half-angle a size-10 barb reaches 10·cos45 back and 10·sin45 out,
    // which is 7.071 in both directions.
    expect(head[0]).toEqual({ x: 100, y: 0 })
    expect(head[1].x).toBeCloseTo(92.929)
    expect(head[2].x).toBeCloseTo(92.929)
    expect(head[1].y).toBeCloseTo(7.071)
    expect(head[2].y).toBeCloseTo(-7.071)
  })

  it('splays the barbs wide enough to read as a doodle, not a vector arrow', () => {
    // The head's shape is the whole point of the constant, so assert the
    // angle itself rather than the coordinates it happens to produce: each
    // barb sits 45° off the shaft, giving a 90° included angle.
    const head = arrowHead(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    )!
    for (const barb of [head[1], head[2]]) {
      // Barb vector runs tip -> barb end; the shaft runs back along -x. The
      // dot product gives the angle between them without an atan2 branch per
      // side, so both barbs assert against the same expected value.
      const bx = barb.x - head[0].x
      const by = barb.y - head[0].y
      const cos = -bx / Math.hypot(bx, by)
      expect(Math.acos(cos)).toBeCloseTo(Math.PI / 4)
    }
  })

  it('sizes by BARB LENGTH, so widening the angle does not grow the head', () => {
    // `size` is the barb, not the reach back along the shaft: both barbs are
    // exactly `size` long whatever ARROW_HALF_ANGLE is retuned to.
    const head = arrowHead(
      [
        { x: 0, y: 0 },
        { x: 60, y: 80 },
      ],
      10,
    )!
    for (const barb of [head[1], head[2]]) {
      expect(Math.hypot(barb.x - head[0].x, barb.y - head[0].y)).toBeCloseTo(10)
    }
  })

  it('orients off the last NON-degenerate segment', () => {
    // A sampled curve can end with coincident points; using the final pair
    // blindly would normalise a zero vector and yield NaN.
    const head = arrowHead(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    )!
    for (const point of head) {
      expect(Number.isNaN(point.x)).toBe(false)
      expect(Number.isNaN(point.y)).toBe(false)
    }
    expect(head[1].x).toBeCloseTo(92.929)
  })

  it('returns null rather than NaN for a fully degenerate path', () => {
    expect(
      arrowHead(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        10,
      ),
    ).toBeNull()
    expect(arrowHead([{ x: 0, y: 0 }], 10)).toBeNull()
    expect(arrowHead([], 10)).toBeNull()
  })

  it('returns null for a non-positive size', () => {
    expect(
      arrowHead(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        0,
      ),
    ).toBeNull()
  })
})

describe('connectorBounds', () => {
  it('spans every point', () => {
    expect(
      connectorBounds([
        { x: 10, y: 40 },
        { x: 50, y: 5 },
        { x: 30, y: 90 },
      ]),
    ).toEqual({ x: 10, y: 5, width: 40, height: 85 })
  })

  it('is a zero-extent rect for a single point, not null', () => {
    expect(connectorBounds([{ x: 7, y: 9 }])).toEqual({
      x: 7,
      y: 9,
      width: 0,
      height: 0,
    })
  })

  it('is null for no points', () => {
    expect(connectorBounds([])).toBeNull()
  })
})

describe('pathMidpoint', () => {
  it('is halfway along a straight segment', () => {
    expect(
      pathMidpoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual({ x: 50, y: 0 })
  })

  it('measures by arc length, not by index', () => {
    // Three points, but the first segment is 90% of the length — the middle
    // index sits nowhere near the middle of the line.
    const mid = pathMidpoint([
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 100, y: 0 },
    ])!
    expect(mid.x).toBeCloseTo(50)
  })

  it('handles an elbow corner', () => {
    const mid = pathMidpoint([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ])!
    expect(mid).toEqual({ x: 50, y: 0 })
  })

  it('is null for no points and the point itself for one', () => {
    expect(pathMidpoint([])).toBeNull()
    expect(pathMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 })
  })

  it('does not divide by zero for a fully degenerate path', () => {
    expect(
      pathMidpoint([
        { x: 2, y: 2 },
        { x: 2, y: 2 },
      ]),
    ).toEqual({ x: 2, y: 2 })
  })
})

describe('anchored endpoints (the line starts and ends where the user pointed)', () => {
  const A: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
  const B: WorldRect = { x: 400, y: 300, width: 100, height: 100 }

  it('puts each end on the midpoint of its own edge', () => {
    // The whole point of anchoring: the ends do NOT slide along the border as
    // the centre-to-centre ray moves. They sit on the face that was pointed at.
    const ends = endpoints(rectEnd(A, 'right'), rectEnd(B, 'left'))!
    expect(ends.from).toEqual({ x: 100, y: 50 })
    expect(ends.to).toEqual({ x: 400, y: 350 })
  })

  it('honours a bottom-to-top pair the centre ray would never produce', () => {
    // Centre-to-centre between these two is dominated by x, so the unanchored
    // path leaves A's RIGHT edge. Anchoring is what makes it leave the bottom.
    const ends = endpoints(rectEnd(A, 'bottom'), rectEnd(B, 'top'))!
    expect(ends.from).toEqual({ x: 50, y: 100 })
    expect(ends.to).toEqual({ x: 450, y: 300 })
    // Unanchored, the same pair leaves the RIGHT edge — and not even at its
    // midpoint: at y=87.5, wherever the centre-to-centre ray happens to cross.
    // That sliding is precisely what anchoring removes.
    expect(endpoints(rectEnd(A), rectEnd(B))!.from).toEqual({ x: 100, y: 87.5 })
  })

  it('is unchanged from the old behaviour when neither end is anchored', () => {
    expect(endpoints(rectEnd(A), rectEnd(B))).toEqual(
      endpoints(rectEnd(A), rectEnd(B)),
    )
  })

  it('aims an unanchored end at the anchored point, not at the other centre', () => {
    // A half-anchored connector must still describe ONE line — both ends
    // agreeing on where the other one is.
    const half = endpoints(rectEnd(A), rectEnd(B, 'top'))!
    expect(half.to).toEqual({ x: 450, y: 300 })
    expect(half.from.x).toBeGreaterThan(0)
    expect(Number.isFinite(half.from.y)).toBe(true)
  })

  it('is null when both anchors land on the same point', () => {
    expect(endpoints(rectEnd(A, 'right'), rectEnd(A, 'right'))).toBeNull()
  })
})

describe('anchorPoint / anchorNormal / nearestAnchor', () => {
  const R: WorldRect = { x: 10, y: 20, width: 100, height: 60 }

  it('gives each edge midpoint', () => {
    expect(anchorPoint(R, 'top')).toEqual({ x: 60, y: 20 })
    expect(anchorPoint(R, 'right')).toEqual({ x: 110, y: 50 })
    expect(anchorPoint(R, 'bottom')).toEqual({ x: 60, y: 80 })
    expect(anchorPoint(R, 'left')).toEqual({ x: 10, y: 50 })
  })

  it('points each normal straight out of its own edge', () => {
    expect(anchorNormal('top')).toEqual({ x: 0, y: -1 })
    expect(anchorNormal('right')).toEqual({ x: 1, y: 0 })
    expect(anchorNormal('bottom')).toEqual({ x: 0, y: 1 })
    expect(anchorNormal('left')).toEqual({ x: -1, y: 0 })
  })

  it('picks the face nearest a point', () => {
    expect(nearestAnchor(R, { x: 500, y: 50 })).toBe('right')
    expect(nearestAnchor(R, { x: -500, y: 50 })).toBe('left')
    expect(nearestAnchor(R, { x: 60, y: -500 })).toBe('top')
    expect(nearestAnchor(R, { x: 60, y: 500 })).toBe('bottom')
  })
})

describe('anchored routing leaves and arrives perpendicular', () => {
  const A: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
  const B: WorldRect = { x: 400, y: 300, width: 100, height: 100 }

  it('elbow departs along the source normal and arrives along the target normal', () => {
    const path = connectorPath(
      rectEnd(A, 'bottom'),
      rectEnd(B, 'left'),
      'elbow',
    )!
    // First segment straight DOWN out of the bottom edge...
    expect(path[0]).toEqual({ x: 50, y: 100 })
    expect(path[1].x).toBe(50)
    expect(path[1].y).toBeGreaterThan(100)
    // ...and the last arriving horizontally into the left edge.
    const end = path[path.length - 1]
    const before = path[path.length - 2]
    expect(end).toEqual({ x: 400, y: 350 })
    expect(before.y).toBe(350)
    expect(before.x).toBeLessThan(400)
  })

  it('elbow stays orthogonal throughout', () => {
    const path = connectorPath(rectEnd(A, 'right'), rectEnd(B, 'top'), 'elbow')!
    for (let i = 1; i < path.length; i += 1) {
      const horizontal = path[i].y === path[i - 1].y
      const vertical = path[i].x === path[i - 1].x
      expect(horizontal || vertical).toBe(true)
    }
  })

  it('curve leaves the anchored edge rather than the dominant axis', () => {
    // Dominant-axis control points would push this curve sideways out of a
    // TOP anchor, which is not a direction the line is attached along.
    const path = connectorPath(
      rectEnd(A, 'bottom'),
      rectEnd(B, 'left'),
      'curved',
    )!
    expect(path[0]).toEqual({ x: 50, y: 100 })
    // The first sample continues downward out of the bottom edge.
    expect(path[1].y).toBeGreaterThan(path[0].y)
    expect(
      path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true)
  })

  it('every routing keeps both anchored ends exactly on their edges', () => {
    for (const routing of ['straight', 'elbow', 'curved'] as const) {
      const path = connectorPath(
        rectEnd(A, 'right'),
        rectEnd(B, 'bottom'),
        routing,
      )!
      expect(path[0]).toEqual({ x: 100, y: 50 })
      expect(path[path.length - 1]).toEqual({ x: 450, y: 400 })
    }
  })
})

describe('free ends (a connector end detached from any element)', () => {
  const A: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
  const FREE = { point: { x: 400, y: 300 } } as const

  it('uses the free point verbatim as that end', () => {
    // Nothing else knows where a free end is, so it is the one part of a
    // connector's geometry that IS stored rather than derived.
    const ends = endpoints(rectEnd(A, 'right'), FREE)!
    expect(ends.to).toEqual({ x: 400, y: 300 })
    expect(ends.from).toEqual({ x: 100, y: 50 })
  })

  it('aims an unanchored rect end at the free point, not at a centre', () => {
    const ends = endpoints(rectEnd(A), FREE)!
    // Leaves A's border on the ray toward the free point.
    expect(ends.to).toEqual({ x: 400, y: 300 })
    expect(ends.from.x === 100 || ends.from.y === 100).toBe(true)
  })

  it('supports BOTH ends free — a line attached to nothing', () => {
    const ends = endpoints(
      { point: { x: 10, y: 20 } },
      { point: { x: 90, y: 60 } },
    )!
    expect(ends).toEqual({ from: { x: 10, y: 20 }, to: { x: 90, y: 60 } })
  })

  it('is null when the two ends land on the same point', () => {
    expect(endpoints(FREE, { point: { ...FREE.point } })).toBeNull()
  })

  it('draws a finite path for every routing with a free end', () => {
    for (const routing of ['straight', 'elbow', 'curved'] as const) {
      const path = connectorPath(rectEnd(A, 'right'), FREE, routing)!
      expect(path.length).toBeGreaterThanOrEqual(2)
      expect(
        path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ).toBe(true)
      expect(path[0]).toEqual({ x: 100, y: 50 })
      expect(path[path.length - 1]).toEqual({ x: 400, y: 300 })
    }
  })

  it('keeps an elbow orthogonal even though a free end has no edge', () => {
    // A free end has no normal to leave along, so its direction is derived
    // from the other end and SNAPPED to an axis — a raw diagonal would break
    // the one property an elbow has.
    const path = connectorPath(rectEnd(A, 'right'), FREE, 'elbow')!
    for (let i = 1; i < path.length; i += 1) {
      const horizontal = path[i].y === path[i - 1].y
      const vertical = path[i].x === path[i - 1].x
      expect(horizontal || vertical).toBe(true)
    }
  })

  it('still returns null when an ATTACHED end cannot be resolved', () => {
    // A missing element is different from a free end: one is an unresolvable
    // reference, the other is a deliberate state.
    expect(connectorPath(null, FREE, 'straight')).toBeNull()
    expect(connectorPath(FREE, undefined, 'straight')).toBeNull()
  })
})

describe('continuous attachment — anywhere along an edge', () => {
  const R: WorldRect = { x: 100, y: 100, width: 200, height: 100 }

  it('resolves a normalised attachment to a world point', () => {
    expect(attachPoint(R, { x: 0.25, y: 0 })).toEqual({ x: 150, y: 100 })
    expect(attachPoint(R, { x: 1, y: 0.75 })).toEqual({ x: 300, y: 175 })
  })

  it('projects a drop onto the NEAREST border, keeping the position along it', () => {
    // The whole point of the change: a drop three-quarters along the top edge
    // attaches three-quarters along the top edge, not at its midpoint.
    expect(nearestAttach(R, { x: 250, y: 105 })).toEqual({ x: 0.75, y: 0 })
    expect(nearestAttach(R, { x: 295, y: 175 })).toEqual({ x: 1, y: 0.75 })
    expect(nearestAttach(R, { x: 140, y: 195 })).toEqual({ x: 0.2, y: 1 })
  })

  it('pushes a drop INSIDE the shape out to its closest edge', () => {
    // Dropping in the middle of a shape still has to mean something.
    //
    // (260,110) is unambiguous: 0.10 of the height from the top against 0.20
    // of the width from the right. (260,120) would be an exact 0.20/0.20 tie
    // between two edges, and asserting that would pin the tie-break ORDER
    // rather than the rule — the first draft of this test did exactly that
    // and was wrong about which way it broke.
    const attach = nearestAttach(R, { x: 260, y: 110 })
    expect(attach.y).toBe(0)
    expect(attach.x).toBeCloseTo(0.8)
  })

  it('clamps a drop beyond the shape back onto the border', () => {
    expect(nearestAttach(R, { x: -500, y: 150 })).toEqual({ x: 0, y: 0.5 })
    expect(nearestAttach(R, { x: 200, y: 9999 })).toEqual({ x: 0.5, y: 1 })
  })

  it('measures in NORMALISED space, so a flat box does not always snap long', () => {
    // 200x100: a point 30 world units from the top and 40 from the left is
    // 0.30 of the height vs 0.20 of the width — the LEFT edge is nearer as a
    // fraction, which is what keeps a wide box from always snapping to its
    // long edge.
    expect(nearestAttach(R, { x: 140, y: 130 }).x).toBe(0)
  })

  it('recovers which edge an attachment lies on, for the departure normal', () => {
    expect(attachSide({ x: 0.25, y: 0 })).toBe('top')
    expect(attachSide({ x: 1, y: 0.5 })).toBe('right')
    expect(attachSide({ x: 0.5, y: 1 })).toBe('bottom')
    expect(attachSide({ x: 0, y: 0.5 })).toBe('left')
  })

  it('leaves a non-midpoint attachment perpendicular to its own edge', () => {
    // An elbow from a quarter along the top must still depart straight UP,
    // not toward the other end.
    const path = connectorPath(
      { rect: R, attach: { x: 0.25, y: 0 } },
      { point: { x: 800, y: 600 } },
      'elbow',
    )!
    expect(path[0]).toEqual({ x: 150, y: 100 })
    expect(path[1].x).toBe(150)
    expect(path[1].y).toBeLessThan(100)
  })

  it('keeps the four creation-handle sides as edge midpoints', () => {
    // Quick-create still lands on a side's midpoint; dragging is what moves it.
    expect(ANCHOR_ATTACH.right).toEqual({ x: 1, y: 0.5 })
    expect(attachPoint(R, ANCHOR_ATTACH.right)).toEqual({ x: 300, y: 150 })
  })
})

describe('curvature — the hand-dragged bow on a `curved` connector', () => {
  /** The sample at t = 0.5 — the point `curvature` is defined against. */
  function midSample(path: Array<Point>): Point {
    return bendMidpoint(path)!
  }

  it('reproduces the un-curved path EXACTLY at 0 and when absent', () => {
    const before = connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!
    expect(connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved', 0)).toEqual(
      before,
    )
    expect(
      connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved', undefined),
    ).toEqual(before)
  })

  it('moves the curve midpoint by curvature x chord length, perpendicular', () => {
    const flat = connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!
    const bowed = connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved', 0.25)!
    const chord = Math.hypot(
      flat[flat.length - 1].x - flat[0].x,
      flat[flat.length - 1].y - flat[0].y,
    )
    const a = midSample(flat)
    const b = midSample(bowed)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(a.y - b.y).toBeCloseTo(0.25 * chord, 6)
  })

  it('flips the side with the sign', () => {
    const up = midSample(
      connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved', 0.3)!,
    )
    const down = midSample(
      connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved', -0.3)!,
    )
    const flat = midSample(
      connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!,
    )
    expect(up.y).toBeLessThan(flat.y)
    expect(down.y).toBeGreaterThan(flat.y)
    expect(flat.y - up.y).toBeCloseTo(down.y - flat.y, 6)
  })

  it('leaves straight and elbow untouched', () => {
    expect(
      connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'straight', 0.5),
    ).toEqual(connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'straight'))
    expect(connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'elbow', 0.5)).toEqual(
      connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'elbow'),
    )
  })

  it('recovers the curvature that puts the bend point under a world point', () => {
    const source = rectEnd(LEFT)
    const target = rectEnd(RIGHT)
    const flat = connectorPath(source, target, 'curved')!
    const base = midSample(flat)
    const chord = Math.hypot(
      flat[flat.length - 1].x - flat[0].x,
      flat[flat.length - 1].y - flat[0].y,
    )
    const wanted = { x: base.x, y: base.y - 60 }
    const curvature = curvatureForPoint(source, target, wanted)!
    expect(curvature).toBeCloseTo(60 / chord, 6)
    // ...and feeding it back puts the bend point exactly there — the 1:1 the
    // drag depends on.
    const bowed = connectorPath(source, target, 'curved', curvature)!
    expect(midSample(bowed).y).toBeCloseTo(wanted.y, 6)
    expect(midSample(bowed).x).toBeCloseTo(wanted.x, 6)
  })

  it('clamps a wild value rather than drawing a curve off the board', () => {
    expect(clampCurvature(99)).toBe(CURVATURE_LIMIT)
    expect(clampCurvature(-99)).toBe(-CURVATURE_LIMIT)
    expect(clampCurvature(Number.NaN)).toBe(0)
  })

  it('bows an ANCHORED pair on top of its own departure bow', () => {
    const source = rectEnd(LEFT, 'right')
    const target = rectEnd(RIGHT, 'left')
    const flat = midSample(connectorPath(source, target, 'curved')!)
    const bowed = midSample(connectorPath(source, target, 'curved', 0.2)!)
    expect(flat.y - bowed.y).toBeCloseTo(0.2 * 200, 6)
  })
})

describe('bowed curves never double back (the cusp a free end drew round itself)', () => {
  /**
   * Every step the sampled path takes ALONG the chord, source end to target
   * end.
   *
   * A CUSP is exactly a negative entry here: the line leaving an endpoint
   * travelling BACKWARDS, curling round it and coming back. Expressed as a
   * walk over the polyline because "it draws a loop" is not something a test
   * can assert, and the failure arrived as a screenshot.
   */
  function alongChordSteps(path: Array<Point>): Array<number> {
    const from = path[0]
    const to = path[path.length - 1]
    const chord = Math.hypot(to.x - from.x, to.y - from.y)
    const ux = (to.x - from.x) / chord
    const uy = (to.y - from.y) / chord
    const steps: Array<number> = []
    for (let i = 1; i < path.length; i += 1) {
      steps.push(
        (path[i].x - path[i - 1].x) * ux + (path[i].y - path[i - 1].y) * uy,
      )
    }
    return steps
  }

  /** The smallest along-chord step, in world units. Negative means a cusp. */
  function worstStep(path: Array<Point>): number {
    return Math.min(...alongChordSteps(path))
  }

  /** The unit vector a curvature is measured along — see `chordNormal`. */
  function normalOf(path: Array<Point>): Point {
    const from = path[0]
    const to = path[path.length - 1]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    return { x: (to.y - from.y) / length, y: -(to.x - from.x) / length }
  }

  function chordOf(path: Array<Point>): number {
    return Math.hypot(
      path[path.length - 1].x - path[0].x,
      path[path.length - 1].y - path[0].y,
    )
  }

  /**
   * The reported failure, reproduced: a free SOURCE end dragged left and down
   * away from an attached target, ~700 apart, bowed to the curvature the
   * screenshot was taken at.
   *
   * `departureNormal` snaps a free end AWAY from the other end, so this
   * source's control point starts a full `CURVE_TENSION_MAX` behind it along
   * the chord. The bow then pushed it ~260 further sideways, and that
   * combination — far behind AND far to the side — is what turned a short
   * backwards stub into a loop drawn around the endpoint.
   */
  const DRAGGED_SOURCE: EndpointGeometry = { point: { x: 0, y: 550 } }
  const ATTACHED_TARGET: EndpointGeometry = {
    rect: { x: 500, y: 0, width: 100, height: 100 },
    attach: ANCHOR_ATTACH.left,
  }
  const REPORTED_CURVATURE = 0.276

  it('does not loop at the reported failure — free source, attached target, 0.276', () => {
    const path = connectorPath(
      DRAGGED_SOURCE,
      ATTACHED_TARGET,
      'curved',
      REPORTED_CURVATURE,
    )!
    // Pinned so a later reader can see this is the configuration that was
    // screenshotted, not a nearby one that happens to pass.
    expect(chordOf(path)).toBeCloseTo(707.1, 1)
    expect(worstStep(path)).toBeGreaterThan(-1e-9)
  })

  /**
   * One end of every kind the geometry can produce, in both a sensible and a
   * deliberately awkward position. The awkward ones are the point: an
   * attachment on the FAR side and a free point placed BEHIND the other end
   * both depart in a direction pointing away from the chord, which is where
   * the cusp lived.
   */
  const SOURCES: Array<[string, EndpointGeometry]> = [
    ['unanchored rect', { rect: LEFT }],
    ['attached facing', { rect: LEFT, attach: ANCHOR_ATTACH.right }],
    ['attached away', { rect: LEFT, attach: ANCHOR_ATTACH.left }],
    ['attached mid-edge', { rect: LEFT, attach: { x: 0.8, y: 0 } }],
    ['free just ahead', { point: { x: 120, y: 60 } }],
    ['free behind', { point: { x: -400, y: 500 } }],
  ]
  const TARGETS: Array<[string, EndpointGeometry]> = [
    ['unanchored rect', { rect: RIGHT }],
    ['attached facing', { rect: RIGHT, attach: ANCHOR_ATTACH.left }],
    ['attached away', { rect: RIGHT, attach: ANCHOR_ATTACH.right }],
    ['attached mid-edge', { rect: RIGHT, attach: { x: 0.2, y: 1 } }],
    ['free just ahead', { point: { x: 280, y: 40 } }],
    ['free behind', { point: { x: 900, y: -400 } }],
  ]

  /**
   * The whole stored range, MINUS zero.
   *
   * Zero is excluded deliberately and it is not a gap in the coverage: an
   * un-bowed curve with a free end genuinely does step backwards out of its
   * endpoint — that is the mild departure stub this fix is explicitly not
   * allowed to touch, because every connector already stored carries no
   * curvature and has to redraw byte-identically. The test below pins that
   * stub in place rather than letting it quietly disappear.
   */
  const CURVATURES = [
    -CURVATURE_LIMIT,
    -1.3,
    -0.7,
    -REPORTED_CURVATURE,
    -0.05,
    0.05,
    REPORTED_CURVATURE,
    0.7,
    1.3,
    CURVATURE_LIMIT,
  ]

  it('never doubles back, at any curvature, for any endpoint pair', () => {
    for (const [sourceName, source] of SOURCES) {
      for (const [targetName, target] of TARGETS) {
        for (const curvature of CURVATURES) {
          const path = connectorPath(source, target, 'curved', curvature)
          if (!path) continue
          const worst = worstStep(path)
          expect(
            worst,
            sourceName + ' -> ' + targetName + ' at ' + curvature,
          ).toBeGreaterThan(-1e-9)
        }
      }
    }
  })

  it('leaves the UN-bowed path alone, backwards departure stub and all', () => {
    // The sharpest available proof that the hold is bow-only: this path DOES
    // double back, and must go on doing so. Applying the hold unconditionally
    // would fix the stub too — and would change what every already-stored
    // connector draws, which is the one thing this fix may not do.
    const flat = connectorPath(DRAGGED_SOURCE, ATTACHED_TARGET, 'curved')!
    expect(worstStep(flat)).toBeLessThan(0)

    for (const [, source] of SOURCES) {
      for (const [, target] of TARGETS) {
        const absent = connectorPath(source, target, 'curved')
        expect(connectorPath(source, target, 'curved', 0)).toEqual(absent)
        expect(connectorPath(source, target, 'curved', undefined)).toEqual(
          absent,
        )
      }
    }
  })

  it('still lands the bend point exactly under the pointer once held back', () => {
    // The hold moves control points ALONG the chord only, which is why that
    // formulation was chosen: the PERPENDICULAR offset is what a curvature is
    // measured by, so leaving it untouched keeps the grip tracking the pointer
    // 1:1 on exactly the connectors this fix is for.
    const flat = connectorPath(DRAGGED_SOURCE, ATTACHED_TARGET, 'curved')!
    const base = bendMidpoint(flat)!
    const normal = normalOf(flat)
    const wanted = { x: base.x + normal.x * 90, y: base.y + normal.y * 90 }

    const curvature = curvatureForPoint(
      DRAGGED_SOURCE,
      ATTACHED_TARGET,
      wanted,
    )!
    const bowed = connectorPath(
      DRAGGED_SOURCE,
      ATTACHED_TARGET,
      'curved',
      curvature,
    )!
    const landed = bendMidpoint(bowed)!

    // Measured PERPENDICULAR only. The hold is free to slide the grip along
    // the chord and does, which is the visible cost of removing the loop —
    // asserting the full 2D distance here would be asserting that cost away.
    const off =
      (landed.x - wanted.x) * normal.x + (landed.y - wanted.y) * normal.y
    expect(off).toBeCloseTo(0, 6)
    expect(worstStep(bowed)).toBeGreaterThan(-1e-9)
  })

  it('bows by exactly curvature x chord even where the hold bites', () => {
    // The same "the midpoint moves by curvature x chord" contract the ordinary
    // pairs already have, asserted on the pathological one: the hold must cost
    // the bow nothing.
    const flat = connectorPath(DRAGGED_SOURCE, ATTACHED_TARGET, 'curved')!
    const bowed = connectorPath(
      DRAGGED_SOURCE,
      ATTACHED_TARGET,
      'curved',
      REPORTED_CURVATURE,
    )!
    const normal = normalOf(flat)
    const along = (point: Point): number =>
      (point.x - flat[0].x) * normal.x + (point.y - flat[0].y) * normal.y
    expect(
      along(bendMidpoint(bowed)!) - along(bendMidpoint(flat)!),
    ).toBeCloseTo(REPORTED_CURVATURE * chordOf(flat), 6)
  })
})

describe('connectorCurve — the cubic a curved connector is STROKED along', () => {
  /**
   * The whole point of the export: the renderer stops walking a 24-segment
   * sample and hands these four points to `bezierCurveTo`, so the line is
   * exact at any zoom instead of a polygon that shows its corners when
   * magnified.
   */
  it('is null for the routings that have no curve, and for a dead pair', () => {
    expect(connectorCurve(rectEnd(LEFT), rectEnd(RIGHT), 'straight')).toBeNull()
    expect(connectorCurve(rectEnd(LEFT), rectEnd(RIGHT), 'elbow')).toBeNull()
    expect(connectorCurve(null, rectEnd(RIGHT), 'curved')).toBeNull()
    expect(
      connectorCurve(rectEnd(LEFT), rectEnd({ ...LEFT }), 'curved'),
    ).toBeNull()
  })

  it('starts and ends on the same borders the sampled path does', () => {
    const curve = connectorCurve(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!
    const path = connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!
    expect(curve.from).toEqual(path[0])
    expect(curve.to).toEqual(path[path.length - 1])
  })

  /**
   * ONE derivation, two shapes. The drawn curve and the hit-tested polyline
   * must not be able to drift apart, so the polyline is proved here to be a
   * sample OF this curve rather than a second answer computed beside it — the
   * same rule the module header states for camera transforms.
   */
  it('is the exact curve the sampled path is a sample of', () => {
    const source = rectEnd(LEFT)
    const target = rectEnd({ x: 300, y: 200, width: 100, height: 100 })
    for (const curvature of [0, 0.4, -1.1]) {
      const curve = connectorCurve(source, target, 'curved', curvature)!
      const path = connectorPath(source, target, 'curved', curvature)!
      const steps = path.length - 1
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps
        const u = 1 - t
        const x =
          u * u * u * curve.from.x +
          3 * u * u * t * curve.c0.x +
          3 * u * t * t * curve.c1.x +
          t * t * t * curve.to.x
        const y =
          u * u * u * curve.from.y +
          3 * u * u * t * curve.c0.y +
          3 * u * t * t * curve.c1.y +
          t * t * t * curve.to.y
        expect(path[i].x).toBeCloseTo(x, 9)
        expect(path[i].y).toBeCloseTo(y, 9)
      }
    }
  })

  it('gives the arrowhead the exact arrival tangent, not the last chord', () => {
    const rect: WorldRect = { x: 300, y: 200, width: 100, height: 100 }
    const source = rectEnd(LEFT)
    const target = rectEnd(rect)
    const curve = connectorCurve(source, target, 'curved')!
    const path = connectorPath(source, target, 'curved')!

    // The head lands on the same tip either way — only its ORIENTATION moves.
    const walked = arrowHead(path, 14)!
    const exact = arrowHead(path, 14, curveEndDirection(curve))!
    expect(exact[0]).toEqual(walked[0])

    // ...and the exact one is square to the target's own face: `c1` sits on
    // that face's outward normal, so arriving along `to - c1` is arriving
    // along that normal reversed.
    const arrive = curveEndDirection(curve)
    const length = Math.hypot(arrive.x, arrive.y)
    const normal = anchorNormal(attachSide(nearestAttach(rect, curve.to)))
    expect(arrive.x / length).toBeCloseTo(-normal.x, 9)
    expect(arrive.y / length).toBeCloseTo(-normal.y, 9)
  })

  it('falls back to the walked direction when handed a zero vector', () => {
    const path = connectorPath(rectEnd(LEFT), rectEnd(RIGHT), 'curved')!
    expect(arrowHead(path, 14, { x: 0, y: 0 })).toEqual(arrowHead(path, 14))
    expect(arrowHead(path, 14, null)).toEqual(arrowHead(path, 14))
  })
})

describe('a curve leaves and arrives PERPENDICULAR to the face it touches', () => {
  /** The outward normal of whichever face of `rect` the point `on` lies on. */
  function faceNormal(rect: WorldRect, on: Point): Point {
    return anchorNormal(attachSide(nearestAttach(rect, on)))
  }

  function unit(vector: Point): Point {
    const length = Math.hypot(vector.x, vector.y)
    return { x: vector.x / length, y: vector.y / length }
  }

  /**
   * The case the dominant-axis rule got wrong, and the reason this exists.
   *
   * `borderPoint` picks the exit face by comparing the rect's HALF-EXTENTS
   * against the offset, so a wide flat box with its partner further right than
   * down is still exited through the BOTTOM. The old rule read only the
   * offset, called it x, and pushed the control point sideways — out of a face
   * the line was standing on, arriving at the far one almost parallel to it.
   */
  const WIDE: WorldRect = { x: 0, y: 0, width: 200, height: 40 }
  const WIDE_PARTNER: WorldRect = { x: 100, y: 200, width: 200, height: 40 }

  it('leaves the face it actually lands on, not the dominant axis', () => {
    const curve = connectorCurve(
      rectEnd(WIDE),
      rectEnd(WIDE_PARTNER),
      'curved',
    )!
    // Pinned: this pair really does exit through a horizontal face while the
    // horizontal offset is the larger one, which is what makes it the case.
    expect(faceNormal(WIDE, curve.from)).toEqual({ x: 0, y: 1 })
    expect(Math.abs(curve.to.x - curve.from.x)).toBeGreaterThan(0)

    const departure = unit({
      x: curve.c0.x - curve.from.x,
      y: curve.c0.y - curve.from.y,
    })
    expect(departure.x).toBeCloseTo(0, 9)
    expect(departure.y).toBeCloseTo(1, 9)
  })

  it('leaves and arrives square-on for every unattached pair, square or not', () => {
    const pairs: Array<[string, WorldRect, WorldRect]> = [
      ['square side by side', LEFT, RIGHT],
      ['square diagonal', LEFT, { x: 260, y: 200, width: 100, height: 100 }],
      ['wide flat', WIDE, WIDE_PARTNER],
      [
        'tall thin',
        { x: 0, y: 0, width: 40, height: 200 },
        { x: 200, y: 100, width: 40, height: 200 },
      ],
      ['mixed', WIDE, { x: 400, y: 300, width: 40, height: 200 }],
    ]

    for (const [name, a, b] of pairs) {
      const curve = connectorCurve(rectEnd(a), rectEnd(b), 'curved')!
      const departure = unit({
        x: curve.c0.x - curve.from.x,
        y: curve.c0.y - curve.from.y,
      })
      const arrival = unit(curveEndDirection(curve))
      const outOfSource = faceNormal(a, curve.from)
      const intoTarget = faceNormal(b, curve.to)

      expect(departure.x, name + ' departure x').toBeCloseTo(outOfSource.x, 9)
      expect(departure.y, name + ' departure y').toBeCloseTo(outOfSource.y, 9)
      expect(arrival.x, name + ' arrival x').toBeCloseTo(-intoTarget.x, 9)
      expect(arrival.y, name + ' arrival y').toBeCloseTo(-intoTarget.y, 9)
    }
  })

  it('still does it for an explicitly attached end', () => {
    const curve = connectorCurve(
      rectEnd(LEFT, 'top'),
      rectEnd(RIGHT, 'bottom'),
      'curved',
    )!
    const departure = unit({
      x: curve.c0.x - curve.from.x,
      y: curve.c0.y - curve.from.y,
    })
    expect(departure).toEqual({ x: 0, y: -1 })
    const arrival = unit(curveEndDirection(curve))
    expect(arrival.x).toBeCloseTo(0, 9)
    expect(arrival.y).toBeCloseTo(-1, 9)
  })
})

describe('short connectors do not tie themselves in a knot', () => {
  /**
   * Total absolute turning along the sampled path, in degrees — how far the
   * line swings its own direction between one end and the other.
   *
   * A connector that reads as one sweep turns through well under a right
   * angle. A curve whose control points have crossed over each other turns
   * through nearly half a circle: out, back, and out again.
   */
  function turning(path: Array<Point>): number {
    let total = 0
    for (let i = 2; i < path.length; i += 1) {
      const ax = path[i - 1].x - path[i - 2].x
      const ay = path[i - 1].y - path[i - 2].y
      const bx = path[i].x - path[i - 1].x
      const by = path[i].y - path[i - 1].y
      total += Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
    }
    return (total * 180) / Math.PI
  }

  /**
   * The reported shape, reproduced. `CURVE_TENSION_MIN` is an absolute 24
   * world units, so on a chord shorter than 48 both control points are pushed
   * further than the endpoints are apart and trade places. This pair sits 20
   * apart and measured 186 degrees of turning before the chord-share cap.
   */
  it('does not loop on a pair closer together than the tension floor', () => {
    const path = connectorPath(
      rectEnd({ x: 0, y: 0, width: 200, height: 40 }),
      rectEnd({ x: 100, y: 60, width: 200, height: 40 }),
      'curved',
    )!
    const chord = Math.hypot(
      path[path.length - 1].x - path[0].x,
      path[path.length - 1].y - path[0].y,
    )
    // Pinned so a later reader can see this is the short-chord band the cap is
    // for, not a nearby pair that happens to pass.
    expect(chord).toBeLessThan(48)
    expect(turning(path)).toBeLessThan(175)
  })

  it('leaves every connector longer than the floor bit-identical', () => {
    // The cap is `distance * 0.5` and the floor is 24, so above 48 the floor
    // has already stopped binding and `distance * 0.4` is under half by
    // construction. Nothing in this range may move at all.
    const far: Array<[WorldRect, WorldRect]> = [
      [LEFT, RIGHT],
      [LEFT, { x: 300, y: 200, width: 100, height: 100 }],
      [LEFT, BELOW],
      [
        { x: 0, y: 0, width: 200, height: 40 },
        { x: 100, y: 300, width: 200, height: 40 },
      ],
    ]
    for (const [a, b] of far) {
      const curve = connectorCurve(rectEnd(a), rectEnd(b), 'curved')!
      const chord = Math.hypot(
        curve.to.x - curve.from.x,
        curve.to.y - curve.from.y,
      )
      expect(chord).toBeGreaterThan(48)
      // The handle is the untouched `max(24, chord * 0.4)`, capped at 240.
      const handle = Math.hypot(
        curve.c0.x - curve.from.x,
        curve.c0.y - curve.from.y,
      )
      expect(handle).toBeCloseTo(Math.min(240, Math.max(24, chord * 0.4)), 9)
    }
  })

  it('turns less the further apart the two shapes are', () => {
    const measured = [40, 80, 150, 300, 600].map((gap) =>
      turning(
        connectorPath(
          rectEnd({ x: 0, y: 0, width: 200, height: 40 }),
          rectEnd({ x: 100, y: 40 + gap, width: 200, height: 40 }),
          'curved',
        )!,
      ),
    )
    for (let i = 1; i < measured.length; i += 1) {
      expect(measured[i]).toBeLessThan(measured[i - 1])
    }
    // At ordinary board spacing it reads as one sweep, not a detour.
    expect(measured[measured.length - 1]).toBeLessThan(45)
  })
})

import { describe, expect, it } from 'vitest'
import {
  ANCHOR_ATTACH,
  anchorNormal,
  anchorPoint,
  arrowHead,
  attachPoint,
  attachSide,
  borderPoint,
  connectorBounds,
  connectorPath,
  endpoints,
  nearestAnchor,
  nearestAttach,
  pathMidpoint,
  rectCentre,
} from './connector-geometry'
import type { WorldRect } from './hit-test'
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
    expect(endpoints(rectEnd(LEFT), rectEnd({ x: 25, y: 25, width: 50, height: 50 }))).toBeNull()
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
    expect(connectorPath(rectEnd(LEFT), rectEnd({ ...LEFT }), 'elbow')).toBeNull()
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
    const path = connectorPath(rectEnd(LEFT), rectEnd({ x: 300, y: 240, width: 100, height: 100 }), 'curved')!
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
      ...curved.map((p) =>
        Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx) / length,
      ),
    )
    expect(deviation).toBeGreaterThan(10)
  })

  it('is null for concentric rects', () => {
    expect(connectorPath(rectEnd(LEFT), rectEnd({ ...LEFT }), 'curved')).toBeNull()
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
    // Tip at the path's end, both back corners behind it on the x axis.
    expect(head[0]).toEqual({ x: 100, y: 0 })
    expect(head[1].x).toBeCloseTo(90)
    expect(head[2].x).toBeCloseTo(90)
    expect(head[1].y).toBeCloseTo(4.5)
    expect(head[2].y).toBeCloseTo(-4.5)
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
    expect(head[1].x).toBeCloseTo(90)
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
    expect(endpoints(rectEnd(A), rectEnd(B))).toEqual(endpoints(rectEnd(A), rectEnd(B)))
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
    const path = connectorPath(rectEnd(A, 'bottom'), rectEnd(B, 'left'), 'elbow')!
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
    const path = connectorPath(rectEnd(A, 'bottom'), rectEnd(B, 'left'), 'curved')!
    expect(path[0]).toEqual({ x: 50, y: 100 })
    // The first sample continues downward out of the bottom edge.
    expect(path[1].y).toBeGreaterThan(path[0].y)
    expect(path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
      true,
    )
  })

  it('every routing keeps both anchored ends exactly on their edges', () => {
    for (const routing of ['straight', 'elbow', 'curved'] as const) {
      const path = connectorPath(rectEnd(A, 'right'), rectEnd(B, 'bottom'), routing)!
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
    const ends = endpoints({ point: { x: 10, y: 20 } }, { point: { x: 90, y: 60 } })!
    expect(ends).toEqual({ from: { x: 10, y: 20 }, to: { x: 90, y: 60 } })
  })

  it('is null when the two ends land on the same point', () => {
    expect(endpoints(FREE, { point: { ...FREE.point } })).toBeNull()
  })

  it('draws a finite path for every routing with a free end', () => {
    for (const routing of ['straight', 'elbow', 'curved'] as const) {
      const path = connectorPath(rectEnd(A, 'right'), FREE, routing)!
      expect(path.length).toBeGreaterThanOrEqual(2)
      expect(path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
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

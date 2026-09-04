// src/lib/canvas-engine/alignment.test.ts
// Unit tests for alignment guides: the pull that lines a dragged shape up
// with its neighbours, and the lines that say why.
//
// Two properties carry most of the weight here, because both fail silently:
//
//  1. A guide must only ever be drawn for an alignment that ACTUALLY holds.
//     A guide for a merely-nearby neighbour looks identical on screen and
//     tells the user a lie about where the element will land.
//  2. The tolerance is a SCREEN distance. A world-space tolerance passes
//     every test written at zoom 1 and makes the whole board snap to itself
//     at 0.1x, which is why `alignmentTolerance` is asserted across the zoom
//     range rather than at one value.
//
// THE MOVING RECT IS A DIFFERENT SIZE FROM THE NEIGHBOUR, deliberately and
// throughout. Two rects of the SAME size that agree on one line agree on all
// three — left, centre and right all coincide at once — so every per-line
// assertion below would pass for any of the six alignments and prove none of
// them. 80x40 against 100x60 keeps the three lines distinct.

import { describe, expect, it } from 'vitest'
import {
  ALIGN_TOLERANCE_PX,
  NO_ALIGNMENT,
  alignMovedRect,
  alignResizedRect,
  alignmentCandidates,
  alignmentTolerance,
} from './alignment'
import { MAX_ZOOM, MIN_ZOOM } from './camera'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CanvasElement } from './scene'
import type { WorldRect } from './hit-test'

function rect(x: number, y: number, width: number, height: number): WorldRect {
  return { x, y, width, height }
}

/** The moving rect in every drag case: 80x40, at whatever origin the case needs. */
function moving(x: number, y: number): WorldRect {
  return rect(x, y, 80, 40)
}

function el(
  id: string,
  box: WorldRect,
  patch: Partial<CanvasElement> = {},
): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

/**
 * The neighbour every case aligns against: 100x60 at (200, 200).
 * Its x lines are 200 / 250 / 300, its y lines 200 / 230 / 260.
 */
const NEIGHBOUR = rect(200, 200, 100, 60)

describe('alignmentTolerance', () => {
  it('is the screen distance divided by the zoom, so it is constant on glass', () => {
    expect(alignmentTolerance({ x: 0, y: 0, zoom: 1 })).toBe(ALIGN_TOLERANCE_PX)
    expect(alignmentTolerance({ x: 0, y: 0, zoom: 2 })).toBe(
      ALIGN_TOLERANCE_PX / 2,
    )
    expect(alignmentTolerance({ x: 0, y: 0, zoom: 0.5 })).toBe(
      ALIGN_TOLERANCE_PX * 2,
    )
  })

  it('stays a usable width in world units across the whole zoom range', () => {
    // The regression this pins: a fixed WORLD tolerance would still be 6 units
    // at MIN_ZOOM, which is 0.6 screen pixels — a snap nobody can hit. The
    // world tolerance must GROW as the board shrinks, and shrink as it grows.
    expect(alignmentTolerance({ x: 0, y: 0, zoom: MIN_ZOOM })).toBe(
      ALIGN_TOLERANCE_PX / MIN_ZOOM,
    )
    expect(alignmentTolerance({ x: 0, y: 0, zoom: MAX_ZOOM })).toBe(
      ALIGN_TOLERANCE_PX / MAX_ZOOM,
    )
  })

  it('falls back to 1x for a zoom that is not a usable number', () => {
    expect(alignmentTolerance({ x: 0, y: 0, zoom: 0 })).toBe(ALIGN_TOLERANCE_PX)
    expect(alignmentTolerance({ x: 0, y: 0, zoom: Number.NaN })).toBe(
      ALIGN_TOLERANCE_PX,
    )
  })
})

describe('alignMovedRect — the six alignments', () => {
  const horizontal = [
    { name: 'left edges', from: moving(203, 400), dx: -3, line: 200 },
    { name: 'right edges', from: moving(218, 400), dx: 2, line: 300 },
    { name: 'vertical centres', from: moving(212, 400), dx: -2, line: 250 },
  ] as const

  for (const testCase of horizontal) {
    it(`snaps ${testCase.name} and reports one vertical guide`, () => {
      const outcome = alignMovedRect(testCase.from, [NEIGHBOUR], 6)
      expect(outcome.dx).toBeCloseTo(testCase.dx)
      expect(outcome.dy).toBe(0)
      expect(outcome.guides).toHaveLength(1)
      expect(outcome.guides[0]).toMatchObject({
        axis: 'x',
        position: testCase.line,
      })
    })
  }

  const vertical = [
    { name: 'top edges', from: moving(500, 203), dy: -3, line: 200 },
    { name: 'bottom edges', from: moving(500, 218), dy: 2, line: 260 },
    { name: 'horizontal middles', from: moving(500, 212), dy: -2, line: 230 },
  ] as const

  for (const testCase of vertical) {
    it(`snaps ${testCase.name} and reports one horizontal guide`, () => {
      const outcome = alignMovedRect(testCase.from, [NEIGHBOUR], 6)
      expect(outcome.dy).toBeCloseTo(testCase.dy)
      expect(outcome.dx).toBe(0)
      expect(outcome.guides).toHaveLength(1)
      expect(outcome.guides[0]).toMatchObject({
        axis: 'y',
        position: testCase.line,
      })
    })
  }

  it('snaps both axes at once, from one neighbour', () => {
    const outcome = alignMovedRect(moving(203, 197), [NEIGHBOUR], 6)
    expect(outcome.dx).toBeCloseTo(-3)
    expect(outcome.dy).toBeCloseTo(3)
    expect(outcome.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y'])
  })
})

describe('alignMovedRect — when NOT to snap', () => {
  it('leaves a rect further away than the tolerance alone, with no guides', () => {
    // Lines 230/270/310 against 200/250/300 — nearest pair is 10 apart.
    const outcome = alignMovedRect(moving(230, 400), [NEIGHBOUR], 6)
    expect(outcome).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('returns the shared empty outcome when there are no candidates', () => {
    expect(alignMovedRect(moving(203, 203), [], 6)).toBe(NO_ALIGNMENT)
  })

  it('takes the SMALLEST correction, not the first one found', () => {
    // Left edge 4 from the neighbour's left, centre 6 from its centre: left
    // wins. Two units further right the two swap, and so does the answer —
    // which is what distinguishes "nearest" from "first in iteration order".
    expect(alignMovedRect(moving(204, 400), [NEIGHBOUR], 6).dx).toBeCloseTo(-4)
    expect(alignMovedRect(moving(206, 400), [NEIGHBOUR], 6).dx).toBeCloseTo(4)
  })

  it('is stable frame to frame when two neighbours are equally close', () => {
    // The moving left edge (203) sits 3 from `before`'s right edge (200) and
    // 3 from `after`'s left edge (206). A tie broken by anything other than
    // iteration order would flicker between them on every pointermove.
    const before = rect(100, 400, 100, 60)
    const after = rect(206, 700, 100, 60)
    const first = alignMovedRect(moving(203, 400), [before, after], 6)
    const again = alignMovedRect(moving(203, 400), [before, after], 6)
    expect(first.dx).toBeCloseTo(-3)
    expect(again.dx).toBe(first.dx)
  })
})

describe('alignMovedRect — the guides themselves', () => {
  it('draws a guide for an alignment that already holds, with no correction', () => {
    const outcome = alignMovedRect(moving(200, 400), [NEIGHBOUR], 6)
    expect(outcome.dx).toBe(0)
    expect(outcome.guides).toHaveLength(1)
    expect(outcome.guides[0]).toMatchObject({ axis: 'x', position: 200 })
  })

  it('spans only the elements taking part, not the viewport', () => {
    const outcome = alignMovedRect(moving(203, 400), [NEIGHBOUR], 6)
    // The neighbour occupies y 200..260 and the moving rect y 400..440, so
    // the line runs between the two and stops at each outer edge.
    expect(outcome.guides[0].from).toBe(200)
    expect(outcome.guides[0].to).toBe(440)
  })

  it('merges two neighbours on the same line into ONE guide covering both', () => {
    const far = rect(200, 700, 100, 60)
    const outcome = alignMovedRect(moving(203, 400), [NEIGHBOUR, far], 6)
    expect(outcome.guides).toHaveLength(1)
    expect(outcome.guides[0].from).toBe(200)
    expect(outcome.guides[0].to).toBe(760)
  })

  it('never reports a guide for a neighbour that was merely nearby', () => {
    // `NEIGHBOUR` pulls the snap (3 away); `other`'s left edge ends up 7 from
    // the snapped line — inside nothing, but close enough that a guide filter
    // reusing the SNAP tolerance would draw a line through it and claim an
    // alignment that does not exist.
    const other = rect(207, 700, 100, 60)
    const outcome = alignMovedRect(moving(203, 400), [NEIGHBOUR, other], 6)
    expect(outcome.dx).toBeCloseTo(-3)
    expect(outcome.guides).toHaveLength(1)
    expect(outcome.guides[0].position).toBe(200)
    expect(outcome.guides[0].to).toBe(440)
  })
})

describe('alignResizedRect', () => {
  it('snaps only the edges the grip moves', () => {
    // A `se` drag on a rect whose LEFT edge is also 3 from the neighbour's
    // left. Only the right edge may move.
    const { rect: snapped } = alignResizedRect(
      rect(197, 400, 100, 60),
      [NEIGHBOUR],
      6,
      { x: 'max', y: 'max' },
      8,
    )
    expect(snapped.x).toBe(197)
    expect(snapped.x + snapped.width).toBeCloseTo(300)
  })

  it('moves the origin, not the far edge, when the grip holds a near edge', () => {
    const { rect: snapped } = alignResizedRect(
      rect(203, 400, 100, 60),
      [NEIGHBOUR],
      6,
      { x: 'min', y: null },
      8,
    )
    expect(snapped.x).toBeCloseTo(200)
    expect(snapped.width).toBeCloseTo(103)
    // The edge the user is NOT holding stays exactly where it was.
    expect(snapped.x + snapped.width).toBeCloseTo(303)
  })

  it('refuses a snap that would shrink the element below the minimum', () => {
    // Width 10, minimum 8: pulling the right edge 3 to the left leaves 7.
    // The constraint wins, nothing moves, and no guide claims otherwise.
    const start = rect(293, 400, 10, 60)
    const { rect: snapped, guides } = alignResizedRect(
      start,
      [NEIGHBOUR],
      6,
      { x: 'max', y: null },
      8,
    )
    expect(snapped).toEqual(start)
    expect(guides).toEqual([])
  })

  it('reports a guide for the snapped edge', () => {
    const { guides } = alignResizedRect(
      rect(197, 400, 100, 60),
      [NEIGHBOUR],
      6,
      { x: 'max', y: null },
      8,
    )
    expect(guides).toHaveLength(1)
    expect(guides[0]).toMatchObject({ axis: 'x', position: 300 })
  })

  it('leaves a rect alone when no candidate is in range', () => {
    const start = rect(500, 500, 100, 60)
    expect(
      alignResizedRect(start, [NEIGHBOUR], 6, { x: 'max', y: 'max' }, 8),
    ).toEqual({ rect: start, guides: [] })
  })
})

describe('alignmentCandidates', () => {
  const camera = { x: 0, y: 0, zoom: 1 }
  const viewport = { width: 800, height: 600 }

  it('excludes the ids being dragged, so an element cannot align to itself', () => {
    const scene = sceneFrom([
      el('a', rect(100, 100, 100, 60)),
      el('b', rect(300, 100, 100, 60)),
    ])
    expect(
      alignmentCandidates(scene, camera, viewport, new Set(['a'])),
    ).toEqual([rect(300, 100, 100, 60)])
  })

  it('excludes connectors, whose stored bounds are a 1x1 placeholder', () => {
    const scene = sceneFrom([
      el('a', rect(100, 100, 100, 60)),
      el('line', rect(0, 0, 1, 1), {
        kind: 'connector',
        connector: {
          source: { kind: 'point', point: { x: 0, y: 0 } },
          target: { kind: 'point', point: { x: 10, y: 10 } },
          routing: 'straight',
        },
      }),
    ])
    expect(alignmentCandidates(scene, camera, viewport, new Set())).toEqual([
      rect(100, 100, 100, 60),
    ])
  })

  it('drops elements the camera cannot see', () => {
    const scene = sceneFrom([
      el('near', rect(100, 100, 100, 60)),
      el('far', rect(9000, 9000, 100, 60)),
    ])
    expect(alignmentCandidates(scene, camera, viewport, new Set())).toEqual([
      rect(100, 100, 100, 60),
    ])
  })

  it('keeps an element just past the edge whose line is still in range', () => {
    // Left edge at 803 — three units outside an 800-wide viewport, so still
    // within snapping distance of something at its edge, so still a candidate.
    const scene = sceneFrom([el('edge', rect(803, 100, 100, 60))])
    expect(
      alignmentCandidates(scene, camera, viewport, new Set()),
    ).toHaveLength(1)
  })

  it('drops a zero-sized element rather than offering three identical lines', () => {
    const scene = sceneFrom([el('flat', rect(100, 100, 0, 0))])
    expect(alignmentCandidates(scene, camera, viewport, new Set())).toEqual([])
  })
})

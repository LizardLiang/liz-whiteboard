import { describe, expect, it } from 'vitest'
import {
  MAX_BOARD_COORD,
  QUICK_CREATE_DIRECTIONS,
  QUICK_CREATE_GAP,
  QUICK_CREATE_MAX_SLIDE_STEPS,
  quickCreatePlacement,
} from './quick-create'
import { GRID_SIZE } from './grid'
import type { WorldRect } from './hit-test'
import { MAX_BOARD_COORD as SCHEMA_MAX_BOARD_COORD } from '@/data/schema'

const SOURCE: WorldRect = { x: 0, y: 0, width: 100, height: 100 }
const SIZE = { width: 100, height: 100 }

/** The candidate rect a placement produces, for overlap assertions. */
function rectAt(position: { x: number; y: number }): WorldRect {
  return { ...position, ...SIZE }
}

describe('the board-coordinate limit does not drift from the schema', () => {
  it('matches src/data/schema.ts', () => {
    // The engine cannot import Zod, so this constant is duplicated there
    // deliberately. This test is the guard that keeps the duplication honest:
    // if either side changes, placements start being rejected by the write
    // path with no other symptom.
    expect(MAX_BOARD_COORD).toBe(SCHEMA_MAX_BOARD_COORD)
  })
})

describe('quickCreatePlacement — a free slot', () => {
  it('places one gap to the right, vertically centred', () => {
    expect(quickCreatePlacement(SOURCE, 'right', SIZE)).toEqual({
      x: 100 + QUICK_CREATE_GAP,
      y: 0,
    })
  })

  it('places one gap to the left, vertically centred', () => {
    expect(quickCreatePlacement(SOURCE, 'left', SIZE)).toEqual({
      x: -QUICK_CREATE_GAP - 100,
      y: 0,
    })
  })

  it('places one gap below, horizontally centred', () => {
    expect(quickCreatePlacement(SOURCE, 'bottom', SIZE)).toEqual({
      x: 0,
      y: 100 + QUICK_CREATE_GAP,
    })
  })

  it('places one gap above, horizontally centred', () => {
    expect(quickCreatePlacement(SOURCE, 'top', SIZE)).toEqual({
      x: 0,
      y: -QUICK_CREATE_GAP - 100,
    })
  })

  it('centres a differently-sized new element on the source, then snaps', () => {
    // A chain of mixed sizes should read as a row, not a staircase — but the
    // centred offset here is half the 60-unit size difference, i.e. 30, which
    // is between two dots. The grid wins: the element moves to 40 rather than
    // sitting half a cell off it. See `grid.ts`.
    const small = { width: 40, height: 40 }
    expect(quickCreatePlacement(SOURCE, 'right', small)).toEqual({
      x: 100 + QUICK_CREATE_GAP,
      y: 40,
    })
    expect(quickCreatePlacement(SOURCE, 'bottom', small)).toEqual({
      x: 40,
      y: 100 + QUICK_CREATE_GAP,
    })
  })

  it('leaves exactly QUICK_CREATE_GAP between the two edges', () => {
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE)
    expect(placed.x - (SOURCE.x + SOURCE.width)).toBe(QUICK_CREATE_GAP)
  })

  it('lands on the dot grid from every direction and every source', () => {
    // The promise a user reads off the board: a shape they created has its
    // borders on the dots. It has to hold for a sibling created from a handle
    // too, including when the SOURCE is off-grid — a board made before the
    // grid existed, or an element dragged by hand.
    const offGrid: WorldRect = { x: 13, y: -7, width: 90, height: 55 }
    for (const source of [SOURCE, offGrid]) {
      for (const direction of QUICK_CREATE_DIRECTIONS) {
        const placed = quickCreatePlacement(source, direction, SIZE)
        // `Math.abs` because `-140 % 20` is negative zero, and `toBe` uses
        // `Object.is` — the remainder is the subject here, not its sign.
        expect(Math.abs(placed.x % GRID_SIZE)).toBe(0)
        expect(Math.abs(placed.y % GRID_SIZE)).toBe(0)
      }
    }
  })
})

describe('quickCreatePlacement — collisions', () => {
  it('slides past a single occupant', () => {
    const free = quickCreatePlacement(SOURCE, 'right', SIZE)
    const occupant = rectAt(free)
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, [occupant])

    // Asserted as a property, not a step count. The step is QUICK_CREATE_GAP
    // (48) and the element is 100 wide, so clearing a same-sized occupant
    // takes THREE steps — pinning the number here would encode that
    // relationship into the test and break on any size or gap change, without
    // testing anything the feature actually promises.
    expect(placed.y).toBe(free.y)
    expect(placed.x).toBeGreaterThan(free.x)
    expect(placed.x).toBeGreaterThanOrEqual(occupant.x + occupant.width)
    expect((placed.x - free.x) % QUICK_CREATE_GAP).toBe(0)
  })

  it('slides past a chain of occupants', () => {
    const free = quickCreatePlacement(SOURCE, 'right', SIZE)
    const occupied = [
      rectAt(free),
      rectAt({ x: free.x + QUICK_CREATE_GAP, y: free.y }),
      rectAt({ x: free.x + QUICK_CREATE_GAP * 2, y: free.y }),
    ]
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, occupied)
    for (const other of occupied) {
      expect(
        rectAt(placed).x < other.x + other.width &&
          rectAt(placed).x + SIZE.width > other.x,
      ).toBe(false)
    }
  })

  it('slides in the chosen direction, not the nearest free one', () => {
    const free = quickCreatePlacement(SOURCE, 'top', SIZE)
    const occupant = rectAt(free)
    const placed = quickCreatePlacement(SOURCE, 'top', SIZE, [occupant])
    // Still directly above the source, and further up — never sideways into
    // an easier gap. The direction the user clicked is the answer.
    expect(placed.x).toBe(free.x)
    expect(placed.y).toBeLessThan(free.y)
    expect(placed.y + SIZE.height).toBeLessThanOrEqual(occupant.y)
  })

  it('ignores occupants that are out of the way', () => {
    const elsewhere: WorldRect = { x: 0, y: -900, width: 100, height: 100 }
    expect(quickCreatePlacement(SOURCE, 'right', SIZE, [elsewhere])).toEqual(
      quickCreatePlacement(SOURCE, 'right', SIZE),
    )
  })

  it('treats touching edges as free, matching rectsIntersect', () => {
    // An occupant exactly one element-width beyond the free slot touches it
    // but does not overlap; the new element should not slide.
    const free = quickCreatePlacement(SOURCE, 'right', SIZE)
    const touching = rectAt({ x: free.x + SIZE.width, y: free.y })
    expect(quickCreatePlacement(SOURCE, 'right', SIZE, [touching])).toEqual(
      free,
    )
  })

  it('gives up after the step budget instead of looping forever', () => {
    // A wall of occupants far longer than the budget: the call must return.
    const free = quickCreatePlacement(SOURCE, 'right', SIZE)
    const wall = Array.from({ length: 200 }, (_, i) =>
      rectAt({ x: free.x + QUICK_CREATE_GAP * i, y: free.y }),
    )
    const placed = quickCreatePlacement(SOURCE, 'right', SIZE, wall)
    expect(placed.x).toBe(
      free.x + QUICK_CREATE_GAP * QUICK_CREATE_MAX_SLIDE_STEPS,
    )
  })
})

describe('quickCreatePlacement — the coordinate clamp', () => {
  it('holds the result inside the board range', () => {
    const farRight: WorldRect = {
      x: MAX_BOARD_COORD - 10,
      y: 0,
      width: 100,
      height: 100,
    }
    const placed = quickCreatePlacement(farRight, 'right', SIZE)
    expect(placed.x).toBe(MAX_BOARD_COORD)
  })

  it('holds the result inside the range in the negative direction', () => {
    const farLeft: WorldRect = {
      x: -MAX_BOARD_COORD + 10,
      y: 0,
      width: 100,
      height: 100,
    }
    const placed = quickCreatePlacement(farLeft, 'left', SIZE)
    expect(placed.x).toBe(-MAX_BOARD_COORD)
  })

  it('clamps after searching, not during', () => {
    // Clamping inside the loop would pin every step to the same position and
    // burn the whole budget against a candidate that can no longer move.
    // Nothing observable should differ from the unobstructed clamp.
    const farRight: WorldRect = {
      x: MAX_BOARD_COORD - 10,
      y: 0,
      width: 100,
      height: 100,
    }
    const blocker = rectAt(quickCreatePlacement(farRight, 'right', SIZE))
    expect(quickCreatePlacement(farRight, 'right', SIZE, [blocker]).x).toBe(
      MAX_BOARD_COORD,
    )
  })

  it('always produces finite coordinates in every direction', () => {
    for (const direction of QUICK_CREATE_DIRECTIONS) {
      const placed = quickCreatePlacement(SOURCE, direction, SIZE)
      expect(Number.isFinite(placed.x)).toBe(true)
      expect(Number.isFinite(placed.y)).toBe(true)
    }
  })
})

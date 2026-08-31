// src/lib/react-flow/area-bounds.test.ts
// Unit tests for area MEMBERSHIP geometry: which tables a drawn rectangle
// encloses, and which area a dropped table joins or leaves.
//
// The auto-fit tests that used to dominate this file are gone with auto-fit
// itself — an area's rectangle is now only ever set by the user.

import { describe, expect, it } from 'vitest'
import {
  areaRectContainsPoint,
  reconcileAreaMembership,
  smallestAreaContainingPoint,
  tableIdsEnclosedByRect,
} from './area-bounds'
import type { AreaRect, ReconcileArea } from './area-bounds'

// -----------------------------------------------------------------------------
// Centre-point hit-testing — the single rule both membership paths use:
// dropping a table into an area, and drawing an area around tables.
// -----------------------------------------------------------------------------

function makeRect(
  positionX: number,
  positionY: number,
  width: number,
  height: number,
): AreaRect {
  return { positionX, positionY, width, height }
}

describe('areaRectContainsPoint', () => {
  const rect = makeRect(100, 100, 200, 100) // spans x:[100,300], y:[100,200]

  it('returns true for a point inside the rectangle', () => {
    expect(areaRectContainsPoint(rect, { x: 200, y: 150 })).toBe(true)
  })

  it('is inclusive of the left edge', () => {
    expect(areaRectContainsPoint(rect, { x: 100, y: 150 })).toBe(true)
  })

  it('is inclusive of the right edge', () => {
    expect(areaRectContainsPoint(rect, { x: 300, y: 150 })).toBe(true)
  })

  it('is inclusive of the top edge', () => {
    expect(areaRectContainsPoint(rect, { x: 200, y: 100 })).toBe(true)
  })

  it('is inclusive of the bottom edge', () => {
    expect(areaRectContainsPoint(rect, { x: 200, y: 200 })).toBe(true)
  })

  it('returns false for a point just outside the left edge', () => {
    expect(areaRectContainsPoint(rect, { x: 99, y: 150 })).toBe(false)
  })

  it('returns false for a point just outside the right edge', () => {
    expect(areaRectContainsPoint(rect, { x: 301, y: 150 })).toBe(false)
  })

  it('returns false for a point just outside the top edge', () => {
    expect(areaRectContainsPoint(rect, { x: 200, y: 99 })).toBe(false)
  })

  it('returns false for a point just outside the bottom edge', () => {
    expect(areaRectContainsPoint(rect, { x: 200, y: 201 })).toBe(false)
  })
})

describe('smallestAreaContainingPoint', () => {
  it('returns null when no area contains the point', () => {
    const areas = [
      { id: 'a', memberTableIds: [], ...makeRect(0, 0, 100, 100) },
      { id: 'b', memberTableIds: [], ...makeRect(500, 500, 100, 100) },
    ]
    expect(smallestAreaContainingPoint(areas, { x: 250, y: 250 })).toBeNull()
  })

  it('returns the single area that contains the point', () => {
    const areas = [
      { id: 'a', memberTableIds: [], ...makeRect(0, 0, 100, 100) },
      { id: 'b', memberTableIds: [], ...makeRect(500, 500, 100, 100) },
    ]
    const result = smallestAreaContainingPoint(areas, { x: 50, y: 50 })
    expect(result?.id).toBe('a')
  })

  it('picks the smallest of two nested/overlapping areas containing the point', () => {
    const big = { id: 'big', memberTableIds: [], ...makeRect(0, 0, 1000, 1000) }
    const small = {
      id: 'small',
      memberTableIds: [],
      ...makeRect(100, 100, 50, 50),
    }
    const areas = [big, small]
    const result = smallestAreaContainingPoint(areas, { x: 110, y: 110 })
    expect(result?.id).toBe('small')
  })

  it('preserves extra fields (id/memberTableIds) on the returned area', () => {
    const areas = [
      {
        id: 'area-1',
        memberTableIds: ['t1', 't2'],
        ...makeRect(0, 0, 100, 100),
      },
    ]
    const result = smallestAreaContainingPoint(areas, { x: 10, y: 10 })
    expect(result).not.toBeNull()
    expect(result?.id).toBe('area-1')
    expect(result?.memberTableIds).toEqual(['t1', 't2'])
  })

  it('breaks a size tie by array order (first wins)', () => {
    const first = {
      id: 'first',
      memberTableIds: [],
      ...makeRect(0, 0, 100, 100),
    }
    const second = {
      id: 'second',
      memberTableIds: [],
      ...makeRect(0, 0, 100, 100),
    }
    const areas = [first, second]
    const result = smallestAreaContainingPoint(areas, { x: 10, y: 10 })
    expect(result?.id).toBe('first')
  })
})

// -----------------------------------------------------------------------------
// reconcileAreaMembership (GH #106 item 3 — Hermes coverage-gap fix). Extracted
// from ReactFlowWhiteboard's handleNodeDragStop inline join/leave block;
// these tests pin the exact semantics of that extraction.
// -----------------------------------------------------------------------------

function makeArea(
  id: string,
  memberTableIds: Array<string>,
  rect: AreaRect,
): ReconcileArea {
  return { id, memberTableIds, ...rect }
}

describe('reconcileAreaMembership', () => {
  it('joins a single area the table is dropped inside and is not a member of', () => {
    const area = makeArea('a', [], makeRect(0, 0, 200, 200))
    const result = reconcileAreaMembership([area], 'table-1', {
      x: 100,
      y: 100,
    })
    expect(result).toEqual({ join: 'a', leave: [] })
  })

  it('does not re-join an area the table is already a member of, and does not eject it', () => {
    const area = makeArea('a', ['table-1'], makeRect(0, 0, 200, 200))
    const result = reconcileAreaMembership([area], 'table-1', {
      x: 100,
      y: 100,
    })
    expect(result).toEqual({ join: null, leave: [] })
  })

  it('leaves an area when the member is dragged outside its bounds; areas with no members are untouched', () => {
    const memberArea = makeArea('a', ['table-1'], makeRect(0, 0, 200, 200))
    const emptyArea = makeArea('b', [], makeRect(1000, 1000, 100, 100))
    const result = reconcileAreaMembership(
      [memberArea, emptyArea],
      'table-1',
      { x: 500, y: 500 }, // outside both areas
    )
    expect(result).toEqual({ join: null, leave: ['a'] })
  })

  it('joins only the smallest of two overlapping areas when not a member of either', () => {
    const big = makeArea('big', [], makeRect(0, 0, 1000, 1000))
    const small = makeArea('small', [], makeRect(100, 100, 50, 50))
    const result = reconcileAreaMembership([big, small], 'table-1', {
      x: 110,
      y: 110,
    })
    expect(result).toEqual({ join: 'small', leave: [] })
  })

  it('joins the smaller overlapping area and leaves the bigger one it is already inside alone', () => {
    const big = makeArea('big', ['table-1'], makeRect(0, 0, 1000, 1000))
    const small = makeArea('small', [], makeRect(100, 100, 50, 50))
    const result = reconcileAreaMembership([big, small], 'table-1', {
      x: 110,
      y: 110, // inside both
    })
    expect(result).toEqual({ join: 'small', leave: [] })
  })

  it('leaves area A alone (still inside) while joining a smaller area B it is not a member of', () => {
    const areaA = makeArea('A', ['table-1'], makeRect(0, 0, 1000, 1000))
    const areaB = makeArea('B', [], makeRect(100, 100, 50, 50))
    const result = reconcileAreaMembership([areaA, areaB], 'table-1', {
      x: 110,
      y: 110, // inside both A and B
    })
    expect(result).toEqual({ join: 'B', leave: [] })
  })

  it('returns all-empty sets when no area contains the point and the table is not a member of anything', () => {
    const area = makeArea('a', [], makeRect(0, 0, 100, 100))
    const result = reconcileAreaMembership([area], 'table-1', {
      x: 9999,
      y: 9999,
    })
    expect(result).toEqual({ join: null, leave: [] })
  })
})

describe('tableIdsEnclosedByRect (todo #55 — draw an area around tables)', () => {
  const rect: AreaRect = {
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
  }

  it('returns the tables whose centre is inside the drawn rect', () => {
    expect(
      tableIdsEnclosedByRect(
        [
          { id: 't1', center: { x: 10, y: 10 } },
          { id: 't2', center: { x: 500, y: 500 } },
          { id: 't3', center: { x: 99, y: 1 } },
        ],
        rect,
      ),
    ).toEqual(['t1', 't3'])
  })

  it('includes a table whose centre sits exactly on the border', () => {
    expect(
      tableIdsEnclosedByRect([{ id: 't1', center: { x: 100, y: 100 } }], rect),
    ).toEqual(['t1'])
  })

  it('returns an empty list when nothing was drawn around', () => {
    expect(
      tableIdsEnclosedByRect([{ id: 't1', center: { x: -1, y: 50 } }], rect),
    ).toEqual([])
    expect(tableIdsEnclosedByRect([], rect)).toEqual([])
  })

  it('preserves input order so membership is deterministic', () => {
    expect(
      tableIdsEnclosedByRect(
        [
          { id: 'b', center: { x: 5, y: 5 } },
          { id: 'a', center: { x: 6, y: 6 } },
        ],
        rect,
      ),
    ).toEqual(['b', 'a'])
  })

  it('agrees with reconcileAreaMembership: a drawn-in table stays in on a nudge', () => {
    // Same centre-point rule on both paths — the table joins by being drawn
    // around, then a 1px move must NOT eject it.
    const center = { x: 50, y: 50 }
    const members = tableIdsEnclosedByRect([{ id: 't1', center }], rect)
    expect(members).toEqual(['t1'])
    const area: ReconcileArea = { ...rect, id: 'a', memberTableIds: members }
    expect(
      reconcileAreaMembership([area], 't1', { x: center.x + 1, y: center.y }),
    ).toEqual({ join: null, leave: [] })
  })
})

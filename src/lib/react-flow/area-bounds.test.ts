// src/lib/react-flow/area-bounds.test.ts
// Unit tests for computeAreaBounds (GH #106 grouping bugfix — area auto-fit;
// area-fit-member-content — full-content, mode-independent height).

import { describe, expect, it } from 'vitest'
import {
  areaRectContainsPoint,
  computeAreaBounds,
  reconcileAreaMembership,
  smallestAreaContainingPoint,
} from './area-bounds'
import type { AreaRect, ReconcileArea } from './area-bounds'
import { calculateTableHeight } from './layout-adapter'
import { MIN_AREA_WIDTH } from './types'

// Mirrors computeAreaBounds' ADD_COLUMN_ROW_HEIGHT — the "+" add-column
// affordance row that calculateTableHeight excludes but an area must enclose.
const ADD_COL_ROW = 28

// Height is ALWAYS calculateTableHeight(columnCount) (area-fit-member-content)
// — never measured/display-mode-dependent height — so every fixture below
// carries columnCount, and expected heights are derived from it via the same
// canonical function computeAreaBounds uses internally.
function makeMember(
  x: number,
  y: number,
  width: number,
  columnCount: number,
): {
  position: { x: number; y: number }
  measured: { width: number }
  columnCount: number
} {
  return { position: { x, y }, measured: { width }, columnCount }
}

describe('computeAreaBounds', () => {
  it('returns null for an empty member list', () => {
    expect(computeAreaBounds([])).toBeNull()
  })

  it('wraps a single member with default padding + top inset', () => {
    const bounds = computeAreaBounds([makeMember(100, 200, 250, 5)])
    const height = calculateTableHeight(5) + ADD_COL_ROW
    expect(bounds).toEqual({
      positionX: 100 - 24,
      positionY: 200 - 24 - 32,
      width: 250 + 24 * 2,
      height: height + 24 * 2 + 32,
    })
  })

  it('computes the union bounding box across multiple members', () => {
    const bounds = computeAreaBounds([
      makeMember(0, 0, 100, 3),
      makeMember(300, 200, 100, 3),
    ])
    const height = calculateTableHeight(3) + ADD_COL_ROW
    // minX=0, minY=0, maxX=400, maxY=200+height
    expect(bounds).toEqual({
      positionX: 0 - 24,
      positionY: 0 - 24 - 32,
      width: 400 + 24 * 2,
      height: 200 + height + 24 * 2 + 32,
    })
  })

  it('respects custom padding and topInset options', () => {
    // Member is deliberately wide + column-heavy (400 width, 15 columns) so
    // the raw computed size clears the MIN_AREA_WIDTH/HEIGHT floor and the
    // padding/topInset math is what's actually under test (a small member's
    // raw size would be clamped to the floor, masking the padding option's
    // effect).
    const bounds = computeAreaBounds([makeMember(0, 0, 400, 15)], {
      padding: 10,
      topInset: 20,
    })
    const height = calculateTableHeight(15) + ADD_COL_ROW
    expect(bounds).toEqual({
      positionX: -10,
      positionY: -30,
      width: 400 + 20,
      height: height + 20 + 20,
    })
  })

  it('enforces MIN_AREA_WIDTH for a narrow member', () => {
    const bounds = computeAreaBounds([makeMember(0, 0, 10, 0)])
    expect(bounds!.width).toBe(MIN_AREA_WIDTH)
    // Height is no longer independently tiny-able — even a 0-column table's
    // full-content height (header + row padding) plus the area's own
    // padding/top-inset already clears the default MIN_AREA_HEIGHT floor, so
    // the default-floor case for height isn't reachable via columnCount
    // alone. The floor is still exercised via a custom minHeight below.
    expect(bounds!.height).toBe(calculateTableHeight(0) + ADD_COL_ROW + 24 * 2 + 32)
  })

  it('enforces a custom minHeight floor that exceeds the computed height', () => {
    const bounds = computeAreaBounds([makeMember(0, 0, 250, 0)], {
      minHeight: 500,
    })
    expect(bounds!.height).toBe(500)
  })

  it('allows overriding the min-size floor via options', () => {
    const bounds = computeAreaBounds([makeMember(0, 0, 10, 0)], {
      minWidth: 500,
      minHeight: 400,
    })
    expect(bounds!.width).toBe(500)
    expect(bounds!.height).toBe(400)
  })

  it('falls back to LAYOUT_CONSTRAINTS default width when unmeasured', () => {
    // No `measured` and no `width` — node hasn't been rendered yet. Height
    // still comes from columnCount, never from a "default height" constant.
    const bounds = computeAreaBounds([{ position: { x: 0, y: 0 }, columnCount: 4 }])
    const height = calculateTableHeight(4) + ADD_COL_ROW
    // DEFAULT_NODE_WIDTH=250 (see lib/react-flow/types.ts)
    expect(bounds).toEqual({
      positionX: -24,
      positionY: -24 - 32,
      width: 250 + 24 * 2,
      height: height + 24 * 2 + 32,
    })
  })

  // ---------------------------------------------------------------------------
  // area-fit-member-content — fields added to a member table grows the area.
  // Verifies the core reported bug's fix: computed height is a function of
  // columnCount (full content), not of the member's measured/display-mode
  // height, so a member with more columns always yields a taller area.
  // ---------------------------------------------------------------------------
  describe('area-fit-member-content — full-content, mode-independent height', () => {
    it('a member with more columns yields a taller computed area', () => {
      const fewColumns = computeAreaBounds([makeMember(0, 0, 250, 2)])
      const manyColumns = computeAreaBounds([makeMember(0, 0, 250, 12)])
      expect(manyColumns!.height).toBeGreaterThan(fewColumns!.height)
      expect(manyColumns!.height).toBe(
        calculateTableHeight(12) + ADD_COL_ROW + 24 * 2 + 32,
      )
    })

    it('height is derived from calculateTableHeight(columnCount), not from measured.height', () => {
      // A node whose `measured.height` reflects a compact display mode (small)
      // while its actual column count (all fields) is large — mirrors a real
      // TableNodeType where `measured` is whatever the viewing client's
      // showMode (Compact/Keys/All) rendered. The computed area bounds must
      // use the full-content height, ignoring the tiny measured value —
      // this is what makes an area's fit mode-independent across peers.
      const nodeWithMisleadingMeasuredHeight = {
        position: { x: 0, y: 0 },
        measured: { width: 250, height: 40 }, // Compact-mode height, e.g.
        columnCount: 20, // all-fields count — much taller in reality
      }
      const bounds = computeAreaBounds([nodeWithMisleadingMeasuredHeight])
      const expectedHeight = calculateTableHeight(20) + ADD_COL_ROW
      expect(bounds!.height).toBe(expectedHeight + 24 * 2 + 32)
      expect(bounds!.height).not.toBe(40 + 24 * 2 + 32)
    })

    it('shrinks the computed area height when columns are removed', () => {
      const manyColumns = computeAreaBounds([makeMember(0, 0, 250, 10)])
      const zeroColumns = computeAreaBounds([makeMember(0, 0, 250, 0)])
      expect(zeroColumns!.height).toBeLessThan(manyColumns!.height)
      // A 0-column table's header-only height is still the true floor for
      // this shape (no MIN_AREA_HEIGHT clamp needed at this size, see the
      // "enforces MIN_AREA_WIDTH for a narrow member" test above).
      expect(zeroColumns!.height).toBe(calculateTableHeight(0) + ADD_COL_ROW + 24 * 2 + 32)
    })
  })

  // ---------------------------------------------------------------------------
  // area-autolayout-persistence-fix — refitArea position-override merge.
  // refitArea (ReactFlowWhiteboard.tsx) merges a fresh Auto Layout position
  // over a member node read from `reactFlowInstance.getNodes()` — which is
  // one tick stale immediately after a layout run — via:
  //   { ...node, position: { x: override.x, y: override.y } }
  // (size/columnCount is left untouched). These tests exercise that exact
  // merge shape to prove bounds are computed from the FRESH override
  // position, not the stale node position that would otherwise wrap the
  // member's OLD spot.
  // ---------------------------------------------------------------------------
  describe('with a refitArea-style position override merge', () => {
    function makeStaleMemberWithOverride(
      stale: { x: number; y: number },
      override: { x: number; y: number },
      size: { width: number; columnCount: number },
    ) {
      const staleNode = {
        position: { x: stale.x, y: stale.y },
        measured: { width: size.width },
        columnCount: size.columnCount,
      }
      // Mirrors refitArea's merge: position from the override, size from the
      // (still valid) measured/columnCount node.
      return { ...staleNode, position: { x: override.x, y: override.y } }
    }

    it('computes bounds from the override position, not the stale node position', () => {
      // Auto Layout just moved this member from (0,0) to (600,0) — getNodes()
      // is still returning the pre-layout (0,0) for one tick.
      const member = makeStaleMemberWithOverride(
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { width: 250, columnCount: 5 },
      )
      const bounds = computeAreaBounds([member])
      const height = calculateTableHeight(5) + ADD_COL_ROW
      // If this used the stale (0,0) position instead, positionX would be
      // -24 (0 - padding) — the area-detach bug this fix resolves.
      expect(bounds).toEqual({
        positionX: 600 - 24,
        positionY: 0 - 24 - 32,
        width: 250 + 24 * 2,
        height: height + 24 * 2 + 32,
      })
      expect(bounds!.positionX).not.toBe(0 - 24)
    })

    it("unions multiple members using each member's override position", () => {
      const memberA = makeStaleMemberWithOverride(
        { x: 999, y: 999 }, // stale — must be ignored
        { x: 0, y: 0 },
        { width: 100, columnCount: 2 },
      )
      const memberB = makeStaleMemberWithOverride(
        { x: -999, y: -999 }, // stale — must be ignored
        { x: 300, y: 200 },
        { width: 100, columnCount: 2 },
      )
      const bounds = computeAreaBounds([memberA, memberB])
      const height = calculateTableHeight(2) + ADD_COL_ROW
      // Same union math as the "computes the union bounding box" case above,
      // now driven entirely by override positions.
      expect(bounds).toEqual({
        positionX: 0 - 24,
        positionY: 0 - 24 - 32,
        width: 400 + 24 * 2,
        height: 200 + height + 24 * 2 + 32,
      })
    })
  })
})

// -----------------------------------------------------------------------------
// area-drag-in-membership (GH #106 item 3) — center-point hit-testing helpers
// used by ReactFlowWhiteboard's handleNodeDragStop to reconcile area
// membership when a table is dropped.
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
    const small = { id: 'small', memberTableIds: [], ...makeRect(100, 100, 50, 50) }
    const areas = [big, small]
    const result = smallestAreaContainingPoint(areas, { x: 110, y: 110 })
    expect(result?.id).toBe('small')
  })

  it('preserves extra fields (id/memberTableIds) on the returned area', () => {
    const areas = [
      { id: 'area-1', memberTableIds: ['t1', 't2'], ...makeRect(0, 0, 100, 100) },
    ]
    const result = smallestAreaContainingPoint(areas, { x: 10, y: 10 })
    expect(result).not.toBeNull()
    expect(result?.id).toBe('area-1')
    expect(result?.memberTableIds).toEqual(['t1', 't2'])
  })

  it('breaks a size tie by array order (first wins)', () => {
    const first = { id: 'first', memberTableIds: [], ...makeRect(0, 0, 100, 100) }
    const second = { id: 'second', memberTableIds: [], ...makeRect(0, 0, 100, 100) }
    const areas = [first, second]
    const result = smallestAreaContainingPoint(areas, { x: 10, y: 10 })
    expect(result?.id).toBe('first')
  })
})

// -----------------------------------------------------------------------------
// reconcileAreaMembership (GH #106 item 3 — Hermes coverage-gap fix). Extracted
// from ReactFlowWhiteboard's handleNodeDragStop inline join/leave/refit block;
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
    const result = reconcileAreaMembership([area], 'table-1', { x: 100, y: 100 })
    expect(result).toEqual({ join: 'a', leave: [], refit: [] })
  })

  it('does not re-join an area the table is already a member of — refits instead', () => {
    const area = makeArea('a', ['table-1'], makeRect(0, 0, 200, 200))
    const result = reconcileAreaMembership([area], 'table-1', { x: 100, y: 100 })
    expect(result).toEqual({ join: null, leave: [], refit: ['a'] })
  })

  it('leaves an area when the member is dragged outside its bounds; areas with no members are untouched', () => {
    const memberArea = makeArea('a', ['table-1'], makeRect(0, 0, 200, 200))
    const emptyArea = makeArea('b', [], makeRect(1000, 1000, 100, 100))
    const result = reconcileAreaMembership(
      [memberArea, emptyArea],
      'table-1',
      { x: 500, y: 500 }, // outside both areas
    )
    expect(result).toEqual({ join: null, leave: ['a'], refit: [] })
  })

  it('joins only the smallest of two overlapping areas when not a member of either', () => {
    const big = makeArea('big', [], makeRect(0, 0, 1000, 1000))
    const small = makeArea('small', [], makeRect(100, 100, 50, 50))
    const result = reconcileAreaMembership([big, small], 'table-1', {
      x: 110,
      y: 110,
    })
    expect(result).toEqual({ join: 'small', leave: [], refit: [] })
  })

  it('joins the smaller overlapping area and refits the bigger one it is already a member of', () => {
    const big = makeArea('big', ['table-1'], makeRect(0, 0, 1000, 1000))
    const small = makeArea('small', [], makeRect(100, 100, 50, 50))
    const result = reconcileAreaMembership([big, small], 'table-1', {
      x: 110,
      y: 110, // inside both
    })
    expect(result).toEqual({ join: 'small', leave: [], refit: ['big'] })
  })

  it('refits area A (still inside) while joining a smaller area B it is not a member of', () => {
    const areaA = makeArea('A', ['table-1'], makeRect(0, 0, 1000, 1000))
    const areaB = makeArea('B', [], makeRect(100, 100, 50, 50))
    const result = reconcileAreaMembership([areaA, areaB], 'table-1', {
      x: 110,
      y: 110, // inside both A and B
    })
    expect(result).toEqual({ join: 'B', leave: [], refit: ['A'] })
  })

  it('returns all-empty sets when no area contains the point and the table is not a member of anything', () => {
    const area = makeArea('a', [], makeRect(0, 0, 100, 100))
    const result = reconcileAreaMembership([area], 'table-1', {
      x: 9999,
      y: 9999,
    })
    expect(result).toEqual({ join: null, leave: [], refit: [] })
  })
})

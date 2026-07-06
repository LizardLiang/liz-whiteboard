// src/lib/react-flow/multi-drag-commit.test.ts
// Unit tests for planMultiDragCommit (GH #111 — multi-select drag persist +
// area-membership reconciliation for ALL dragged tables, not just the leader).

import { describe, expect, it } from 'vitest'
import { planMultiDragCommit } from './multi-drag-commit'
import type { DraggedTableInput } from './multi-drag-commit'
import type { ReconcileArea } from './area-bounds'

function makeArea(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
  memberTableIds: Array<string> = [],
): ReconcileArea {
  return {
    id,
    positionX: rect.x,
    positionY: rect.y,
    width: rect.width,
    height: rect.height,
    memberTableIds,
  }
}

function makeDragged(
  id: string,
  center: { x: number; y: number },
  position?: { x: number; y: number },
): DraggedTableInput {
  return { id, center, position: position ?? center }
}

describe('planMultiDragCommit', () => {
  it('produces one positions entry per dragged table with correct coords', () => {
    const dragged = [
      makeDragged('t1', { x: 10, y: 10 }, { x: 5, y: 5 }),
      makeDragged('t2', { x: 20, y: 20 }, { x: 15, y: 15 }),
      makeDragged('t3', { x: 30, y: 30 }, { x: 25, y: 25 }),
    ]
    const commit = planMultiDragCommit(dragged, [])

    expect(commit.positions).toEqual([
      { id: 't1', positionX: 5, positionY: 5 },
      { id: 't2', positionX: 15, positionY: 15 },
      { id: 't3', positionX: 25, positionY: 25 },
    ])
  })

  it('dedupes refitAreaIds when two dragged tables land in the same area', () => {
    // Both t1 and t2 are already members of area A, dropped with centers
    // still inside A's rect — reconcileAreaMembership returns `refit` for
    // each, and the union must collapse to a single areaId (D2).
    const areaA = makeArea('areaA', { x: 0, y: 0, width: 200, height: 200 }, [
      't1',
      't2',
    ])
    const dragged = [
      makeDragged('t1', { x: 50, y: 50 }),
      makeDragged('t2', { x: 100, y: 100 }),
    ]
    const commit = planMultiDragCommit(dragged, [areaA])

    expect(commit.refitAreaIds).toEqual(['areaA'])
    expect(commit.joins).toEqual([])
    expect(commit.leaves).toEqual([])
  })

  it('emits a leave entry for a table whose center exits its area and a join entry for one entering', () => {
    const areaA = makeArea(
      'areaA',
      { x: 0, y: 0, width: 100, height: 100 },
      ['t1'],
    )
    const areaB = makeArea('areaB', { x: 500, y: 500, width: 100, height: 100 })

    const dragged = [
      // t1 was a member of areaA; dropped outside it -> leave areaA.
      makeDragged('t1', { x: 900, y: 900 }),
      // t2 was not a member of anything; dropped inside areaB -> join areaB.
      makeDragged('t2', { x: 520, y: 520 }),
    ]
    const commit = planMultiDragCommit(dragged, [areaA, areaB])

    expect(commit.leaves).toEqual([{ tableId: 't1', areaId: 'areaA' }])
    expect(commit.joins).toEqual([{ tableId: 't2', areaId: 'areaB' }])
    expect(commit.refitAreaIds).toEqual([])
  })

  it('produces a correct commit for a single-table input (parity with the single-drag path)', () => {
    const areaA = makeArea(
      'areaA',
      { x: 0, y: 0, width: 100, height: 100 },
      ['t1'],
    )
    const dragged = [makeDragged('t1', { x: 50, y: 50 }, { x: 40, y: 40 })]
    const commit = planMultiDragCommit(dragged, [areaA])

    expect(commit.positions).toEqual([
      { id: 't1', positionX: 40, positionY: 40 },
    ])
    expect(commit.joins).toEqual([])
    expect(commit.leaves).toEqual([])
    expect(commit.refitAreaIds).toEqual(['areaA'])
    expect(commit.areaMemberUpdates).toEqual([])
  })

  // GH #111 code-review BLOCKER 2 — two dragged tables joining/leaving the
  // SAME area in one drop must collapse to a single final member list
  // instead of a last-write-wins race from issuing one membership-handler
  // call per table against the same stale snapshot.
  describe('areaMemberUpdates (BLOCKER 2 — collapsed per-area membership)', () => {
    it('collapses two tables joining the SAME empty area into one update containing BOTH', () => {
      const areaA = makeArea('areaA', { x: 0, y: 0, width: 200, height: 200 })
      const dragged = [
        makeDragged('t1', { x: 50, y: 50 }),
        makeDragged('t2', { x: 100, y: 100 }),
      ]
      const commit = planMultiDragCommit(dragged, [areaA])

      expect(commit.joins).toEqual([
        { tableId: 't1', areaId: 'areaA' },
        { tableId: 't2', areaId: 'areaA' },
      ])
      expect(commit.areaMemberUpdates).toEqual([
        { areaId: 'areaA', memberTableIds: ['t1', 't2'] },
      ])
    })

    it('resolves a join + a leave on the same area to the correct final member list', () => {
      // areaA starts with t1 as its only member. t1 drags out (leave), t2
      // (not previously a member) drags in (join) — final membership should
      // be exactly [t2], not [t1, t2] or [] from a stale-snapshot race.
      const areaA = makeArea(
        'areaA',
        { x: 0, y: 0, width: 100, height: 100 },
        ['t1'],
      )
      const dragged = [
        makeDragged('t1', { x: 900, y: 900 }),
        makeDragged('t2', { x: 50, y: 50 }),
      ]
      const commit = planMultiDragCommit(dragged, [areaA])

      expect(commit.leaves).toEqual([{ tableId: 't1', areaId: 'areaA' }])
      expect(commit.joins).toEqual([{ tableId: 't2', areaId: 'areaA' }])
      expect(commit.areaMemberUpdates).toEqual([
        { areaId: 'areaA', memberTableIds: ['t2'] },
      ])
    })

    it('omits an area whose final member set is unchanged (no redundant update)', () => {
      // Both t1 and t2 stay inside area A (refit-only, no membership delta)
      // — areaMemberUpdates must stay empty even though refitAreaIds fires.
      const areaA = makeArea('areaA', { x: 0, y: 0, width: 200, height: 200 }, [
        't1',
        't2',
      ])
      const dragged = [
        makeDragged('t1', { x: 50, y: 50 }),
        makeDragged('t2', { x: 100, y: 100 }),
      ]
      const commit = planMultiDragCommit(dragged, [areaA])

      expect(commit.refitAreaIds).toEqual(['areaA'])
      expect(commit.areaMemberUpdates).toEqual([])
    })
  })
})

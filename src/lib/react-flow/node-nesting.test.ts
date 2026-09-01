// src/lib/react-flow/node-nesting.test.ts
// Unit tests for the absolute <-> parent-relative conversion that makes a table
// a real React Flow child of its area (todo #55 follow-up).
//
// The invariant worth guarding: a round trip must be lossless, and a table with
// no area must be untouched by either direction — that identity is what keeps
// nesting from changing behaviour for every ungrouped table on the board.

import { describe, expect, it } from 'vitest'
import {
  buildParentIndex,
  toAbsolute,
  toAbsoluteNodes,
  toRelative,
} from './node-nesting'
import type { NestingParent } from './node-nesting'

const area = (
  id: string,
  positionX: number,
  positionY: number,
  memberTableIds: Array<string>,
) => ({ id, positionX, positionY, memberTableIds })

describe('buildParentIndex', () => {
  it('maps every member table to its area', () => {
    const index = buildParentIndex([
      area('a1', 100, 50, ['t1', 't2']),
      area('a2', 900, 20, ['t3']),
    ])
    expect(index.get('t1')).toEqual({ id: 'a1', positionX: 100, positionY: 50 })
    expect(index.get('t2')?.id).toBe('a1')
    expect(index.get('t3')).toEqual({ id: 'a2', positionX: 900, positionY: 20 })
  })

  it('leaves an ungrouped table out entirely', () => {
    const index = buildParentIndex([area('a1', 0, 0, ['t1'])])
    expect(index.has('t9')).toBe(false)
  })

  it('is empty for a board with no areas — the nested-canvas case', () => {
    // TableFocusOverlay renders tables with no area nodes at all. An empty
    // index is what stops a table getting a parentId React Flow cannot resolve.
    expect(buildParentIndex([]).size).toBe(0)
  })

  it('resolves a table claimed by two areas deterministically (first wins)', () => {
    const index = buildParentIndex([
      area('first', 10, 10, ['t1']),
      area('second', 500, 500, ['t1']),
    ])
    expect(index.get('t1')?.id).toBe('first')
  })
})

describe('toRelative / toAbsolute', () => {
  const parent: NestingParent = { id: 'a1', positionX: 100, positionY: 40 }

  it('subtracts and adds the parent origin', () => {
    expect(toRelative({ x: 150, y: 90 }, parent)).toEqual({ x: 50, y: 50 })
    expect(toAbsolute({ x: 50, y: 50 }, parent)).toEqual({ x: 150, y: 90 })
  })

  it('round-trips losslessly, including negative offsets', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: -320, y: 12.5 },
      { x: 1e5, y: -1e5 },
    ]) {
      expect(toAbsolute(toRelative(point, parent), parent)).toEqual(point)
    }
  })

  it('is the identity for a table that belongs to no area', () => {
    const point = { x: 7, y: 9 }
    expect(toRelative(point, undefined)).toBe(point)
    expect(toAbsolute(point, undefined)).toBe(point)
  })
})

describe('toAbsoluteNodes', () => {
  const nodes = [
    { id: 't1', position: { x: 50, y: 50 } },
    { id: 't2', position: { x: 400, y: 300 } },
  ]

  it('converts only the nested nodes and leaves the rest identical', () => {
    const index = buildParentIndex([area('a1', 100, 40, ['t1'])])
    const result = toAbsoluteNodes(nodes, index)
    expect(result[0].position).toEqual({ x: 150, y: 90 })
    // Untouched node is the SAME object — the drag path this feeds runs per
    // frame, so an ungrouped board must not allocate a new node array entry.
    expect(result[1]).toBe(nodes[1])
  })

  it('returns the input list untouched when nothing is nested', () => {
    expect(toAbsoluteNodes(nodes, new Map())).toBe(nodes)
  })
})

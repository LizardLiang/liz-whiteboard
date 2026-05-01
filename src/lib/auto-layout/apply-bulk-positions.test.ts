// src/lib/auto-layout/apply-bulk-positions.test.ts
// Unit tests for the applyBulkPositions helper (B3 fix).
// TC-AL-B3-01 through TC-AL-B3-06

import { describe, expect, it } from 'vitest'
import { applyBulkPositions } from './index'

// ---------------------------------------------------------------------------
// Minimal node shape matching the generic constraint
// ---------------------------------------------------------------------------
interface TestNode {
  id: string
  position: { x: number; y: number }
  data: { label: string }
}

function makeNode(id: string, x = 0, y = 0): TestNode {
  return { id, position: { x, y }, data: { label: id } }
}

describe('applyBulkPositions', () => {
  it('TC-AL-B3-01: returns new positions for all matched nodes', () => {
    const nodes = [makeNode('a', 10, 20), makeNode('b', 30, 40)]
    const positions = [
      { id: 'a', x: 100, y: 200 },
      { id: 'b', x: 300, y: 400 },
    ]
    const result = applyBulkPositions(nodes, positions)
    expect(result[0].position).toEqual({ x: 100, y: 200 })
    expect(result[1].position).toEqual({ x: 300, y: 400 })
  })

  it('TC-AL-B3-02: leaves unmatched nodes unchanged', () => {
    const nodes = [makeNode('a', 10, 20), makeNode('b', 30, 40)]
    const positions = [{ id: 'a', x: 100, y: 200 }]
    const result = applyBulkPositions(nodes, positions)
    expect(result[0].position).toEqual({ x: 100, y: 200 })
    expect(result[1].position).toEqual({ x: 30, y: 40 })
  })

  it('TC-AL-B3-03: returns all original nodes unchanged when positions is empty', () => {
    const nodes = [makeNode('a', 10, 20), makeNode('b', 30, 40)]
    const result = applyBulkPositions(nodes, [])
    expect(result[0].position).toEqual({ x: 10, y: 20 })
    expect(result[1].position).toEqual({ x: 30, y: 40 })
  })

  it('TC-AL-B3-04: returns empty array when nodes is empty', () => {
    const result = applyBulkPositions([], [{ id: 'a', x: 1, y: 2 }])
    expect(result).toHaveLength(0)
  })

  it('TC-AL-B3-05: preserves all non-position fields on matched nodes', () => {
    const nodes = [makeNode('a', 10, 20)]
    const result = applyBulkPositions(nodes, [{ id: 'a', x: 99, y: 88 }])
    expect(result[0].data).toEqual({ label: 'a' })
    expect(result[0].id).toBe('a')
  })

  it('TC-AL-B3-06: handles duplicate positions entries — last one wins via Map insertion order', () => {
    // Map(positions.map(p => [p.id, p])) — if positions has duplicates, the last entry wins
    const nodes = [makeNode('a', 0, 0)]
    const positions = [
      { id: 'a', x: 10, y: 10 },
      { id: 'a', x: 99, y: 99 },
    ]
    const result = applyBulkPositions(nodes, positions)
    // Map construction: second entry overwrites first, so 99,99 wins
    expect(result[0].position).toEqual({ x: 99, y: 99 })
  })
})

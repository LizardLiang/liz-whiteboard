// Unit tests for computeAreaAwareLayout

import { describe, expect, it } from 'vitest'
import {
  AREA_PAD_BOTTOM,
  AREA_PAD_TOP,
  AREA_PAD_X,
  computeAreaAwareLayout,
} from './area-aware-layout'
import { computeD3ForceLayout } from './d3-force-layout'
import type { AreaLayoutInputArea } from './area-aware-layout'
import type { LayoutInputNode } from './d3-force-layout'

const W = 200
const H = 100

function table(id: string): LayoutInputNode {
  return { id, width: W, height: H }
}

function area(
  id: string,
  memberTableIds: Array<string>,
  extra: Partial<AreaLayoutInputArea> = {},
): AreaLayoutInputArea {
  return {
    id,
    positionX: 0,
    positionY: 0,
    width: 300,
    height: 200,
    memberTableIds,
    ...extra,
  }
}

const tables = ['a', 'b', 'c', 'd', 'e', 'f'].map(table)
const edges = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'c', target: 'd' },
  { source: 'e', target: 'f' },
]

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

describe('computeAreaAwareLayout', () => {
  it('(a) matches computeD3ForceLayout when there are no areas', async () => {
    const flat = await computeD3ForceLayout(tables, edges)
    const out = await computeAreaAwareLayout({ tables, edges, areas: [] })
    expect(out.tables).toEqual(flat)
    expect(out.areas).toEqual([])
  })

  it('(b) keeps every member inside its area with padding', async () => {
    const areas = [area('A1', ['a', 'b', 'c']), area('A2', ['e'])]
    const out = await computeAreaAwareLayout({ tables, edges, areas })
    const pos = new Map(out.tables.map((p) => [p.id, p]))
    for (const a of areas) {
      const rect = out.areas.find((r) => r.id === a.id)!
      for (const id of a.memberTableIds) {
        const p = pos.get(id)!
        expect(p.x).toBeGreaterThanOrEqual(rect.positionX + AREA_PAD_X)
        expect(p.y).toBeGreaterThanOrEqual(rect.positionY + AREA_PAD_TOP)
        expect(p.x + W).toBeLessThanOrEqual(
          rect.positionX + rect.width - AREA_PAD_X,
        )
        expect(p.y + H).toBeLessThanOrEqual(
          rect.positionY + rect.height - AREA_PAD_BOTTOM,
        )
      }
    }
  })

  it('(c) areas and ungrouped tables do not overlap', async () => {
    const areas = [area('A1', ['a', 'b', 'c']), area('A2', ['e', 'f'])]
    const out = await computeAreaAwareLayout({ tables, edges, areas })
    const rects = out.areas.map((r) => ({
      x: r.positionX,
      y: r.positionY,
      w: r.width,
      h: r.height,
    }))
    expect(rectsOverlap(rects[0], rects[1])).toBe(false)
    const d = out.tables.find((t) => t.id === 'd')!
    for (const r of rects) {
      expect(rectsOverlap(r, { x: d.x, y: d.y, w: W, h: H })).toBe(false)
    }
  })

  it('(d) an edge from a member to an outside table still lays out every table', async () => {
    const areas = [area('A1', ['a', 'b', 'c'])]
    const out = await computeAreaAwareLayout({ tables, edges, areas })
    expect(out.tables).toHaveLength(tables.length)
    expect(out.areas).toHaveLength(1)
    for (const t of out.tables) {
      expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true)
    }
  })

  it('(e) an empty area keeps its size', async () => {
    const areas = [
      area('E', [], { width: 400, height: 260 }),
      area('A1', ['a', 'b']),
    ]
    const out = await computeAreaAwareLayout({ tables, edges, areas })
    const empty = out.areas.find((r) => r.id === 'E')!
    expect(empty.width).toBe(400)
    expect(empty.height).toBe(260)
  })

  it('(f) a table in two areas is laid out only under the first', async () => {
    const areas = [area('A1', ['a', 'b']), area('A2', ['b', 'c'])]
    const out = await computeAreaAwareLayout({ tables, edges, areas })
    const pos = out.tables.filter((t) => t.id === 'b')
    expect(pos).toHaveLength(1)
    const r1 = out.areas.find((r) => r.id === 'A1')!
    expect(pos[0].x).toBeGreaterThanOrEqual(r1.positionX + AREA_PAD_X)
    expect(pos[0].x + W).toBeLessThanOrEqual(r1.positionX + r1.width)
  })

  it('(g) is deterministic', async () => {
    const areas = [area('A1', ['a', 'b', 'c']), area('A2', ['e'])]
    const one = await computeAreaAwareLayout({ tables, edges, areas })
    const two = await computeAreaAwareLayout({ tables, edges, areas })
    expect(two).toEqual(one)
  })

  it('ignores member ids that are not in tables', async () => {
    const areas = [area('A1', ['a', 'ghost'])]
    const out = await computeAreaAwareLayout({ tables, edges, areas })
    expect(out.tables.map((t) => t.id)).not.toContain('ghost')
    expect(out.tables).toHaveLength(tables.length)
  })

  it('output areas carry no memberTableIds', async () => {
    const out = await computeAreaAwareLayout({
      tables,
      edges,
      areas: [area('A1', ['a'])],
    })
    expect(out.areas[0]).not.toHaveProperty('memberTableIds')
  })
})

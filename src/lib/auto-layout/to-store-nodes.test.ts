import { describe, expect, it } from 'vitest'
import { toStoreNodes } from './to-store-nodes'

const area = (id: string, x: number, y: number) => ({
  id,
  type: 'area',
  position: { x, y },
  data: {
    area: { id, positionX: x, positionY: y, width: 100, height: 100 },
  },
})
const table = (id: string, x: number, y: number) => ({
  id,
  type: 'table',
  position: { x, y },
})

describe('toStoreNodes', () => {
  it('makes members relative to the NEW area origin and resizes the area', () => {
    const nodes = [area('a1', 0, 0), table('t1', 10, 10), table('t2', 500, 500)]
    const out = toStoreNodes(
      nodes,
      [
        { id: 't1', x: 300, y: 400 },
        { id: 't2', x: 700, y: 800 },
      ],
      [{ id: 'a1', positionX: 280, positionY: 350, width: 200, height: 150 }],
      [{ id: 'a1', memberTableIds: ['t1'] }],
    )
    expect(out[0].position).toEqual({ x: 280, y: 350 })
    expect((out[0] as any).width).toBe(200)
    expect((out[0] as any).data.area.height).toBe(150)
    expect(out[1].position).toEqual({ x: 20, y: 50 })
    expect(out[2].position).toEqual({ x: 700, y: 800 })
  })

  it('uses the area node position as origin when no bounds are sent', () => {
    const out = toStoreNodes(
      [area('a1', 100, 100), table('t1', 5, 5)],
      [{ id: 't1', x: 150, y: 160 }],
      [],
      [{ id: 'a1', memberTableIds: ['t1'] }],
    )
    expect(out[1].position).toEqual({ x: 50, y: 60 })
  })

  it('leaves unmoved nodes untouched and keeps identity', () => {
    const nodes = [table('t1', 1, 2)]
    const out = toStoreNodes(nodes, [], [], [])
    expect(out[0]).toBe(nodes[0])
  })

  it('treats a member of an unknown area as ungrouped', () => {
    const out = toStoreNodes(
      [table('t1', 0, 0)],
      [{ id: 't1', x: 9, y: 9 }],
      [],
      [{ id: 'gone', memberTableIds: ['t1'] }],
    )
    expect(out[0].position).toEqual({ x: 9, y: 9 })
  })
})

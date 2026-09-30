import { describe, expect, it } from 'vitest'
import {
  SERVER_TABLE_WIDTH_ESTIMATE,
  buildServerLayoutInput,
} from './server-layout-input'
import type { LayoutSourceTable } from './server-layout-input'
import { calculateTableHeight } from '@/lib/react-flow/layout-adapter'

function table(
  id: string,
  columnIds: Array<string>,
  width: number | null = null,
): LayoutSourceTable {
  return {
    id,
    width,
    columns: columnIds.map((cid) => ({ id: cid })),
  } as unknown as LayoutSourceTable
}

describe('buildServerLayoutInput', () => {
  const tables = [table('t1', ['a', 'b', 'c']), table('t2', ['x', 'y'], 400)]
  const rel = {
    id: 'r1',
    sourceTableId: 't1',
    targetTableId: 't2',
    sourceColumnId: 'c',
    targetColumnId: 'x',
    label: 'owns',
    cardinality: 'ONE_TO_MANY',
  } as never

  it('sizes nodes from the estimate, saved width and column count', () => {
    const { nodes } = buildServerLayoutInput(tables, [])
    expect(nodes[0]).toEqual({
      id: 't1',
      width: SERVER_TABLE_WIDTH_ESTIMATE,
      height: calculateTableHeight(3),
    })
    expect(nodes[1].width).toBe(400)
    expect(nodes[1].height).toBe(calculateTableHeight(2))
  })

  it('maps relationship columns to row indexes with label and cardinality', () => {
    const { edges } = buildServerLayoutInput(tables, [rel])
    expect(edges).toEqual([
      {
        id: 'r1',
        source: 't1',
        target: 't2',
        label: 'owns',
        cardinality: 'ONE_TO_MANY',
        sourceRow: 2,
        targetRow: 0,
      },
    ])
  })

  it('leaves the row undefined when the column is missing', () => {
    const { edges } = buildServerLayoutInput(tables, [
      { ...(rel as object), sourceColumnId: 'zzz', label: '' } as never,
    ])
    expect(edges[0].sourceRow).toBeUndefined()
    expect(edges[0].label).toBeUndefined()
  })
})

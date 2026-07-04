// src/lib/react-flow/search-index.test.ts
// Unit tests for the Cmd/Ctrl+K search index builder.

import { describe, expect, it } from 'vitest'
import { buildSearchIndex } from './search-index'
import type { TableNodeType } from './types'

/** Minimal node factory — buildSearchIndex only reads id + table name/columns. */
function node(
  id: string,
  name: string,
  columns: Array<{ id: string; name: string }>,
): TableNodeType {
  return {
    id,
    data: { table: { id, name, columns } },
  } as unknown as TableNodeType
}

describe('buildSearchIndex', () => {
  it('returns an empty index for no nodes', () => {
    expect(buildSearchIndex([])).toEqual([])
  })

  it('creates one table entry and one column entry per column', () => {
    const nodes = [
      node('t1', 'users', [
        { id: 'c1', name: 'id' },
        { id: 'c2', name: 'email' },
      ]),
    ]

    const index = buildSearchIndex(nodes)

    expect(index).toEqual([
      { type: 'table', tableId: 't1', tableName: 'users' },
      {
        type: 'column',
        tableId: 't1',
        tableName: 'users',
        columnId: 'c1',
        columnName: 'id',
      },
      {
        type: 'column',
        tableId: 't1',
        tableName: 'users',
        columnId: 'c2',
        columnName: 'email',
      },
    ])
  })

  it('orders all tables before all columns', () => {
    const nodes = [
      node('t1', 'users', [{ id: 'c1', name: 'id' }]),
      node('t2', 'orders', [{ id: 'c2', name: 'total' }]),
    ]

    const types = buildSearchIndex(nodes).map((entry) => entry.type)

    expect(types).toEqual(['table', 'table', 'column', 'column'])
  })

  it('maps each column entry to its owning table id and name', () => {
    const nodes = [
      node('t1', 'users', [{ id: 'c1', name: 'id' }]),
      node('t2', 'orders', [{ id: 'c2', name: 'user_id' }]),
    ]

    const columns = buildSearchIndex(nodes).filter(
      (entry) => entry.type === 'column',
    )

    expect(columns).toEqual([
      {
        type: 'column',
        tableId: 't1',
        tableName: 'users',
        columnId: 'c1',
        columnName: 'id',
      },
      {
        type: 'column',
        tableId: 't2',
        tableName: 'orders',
        columnId: 'c2',
        columnName: 'user_id',
      },
    ])
  })

  it('includes a table with no columns as a table-only entry', () => {
    const index = buildSearchIndex([node('t1', 'empty', [])])

    expect(index).toEqual([
      { type: 'table', tableId: 't1', tableName: 'empty' },
    ])
  })
})

// src/hooks/use-sql-import.test.ts
// The import's layout pass resizes areas on the server; the importing client
// must hand those bounds to its caller so peers receive area:update.

import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}))

vi.mock('@/lib/parser/diagram-parser', () => ({
  astToEntities: () => ({
    tables: [
      {
        table: { name: 'users', whiteboardId: 'wb' },
        columns: [],
      },
    ],
    relationships: [],
  }),
}))

vi.mock('@/lib/server-functions', () => ({
  computeAutoLayout: vi.fn(),
  createRelationshipFn: vi.fn(),
  createTable: vi.fn(() => Promise.resolve({ id: 't1' })),
}))

vi.mock('@/routes/api/columns', () => ({ createColumnsFn: vi.fn() }))

// eslint-disable-next-line import/first
import { computeAutoLayout, createTable } from '@/lib/server-functions'
// eslint-disable-next-line import/first, import/order
import { useSqlImport } from './use-sql-import'

const AREA = {
  id: 'a1',
  positionX: 10,
  positionY: 20,
  width: 300,
  height: 200,
}

describe('useSqlImport', () => {
  it('hands the positions and resized area bounds to onLayoutApplied', async () => {
    ;(
      computeAutoLayout as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      positions: [{ id: 't1', x: 5, y: 6 }],
      areas: [AREA],
    })
    const onLayoutApplied = vi.fn()
    const { result } = renderHook(() => useSqlImport('wb'))
    await result.current.importDiagram({} as any, { onLayoutApplied })
    expect(onLayoutApplied).toHaveBeenCalledWith(
      [{ id: 't1', x: 5, y: 6 }],
      [AREA],
    )
  })

  it('does not call onLayoutApplied when the layout call is unauthorized', async () => {
    ;(
      computeAutoLayout as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      error: 'UNAUTHORIZED',
      status: 401,
    })
    const onLayoutApplied = vi.fn()
    const { result } = renderHook(() => useSqlImport('wb'))
    await result.current.importDiagram({} as any, { onLayoutApplied })
    expect(onLayoutApplied).not.toHaveBeenCalled()
  })

  it('sends one batch id, kind sql-import, with every create of an import', async () => {
    vi.doMock('@/lib/parser/diagram-parser', () => ({
      astToEntities: () => ({
        tables: [
          {
            table: { name: 'users', whiteboardId: 'wb' },
            columns: [{ name: 'id', dataType: 'int' }],
          },
          {
            table: { name: 'orders', whiteboardId: 'wb' },
            columns: [{ name: 'user_id', dataType: 'int' }],
          },
        ],
        relationships: [
          {
            sourceTable: 'orders',
            sourceColumn: 'user_id',
            targetTable: 'users',
            targetColumn: 'id',
            cardinality: 'MANY_TO_ONE',
            label: null,
          },
        ],
      }),
    }))
    vi.resetModules()
    const { useSqlImport: freshHook } = await import('./use-sql-import')
    const serverFns = await import('@/lib/server-functions')
    const columnFns = await import('@/routes/api/columns')
    vi.mocked(serverFns.createTable).mockClear()
    vi.mocked(columnFns.createColumnsFn).mockClear()
    vi.mocked(serverFns.createRelationshipFn).mockClear()
    vi.mocked(serverFns.createTable).mockImplementation(((arg: any) =>
      Promise.resolve({ id: `id-${arg.data.name}` })) as any)
    vi.mocked(columnFns.createColumnsFn).mockImplementation(((arg: any) =>
      Promise.resolve(
        arg.data.columns.map((c: any) => ({ id: `c-${c.name}`, name: c.name })),
      )) as any)
    vi.mocked(serverFns.createRelationshipFn).mockResolvedValue({
      id: 'r1',
    } as any)
    vi.mocked(serverFns.computeAutoLayout).mockResolvedValue({
      positions: [],
      areas: [],
    })

    const { result } = renderHook(() => freshHook('wb'))
    await result.current.importDiagram({} as any)

    const tableCalls = vi.mocked(serverFns.createTable).mock.calls
    const columnCalls = vi.mocked(columnFns.createColumnsFn).mock.calls
    const relCalls = vi.mocked(serverFns.createRelationshipFn).mock.calls
    const batchIds = [
      ...tableCalls.map((c: any) => c[0].data.batchId),
      ...columnCalls.map((c: any) => c[0].data.batchId),
      ...relCalls.map((c: any) => c[0].data.batchId),
    ]
    expect(batchIds).toHaveLength(5)
    expect(new Set(batchIds).size).toBe(1)
    expect(typeof batchIds[0]).toBe('string')
    expect(batchIds[0].length).toBeGreaterThan(0)
    expect(batchIds[0].length).toBeLessThanOrEqual(64)
    const kinds = [
      ...tableCalls.map((c: any) => c[0].data.batchKind),
      ...columnCalls.map((c: any) => c[0].data.batchKind),
      ...relCalls.map((c: any) => c[0].data.batchKind),
    ]
    expect(new Set(kinds)).toEqual(new Set(['sql-import']))
  })

  it('mints a different batch id for each import', async () => {
    const { result } = renderHook(() => useSqlImport('wb'))
    vi.mocked(createTable).mockClear()
    await result.current.importDiagram({} as any)
    await result.current.importDiagram({} as any)
    const ids = vi
      .mocked(createTable)
      .mock.calls.map((c: any) => c[0].data.batchId)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

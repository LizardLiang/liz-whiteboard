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
import { computeAutoLayout } from '@/lib/server-functions'
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
})

// src/hooks/use-column-mutations.test.ts
// TS-07: useColumnMutations unit tests
// TS-13: Optimistic UI update tests

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useColumnMutations } from './use-column-mutations'
import { mockColumn, mockPKColumn, mockFKColumn } from '@/test/fixtures'
import type { TableNodeType, RelationshipEdgeType } from '@/lib/react-flow/types'
import type { Column } from '@prisma/client'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const makeTableNode = (columns: Array<Column>): TableNodeType => ({
  id: 'tbl-001',
  type: 'table',
  position: { x: 0, y: 0 },
  data: {
    table: {
      id: 'tbl-001',
      name: 'orders',
      whiteboardId: 'wb-001',
      positionX: 0,
      positionY: 0,
      showMode: 'ALL_FIELDS',
      createdAt: new Date(),
      updatedAt: new Date(),
      columns,
    },
    edges: [],
    isActiveHighlighted: false,
    isHighlighted: false,
    isHovered: false,
    showMode: 'ALL_FIELDS',
  },
})

const makeEdge = (sourceColumnId: string, targetColumnId: string): RelationshipEdgeType => ({
  id: `edge-${sourceColumnId}`,
  source: 'tbl-001',
  target: 'tbl-002',
  type: 'relationship',
  data: {
    relationship: {
      id: `rel-${sourceColumnId}`,
      sourceTableId: 'tbl-001',
      targetTableId: 'tbl-002',
      sourceColumnId,
      targetColumnId,
      cardinality: 'MANY_TO_ONE',
      sourceColumn: mockFKColumn as any,
      targetColumn: mockPKColumn as any,
    },
    cardinality: 'MANY_TO_ONE',
    isHighlighted: false,
  } as any,
})

describe('useColumnMutations', () => {
  let setNodes: ReturnType<typeof vi.fn>
  let setEdges: ReturnType<typeof vi.fn>
  let emitColumnCreate: ReturnType<typeof vi.fn>
  let emitColumnUpdate: ReturnType<typeof vi.fn>
  let emitColumnDelete: ReturnType<typeof vi.fn>

  const initialColumns = [mockPKColumn, mockColumn, mockFKColumn]
  let nodes: Array<TableNodeType>
  let edges: Array<RelationshipEdgeType>

  beforeEach(() => {
    nodes = [makeTableNode(initialColumns)]
    edges = [makeEdge('col-fk', 'col-pk')]

    setNodes = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        nodes = updater(nodes)
      } else {
        nodes = updater
      }
    })

    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    emitColumnCreate = vi.fn()
    emitColumnUpdate = vi.fn()
    emitColumnDelete = vi.fn()

    vi.clearAllMocks()
  })

  describe('createColumn', () => {
    it('TC-07-01: calls emitColumnCreate with correct payload', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.createColumn('tbl-001', {
          name: 'new_col',
          dataType: 'string',
          order: 3,
        })
      })

      expect(emitColumnCreate).toHaveBeenCalledWith({
        tableId: 'tbl-001',
        name: 'new_col',
        dataType: 'string',
        order: 3,
      })
    })

    it('TC-07-02 / TC-13-01: adds optimistic column to node data before emit', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.createColumn('tbl-001', {
          name: 'new_col',
          dataType: 'int',
          order: 3,
        })
      })

      // setNodes should have been called to add the optimistic column
      expect(setNodes).toHaveBeenCalled()
      // The optimistic column should be in nodes now
      const updatedNode = nodes.find((n) => n.data.table.id === 'tbl-001')
      const newCol = updatedNode?.data.table.columns.find((c) => c.name === 'new_col')
      expect(newCol).toBeTruthy()
      expect(newCol?.dataType).toBe('int')
    })

    it('TC-13-02: optimistic column has a non-empty temp ID', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.createColumn('tbl-001', {
          name: 'temp_col',
          dataType: 'string',
          order: 3,
        })
      })

      const updatedNode = nodes.find((n) => n.data.table.id === 'tbl-001')
      const newCol = updatedNode?.data.table.columns.find((c) => c.name === 'temp_col')
      expect(newCol?.id).toBeTruthy()
      expect(newCol?.id.length).toBeGreaterThan(0)
    })

    it('TC-07-03: when isConnected=false, shows toast and aborts without emit', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          false, // not connected
        ),
      )

      await act(async () => {
        await result.current.createColumn('tbl-001', {
          name: 'new_col',
          dataType: 'string',
          order: 3,
        })
      })

      expect(emitColumnCreate).not.toHaveBeenCalled()
      expect(setNodes).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Not connected'))
    })
  })

  describe('updateColumn', () => {
    it('TC-07-04: calls emitColumnUpdate with columnId and changed fields', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.updateColumn('col-001', 'tbl-001', { name: 'new_name' })
      })

      expect(emitColumnUpdate).toHaveBeenCalledWith('col-001', { name: 'new_name' })
    })

    it('TC-07-05 / TC-13-04: applies optimistic update before emit', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.updateColumn('col-001', 'tbl-001', { name: 'updated_email' })
      })

      expect(setNodes).toHaveBeenCalled()
      const updatedNode = nodes.find((n) => n.data.table.id === 'tbl-001')
      const updatedCol = updatedNode?.data.table.columns.find((c) => c.id === 'col-001')
      expect(updatedCol?.name).toBe('updated_email')
    })

    it('TC-07-06: when isConnected=false, shows toast and aborts', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          false,
        ),
      )

      await act(async () => {
        await result.current.updateColumn('col-001', 'tbl-001', { name: 'new_name' })
      })

      expect(emitColumnUpdate).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalled()
    })
  })

  describe('deleteColumn', () => {
    it('TC-07-07: calls emitColumnDelete with columnId', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.deleteColumn('col-001', 'tbl-001')
      })

      expect(emitColumnDelete).toHaveBeenCalledWith('col-001')
    })

    it('TC-07-08 / TC-13-05: removes column from node data optimistically', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.deleteColumn('col-001', 'tbl-001')
      })

      const updatedNode = nodes.find((n) => n.data.table.id === 'tbl-001')
      const deletedCol = updatedNode?.data.table.columns.find((c) => c.id === 'col-001')
      expect(deletedCol).toBeUndefined()
    })

    it('TC-07-09: removes affected edges from edge state optimistically', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      // col-fk is referenced by the edge
      await act(async () => {
        await result.current.deleteColumn('col-fk', 'tbl-001')
      })

      // The edge referencing col-fk should be gone
      const remainingEdge = edges.find((e) => e.id === 'edge-col-fk')
      expect(remainingEdge).toBeUndefined()
    })
  })

  describe('onColumnError / rollback', () => {
    it('TC-07-10: rollback on create error — removes optimistic column and shows toast', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      await act(async () => {
        await result.current.createColumn('tbl-001', {
          name: 'new_col',
          dataType: 'string',
          order: 3,
        })
      })

      // Verify column was added optimistically
      let updatedNode = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(updatedNode?.data.table.columns.find((c) => c.name === 'new_col')).toBeTruthy()

      // Simulate server error for create
      act(() => {
        result.current.onColumnError({
          event: 'column:create',
          error: 'server error',
          message: 'Unable to create',
          tableId: 'tbl-001',
        })
      })

      // Column should be rolled back
      updatedNode = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(updatedNode?.data.table.columns.find((c) => c.name === 'new_col')).toBeUndefined()
      expect(toast.error).toHaveBeenCalled()
    })

    it('TC-07-11: rollback on update error — restores previous column value', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      // Update the column
      await act(async () => {
        await result.current.updateColumn('col-001', 'tbl-001', { name: 'updated_email' })
      })

      // Verify optimistic update applied
      let node = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(node?.data.table.columns.find((c) => c.id === 'col-001')?.name).toBe('updated_email')

      // Simulate server error
      act(() => {
        result.current.onColumnError({
          event: 'column:update',
          error: 'server error',
          message: 'Update failed',
          columnId: 'col-001',
          tableId: 'tbl-001',
        })
      })

      // Column should revert to original name
      node = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(node?.data.table.columns.find((c) => c.id === 'col-001')?.name).toBe('email')
      expect(toast.error).toHaveBeenCalled()
    })

    it('TC-07-12: rollback on delete error — re-inserts column', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      // Delete the column
      await act(async () => {
        await result.current.deleteColumn('col-001', 'tbl-001')
      })

      // Verify optimistic delete
      let node = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(node?.data.table.columns.find((c) => c.id === 'col-001')).toBeUndefined()

      // Simulate server error
      act(() => {
        result.current.onColumnError({
          event: 'column:delete',
          error: 'server error',
          message: 'Delete failed',
          columnId: 'col-001',
          tableId: 'tbl-001',
        })
      })

      // Column should be restored
      node = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(node?.data.table.columns.find((c) => c.id === 'col-001')).toBeTruthy()
    })

    it('TC-13-06: rollback restores state to pre-mutation value', async () => {
      const { result } = renderHook(() =>
        useColumnMutations(
          setNodes,
          setEdges,
          emitColumnCreate,
          emitColumnUpdate,
          emitColumnDelete,
          true,
        ),
      )

      // Update and get pre-mutation snapshot
      const preMutationName = 'email'

      await act(async () => {
        await result.current.updateColumn('col-001', 'tbl-001', { name: 'wrong_name' })
      })

      act(() => {
        result.current.onColumnError({
          event: 'column:update',
          error: 'error',
          message: 'Failed',
          columnId: 'col-001',
        })
      })

      const node = nodes.find((n) => n.data.table.id === 'tbl-001')
      expect(node?.data.table.columns.find((c) => c.id === 'col-001')?.name).toBe(preMutationName)
    })
  })
})

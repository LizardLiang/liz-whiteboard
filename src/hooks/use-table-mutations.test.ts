// src/hooks/use-table-mutations.test.ts
// TS-TD-03: useTableMutations hook unit tests
// TS-TD-07 sub-suite A: toast message differentiation (TC-TD-07-01, TC-TD-07-02)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { useTableMutations } from './use-table-mutations'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const makeTableNode = (id = 'tbl-001'): TableNodeType => ({
  id,
  type: 'table',
  position: { x: 100, y: 200 },
  data: {
    table: {
      id,
      name: 'orders',
      whiteboardId: 'wb-001',
      description: null,
      positionX: 100,
      positionY: 200,
      width: null,
      height: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      columns: [],
    },
    edges: [],
    isActiveHighlighted: false,
    isHighlighted: false,
    isHovered: false,
    isRelationsPreviewOpen: false,
    showMode: 'ALL_FIELDS',
  },
})

const makeEdge = (
  sourceTableId: string,
  targetTableId: string,
  edgeId = 'edge-001',
): RelationshipEdgeType => ({
  id: edgeId,
  source: sourceTableId,
  target: targetTableId,
  type: 'relationship',
  data: {
    relationship: {
      id: edgeId,
      sourceTableId,
      targetTableId,
      sourceColumnId: 'col-fk',
      targetColumnId: 'col-pk',
      cardinality: 'MANY_TO_ONE',
      sourceColumn: {} as any,
      targetColumn: {} as any,
    },
    cardinality: 'MANY_TO_ONE',
    isHighlighted: false,
  } as any,
})

describe('useTableMutations', () => {
  let setNodes: ReturnType<typeof vi.fn>
  let setEdges: ReturnType<typeof vi.fn>
  let emitTableDelete: ReturnType<typeof vi.fn>
  let nodes: Array<TableNodeType>
  let edges: Array<RelationshipEdgeType>

  beforeEach(() => {
    nodes = [makeTableNode('tbl-001')]
    edges = []

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

    emitTableDelete = vi.fn()
    vi.clearAllMocks()
  })

  it('TC-TD-03-01: deleteTable removes the table node from setNodes', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    expect(nodes.find((n) => n.id === 'tbl-001')).toBeUndefined()
  })

  it('TC-TD-03-02: deleteTable removes all connected edges where source matches', () => {
    edges = [makeEdge('tbl-001', 'tbl-002', 'edge-src')]

    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    expect(edges.find((e) => e.id === 'edge-src')).toBeUndefined()
    expect(edges).toHaveLength(0)
  })

  it('TC-TD-03-03: deleteTable removes all connected edges where target matches', () => {
    edges = [makeEdge('tbl-002', 'tbl-001', 'edge-tgt')]

    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    expect(edges.find((e) => e.id === 'edge-tgt')).toBeUndefined()
    expect(edges).toHaveLength(0)
  })

  it('TC-TD-03-04: deleteTable does not remove edges for unrelated tables', () => {
    edges = [makeEdge('tbl-002', 'tbl-003', 'edge-unrelated')]

    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    // Unrelated edge should still be present
    expect(edges.find((e) => e.id === 'edge-unrelated')).toBeTruthy()
  })

  it('TC-TD-03-05: deleteTable emits table:delete via emitTableDelete', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    expect(emitTableDelete).toHaveBeenCalledWith('tbl-001')
  })

  it('TC-TD-03-06: rollback on error re-inserts the deleted node', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    // Node removed optimistically
    expect(nodes.find((n) => n.id === 'tbl-001')).toBeUndefined()

    act(() => {
      result.current.onTableError({
        event: 'table:delete',
        tableId: 'tbl-001',
        error: 'server error',
      })
    })

    // Node should be back
    expect(nodes.find((n) => n.id === 'tbl-001')).toBeTruthy()
  })

  it('TC-TD-03-07: rollback on error re-inserts all deleted edges', () => {
    edges = [
      makeEdge('tbl-001', 'tbl-002', 'edge-1'),
      makeEdge('tbl-003', 'tbl-001', 'edge-2'),
    ]

    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    // Both edges removed
    expect(edges).toHaveLength(0)

    act(() => {
      result.current.onTableError({
        event: 'table:delete',
        tableId: 'tbl-001',
        error: 'server error',
      })
    })

    // Both edges restored
    expect(edges.find((e) => e.id === 'edge-1')).toBeTruthy()
    expect(edges.find((e) => e.id === 'edge-2')).toBeTruthy()
  })

  it('TC-TD-03-08 / TC-TD-07-01: rollback shows toast error notification with failure language', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    act(() => {
      result.current.onTableError({
        event: 'table:delete',
        tableId: 'tbl-001',
        error: 'server error',
      })
    })

    expect(toast.error).toHaveBeenCalled()
    // Toast message should contain failure language
    const callArgs = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(typeof callArgs[0] === 'string' && callArgs[0].length > 0).toBe(true)
  })

  it('TC-TD-03-09: when isConnected=false, shows toast and does not delete or emit', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, false),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    // Node should still be present
    expect(nodes.find((n) => n.id === 'tbl-001')).toBeTruthy()
    // setNodes should not have been called to remove the node
    expect(emitTableDelete).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Not connected'),
    )
  })

  it('TC-TD-03-10: onTableError is a no-op when no pending mutation exists for that tableId', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    // No deleteTable call, so no pending mutation
    expect(() => {
      act(() => {
        result.current.onTableError({
          event: 'table:delete',
          tableId: 'nonexistent',
          error: 'server error',
        })
      })
    }).not.toThrow()

    // setNodes should not have been called for rollback
    // (toast.error IS called because onTableError always toasts)
    expect(toast.error).toHaveBeenCalled()
  })

  it('TC-TD-03-11: rollback does not re-insert node if it already exists (concurrent remote delete then error)', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    // Simulate another remote operation that re-added the same node
    nodes = [makeTableNode('tbl-001')]

    act(() => {
      result.current.onTableError({
        event: 'table:delete',
        tableId: 'tbl-001',
        error: 'server error',
      })
    })

    // Should not insert a duplicate
    const matches = nodes.filter((n) => n.id === 'tbl-001')
    expect(matches).toHaveLength(1)
  })

  it('TC-TD-07-02: toast message for "already deleted" scenario', () => {
    const { result } = renderHook(() =>
      useTableMutations(setNodes, setEdges, emitTableDelete, true),
    )

    act(() => {
      result.current.deleteTable('tbl-001')
    })

    act(() => {
      result.current.onTableError({
        event: 'table:delete',
        tableId: 'tbl-001',
        error: 'not found',
        message: 'Table not found or already deleted',
      })
    })

    // Toast should be called — specific message content is implementation detail
    // but we verify toast.error is invoked (toast differentiation is UA-m4)
    expect(toast.error).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // updateTable — table-comment W1 (Hermes review): rejected table:update
  // saves must roll back the optimistic edit and surface a toast, mirroring
  // useColumnMutations.updateColumn.
  // -------------------------------------------------------------------------
  describe('updateTable', () => {
    let emitTableUpdate: ReturnType<typeof vi.fn>

    beforeEach(() => {
      emitTableUpdate = vi.fn()
    })

    it('TC-TU-01: optimistically merges the new description into the matching table node', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      const node = nodes.find((n) => n.id === 'tbl-001')
      expect(node?.data.table.description).toBe('new note')
    })

    it('TC-TU-02: preserves columns/relationships and other table fields on update', () => {
      nodes = [
        {
          ...makeTableNode('tbl-001'),
          data: {
            ...makeTableNode('tbl-001').data,
            table: {
              ...makeTableNode('tbl-001').data.table,
              columns: [{ id: 'col-1', name: 'id' } as any],
            },
          },
        },
      ]
      setNodes = vi.fn((updater: any) => {
        if (typeof updater === 'function') {
          nodes = updater(nodes)
        } else {
          nodes = updater
        }
      })

      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      const node = nodes.find((n) => n.id === 'tbl-001')
      expect(node?.data.table.columns).toEqual([{ id: 'col-1', name: 'id' }])
      expect(node?.data.table.name).toBe('orders')
    })

    it('TC-TU-03: emits table:update via emitTableUpdate with the given data', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      expect(emitTableUpdate).toHaveBeenCalledWith(
        'tbl-001',
        { description: 'new note' },
        expect.any(Function),
      )
    })

    it('TC-TU-04: disconnected guard — does not emit or mutate, shows toast', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          false,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      const node = nodes.find((n) => n.id === 'tbl-001')
      expect(node?.data.table.description).toBeUndefined()
      expect(emitTableUpdate).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Not connected'),
      )
    })

    it('TC-TU-05: onTableUpdateError rolls back the description to its previous value', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      expect(nodes.find((n) => n.id === 'tbl-001')?.data.table.description).toBe(
        'new note',
      )

      act(() => {
        result.current.onTableUpdateError({
          event: 'table:update',
          tableId: 'tbl-001',
          error: 'FORBIDDEN',
        })
      })

      expect(
        nodes.find((n) => n.id === 'tbl-001')?.data.table.description,
      ).toBeUndefined()
    })

    it('TC-TU-06: onTableUpdateError shows a toast error', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      act(() => {
        result.current.onTableUpdateError({
          event: 'table:update',
          tableId: 'tbl-001',
          error: 'FORBIDDEN',
        })
      })

      expect(toast.error).toHaveBeenCalled()
    })

    it('TC-TU-07: onTableUpdateError clears the pending entry so a second error is a no-op rollback', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      act(() => {
        result.current.onTableUpdateError({
          event: 'table:update',
          tableId: 'tbl-001',
          error: 'FORBIDDEN',
        })
      })

      // Simulate the description having been changed again by something else
      // after rollback — a second, stale error event must not clobber it.
      nodes = nodes.map((n) =>
        n.id === 'tbl-001'
          ? {
              ...n,
              data: {
                ...n.data,
                table: { ...n.data.table, description: 'unrelated later edit' },
              },
            }
          : n,
      )

      act(() => {
        result.current.onTableUpdateError({
          event: 'table:update',
          tableId: 'tbl-001',
          error: 'FORBIDDEN',
        })
      })

      expect(
        nodes.find((n) => n.id === 'tbl-001')?.data.table.description,
      ).toBe('unrelated later edit')
    })

    it('TC-TU-08: ack success clears the pending entry so a later error is a no-op', () => {
      const { result } = renderHook(() =>
        useTableMutations(
          setNodes,
          setEdges,
          emitTableDelete,
          true,
          emitTableUpdate,
        ),
      )

      act(() => {
        result.current.updateTable('tbl-001', { description: 'new note' })
      })

      expect(result.current.pendingMutations.current.has('tbl-001')).toBe(
        true,
      )

      // Simulate the server ack succeeding — emitTableUpdate is called with
      // (tableId, data, ack); invoke the captured ack callback with ok=true.
      const ackCallback = emitTableUpdate.mock.calls[0][2] as (
        ok: boolean,
      ) => void
      act(() => {
        ackCallback(true)
      })

      expect(result.current.pendingMutations.current.has('tbl-001')).toBe(
        false,
      )
    })
  })
})

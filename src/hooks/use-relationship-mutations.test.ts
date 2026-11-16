// src/hooks/use-relationship-mutations.test.ts
// Suite 1: useRelationshipMutations — 9 test cases per test-plan.md

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { useRelationshipMutations } from './use-relationship-mutations'
import type { Mock } from 'vitest'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'
import { wouldDuplicateEndpointPair } from '@/lib/react-flow/relationship-endpoints'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const makeEdge = (id = 'rel-001'): RelationshipEdgeType => ({
  id,
  source: 'tbl-001',
  target: 'tbl-002',
  type: 'relationship',
  data: {
    relationship: {
      id,
      whiteboardId: 'wb-001',
      sourceTableId: 'tbl-001',
      targetTableId: 'tbl-002',
      sourceColumnId: 'col-fk',
      targetColumnId: 'col-pk',
      cardinality: 'MANY_TO_ONE',
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceColumn: {} as any,
      targetColumn: {} as any,
    },
    cardinality: 'MANY_TO_ONE',
    isHighlighted: false,
  } as any,
})

describe('useRelationshipMutations', () => {
  let setEdges: Mock
  let emitRelationshipDelete: Mock
  let edges: Array<RelationshipEdgeType>

  beforeEach(() => {
    edges = [makeEdge('rel-001')]

    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    emitRelationshipDelete = vi.fn()
    vi.clearAllMocks()
  })

  it('TC-RD-01-01: optimistic edge removal — edge is absent after deleteRelationship', () => {
    edges = [makeEdge('rel-001')]
    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    expect(edges.find((e) => e.id === 'rel-001')).toBeUndefined()
  })

  it('TC-RD-01-02: only the targeted edge is removed', () => {
    edges = [makeEdge('rel-001'), makeEdge('rel-002')]
    setEdges = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        edges = updater(edges)
      } else {
        edges = updater
      }
    })

    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    expect(edges.find((e) => e.id === 'rel-001')).toBeUndefined()
    expect(edges.find((e) => e.id === 'rel-002')).toBeTruthy()
  })

  it('TC-RD-01-03: emitRelationshipDelete is called with the correct id', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    expect(emitRelationshipDelete).toHaveBeenCalledOnce()
    expect(emitRelationshipDelete).toHaveBeenCalledWith('rel-001')
  })

  it('TC-RD-01-04: rollback on error re-inserts the deleted edge', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    expect(edges.find((e) => e.id === 'rel-001')).toBeUndefined()

    act(() => {
      result.current.onRelationshipError({
        event: 'relationship:delete',
        relationshipId: 'rel-001',
        error: 'DELETE_FAILED',
      })
    })

    expect(edges.find((e) => e.id === 'rel-001')).toBeTruthy()
  })

  it('TC-RD-01-05: rollback shows toast.error', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    act(() => {
      result.current.onRelationshipError({
        event: 'relationship:delete',
        relationshipId: 'rel-001',
        error: 'DELETE_FAILED',
      })
    })

    expect(toast.error).toHaveBeenCalledWith(expect.any(String))
    const message = (toast.error as Mock).mock.calls[0][0]
    expect(message.length).toBeGreaterThan(0)
  })

  it('TC-RD-01-06: rollback idempotency guard — no duplicate insertion when edge already exists', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    // Simulate external re-insertion before rollback fires
    edges = [makeEdge('rel-001')]

    act(() => {
      result.current.onRelationshipError({
        event: 'relationship:delete',
        relationshipId: 'rel-001',
        error: 'DELETE_FAILED',
      })
    })

    const matches = edges.filter((e) => e.id === 'rel-001')
    expect(matches).toHaveLength(1)
  })

  it('TC-RD-01-07: onRelationshipError with no matching pending mutation does not throw, still toasts', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    // No prior deleteRelationship call for this id
    expect(() => {
      act(() => {
        result.current.onRelationshipError({
          event: 'relationship:delete',
          relationshipId: 'rel-nonexistent',
        })
      })
    }).not.toThrow()

    expect(toast.error).toHaveBeenCalled()
  })

  it('TC-RD-01-08: disconnected guard — does not emit or remove edge, shows toast', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, false),
    )

    act(() => {
      result.current.deleteRelationship('rel-001')
    })

    expect(emitRelationshipDelete).not.toHaveBeenCalled()
    // Edge should still be present
    expect(edges.find((e) => e.id === 'rel-001')).toBeTruthy()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Not connected'),
    )
  })

  it('TC-RD-01-09: onRelationshipError without relationshipId still toasts and does not throw', () => {
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, emitRelationshipDelete, true),
    )

    expect(() => {
      act(() => {
        result.current.onRelationshipError({
          event: 'relationship:delete',
          error: 'DELETE_FAILED',
          // no relationshipId
        })
      })
    }).not.toThrow()

    expect(toast.error).toHaveBeenCalled()
  })
})

describe('useRelationshipMutations — reconnectRelationship', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const buildHarness = () => {
    let edges = [makeEdge('rel-001')]
    const setEdges = vi.fn((updater: any) => {
      edges = typeof updater === 'function' ? updater(edges) : updater
    })
    const emitUpdate = vi.fn()
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, vi.fn(), true, emitUpdate),
    )
    return { result, emitUpdate, getEdges: () => edges }
  }

  it('applies endpoints optimistically and emits only the changed fields', () => {
    const { result, emitUpdate, getEdges } = buildHarness()
    act(() => {
      result.current.reconnectRelationship('rel-001', {
        targetTableId: 'tbl-003',
        targetColumnId: 'col-x',
      })
    })
    expect(getEdges()[0].target).toBe('tbl-003')
    expect(emitUpdate).toHaveBeenCalledWith(
      'rel-001',
      { targetTableId: 'tbl-003', targetColumnId: 'col-x' },
      expect.any(Function),
    )
  })

  it('an ack ok:false rolls back only the endpoint fields and keeps a newer label', () => {
    let ack: ((res: any) => void) | undefined
    let edges = [makeEdge('rel-001')]
    const setEdges = vi.fn((updater: any) => {
      edges = typeof updater === 'function' ? updater(edges) : updater
    })
    const emitUpdate = vi.fn((_id, _patch, cb) => {
      ack = cb
    })
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, vi.fn(), true, emitUpdate),
    )
    const before = edges[0]
    act(() => {
      result.current.reconnectRelationship('rel-001', {
        targetTableId: 'tbl-003',
        targetColumnId: 'col-x',
      })
    })
    expect(edges[0].target).toBe('tbl-003')

    // A peer relabels the line while the reconnect is in flight.
    edges = edges.map((e) => ({ ...e, data: { ...e.data!, label: 'newer' } }))

    act(() => ack!({ ok: false, code: 'VALIDATION_ERROR' }))

    expect(edges[0].target).toBe(before.target)
    expect(edges[0].targetHandle).toBe(
      before.targetHandle ?? edges[0].targetHandle,
    )
    expect(edges[0].data!.relationship.targetTableId).toBe('tbl-002')
    expect(edges[0].data!.relationship.targetColumnId).toBe('col-pk')
    expect(edges[0].data!.relationship.sourceTableId).toBe('tbl-001')
    expect(edges[0].data!.label).toBe('newer')
    expect(toast.error).toHaveBeenLastCalledWith(
      'Failed to move the relationship end. Please try again.',
    )
  })

  it('an ack ok:true keeps the new endpoints and shows no toast', () => {
    let ack: ((res: any) => void) | undefined
    let edges = [makeEdge('rel-001')]
    const setEdges = vi.fn((updater: any) => {
      edges = typeof updater === 'function' ? updater(edges) : updater
    })
    const { result } = renderHook(() =>
      useRelationshipMutations(
        setEdges,
        vi.fn(),
        true,
        vi.fn((_id, _patch, cb) => {
          ack = cb
        }),
      ),
    )
    act(() => {
      result.current.reconnectRelationship('rel-001', { targetColumnId: 'c' })
    })
    act(() => ack!({ ok: true }))
    expect(edges[0].data!.relationship.targetColumnId).toBe('c')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a failed label edit rolls back the label and toasts the label error', () => {
    let ack: ((res: any) => void) | undefined
    let edges = [makeEdge('rel-001')]
    edges[0] = { ...edges[0], data: { ...edges[0].data!, label: 'old' } }
    const setEdges = vi.fn((updater: any) => {
      edges = typeof updater === 'function' ? updater(edges) : updater
    })
    const { result } = renderHook(() =>
      useRelationshipMutations(
        setEdges,
        vi.fn(),
        true,
        vi.fn((_id, _patch, cb) => {
          ack = cb
        }),
      ),
    )
    act(() => {
      result.current.updateRelationshipLabel('rel-001', 'new')
    })
    expect(edges[0].data!.label).toBe('new')
    act(() => ack!({ ok: false }))
    expect(edges[0].data!.label).toBe('old')
    expect(toast.error).toHaveBeenLastCalledWith(
      'Failed to update relationship label. Please try again.',
    )
  })

  it('refuses and emits nothing when offline', () => {
    const setEdges = vi.fn()
    const emitUpdate = vi.fn()
    const { result } = renderHook(() =>
      useRelationshipMutations(setEdges, vi.fn(), false, emitUpdate),
    )
    act(() => {
      result.current.reconnectRelationship('rel-001', { targetColumnId: 'c' })
    })
    expect(setEdges).not.toHaveBeenCalled()
    expect(emitUpdate).not.toHaveBeenCalled()
  })
})

describe('wouldDuplicateEndpointPair', () => {
  const other = makeEdge('rel-002')
  other.data!.relationship = {
    ...other.data!.relationship,
    sourceColumnId: 'col-fk2',
    targetColumnId: 'col-pk2',
  }

  it('is true when the merged pair equals another relationship', () => {
    const mine = makeEdge('rel-001')
    expect(
      wouldDuplicateEndpointPair([mine, other], mine, {
        sourceColumnId: 'col-fk2',
        targetColumnId: 'col-pk2',
      }),
    ).toBe(true)
  })

  it('is false for a free pair and ignores the edge itself', () => {
    const mine = makeEdge('rel-001')
    expect(
      wouldDuplicateEndpointPair([mine, other], mine, { targetColumnId: 'z' }),
    ).toBe(false)
    expect(wouldDuplicateEndpointPair([mine, other], mine, {})).toBe(false)
  })
})

// src/hooks/use-relationship-mutations.test.ts
// Suite 1: useRelationshipMutations — 9 test cases per test-plan.md

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { useRelationshipMutations } from './use-relationship-mutations'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'

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
  let setEdges: ReturnType<typeof vi.fn>
  let emitRelationshipDelete: ReturnType<typeof vi.fn>
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
    const message = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
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

// src/hooks/use-whiteboard-collaboration.test.ts
// TS-TD-05: useWhiteboardCollaboration extension unit tests
// TC-TD-07-06: cross-hook error isolation (column errors ignored)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWhiteboardCollaboration } from './use-whiteboard-collaboration'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
}))

vi.mock('@/components/auth/AuthContext', () => ({
  useAuthContext: () => ({
    sessionExpired: false,
    triggerSessionExpired: vi.fn(),
    dismissSessionExpired: vi.fn(),
  }),
}))

// Mock useCollaboration so we control on/off/emit
const mockOn = vi.fn()
const mockOff = vi.fn()
const mockEmit = vi.fn()

vi.mock('./use-collaboration', () => ({
  useCollaboration: () => ({
    emit: mockEmit,
    on: mockOn,
    off: mockOff,
    connectionState: 'connected',
    socket: null,
    sessionId: null,
    activeUsers: [],
    requestSync: vi.fn(),
  }),
}))

describe('useWhiteboardCollaboration — table deletion extension', () => {
  const whiteboardId = 'wb-001'
  const userId = 'user-current'

  let onPositionUpdate: ReturnType<typeof vi.fn>
  let onTableDeleted: ReturnType<typeof vi.fn>
  let onTableError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onPositionUpdate = vi.fn()
    onTableDeleted = vi.fn()
    onTableError = vi.fn()
    vi.clearAllMocks()
  })

  it('TC-TD-05-01: registers table:deleted listener on mount', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    const registeredEvents = mockOn.mock.calls.map(([event]) => event)
    expect(registeredEvents).toContain('table:deleted')
  })

  it('TC-TD-05-02: table:deleted from another user triggers onTableDeleted callback', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    const deletedCall = mockOn.mock.calls.find(
      ([event]) => event === 'table:deleted',
    )
    const handler = deletedCall?.[1]
    expect(handler).toBeDefined()

    act(() => {
      handler({ tableId: 'tbl-001', deletedBy: 'user-other' })
    })

    expect(onTableDeleted).toHaveBeenCalledWith('tbl-001')
  })

  it('TC-TD-05-03: table:deleted from current user is ignored (no double-apply)', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    const deletedCall = mockOn.mock.calls.find(
      ([event]) => event === 'table:deleted',
    )
    const handler = deletedCall?.[1]

    act(() => {
      handler({ tableId: 'tbl-001', deletedBy: userId }) // same user
    })

    expect(onTableDeleted).not.toHaveBeenCalled()
  })

  it('TC-TD-05-04: emitTableDelete calls emit with correct payload', () => {
    const { result } = renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    act(() => {
      result.current.emitTableDelete('tbl-001')
    })

    expect(mockEmit).toHaveBeenCalledWith('table:delete', {
      tableId: 'tbl-001',
    })
  })

  it('TC-TD-05-05: error event with event="table:delete" triggers onTableError callback', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error')
    const handler = errorCall?.[1]
    expect(handler).toBeDefined()

    const errorPayload = {
      event: 'table:delete',
      error: 'Not found',
      message: 'Table not found',
      tableId: 'tbl-001',
    }

    act(() => {
      handler(errorPayload)
    })

    expect(onTableError).toHaveBeenCalledWith(errorPayload)
  })

  it('TC-TD-05-06 / TC-TD-07-06: error event for non-table event does NOT trigger onTableError', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error')
    const handler = errorCall?.[1]

    act(() => {
      handler({
        event: 'column:delete',
        error: 'some error',
        message: 'Column deletion failed',
        tableId: 'tbl-001',
      })
    })

    expect(onTableError).not.toHaveBeenCalled()
  })

  it('TC-TD-05-07: removes all listeners on unmount', () => {
    const { unmount } = renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        onTableDeleted,
        onTableError,
      ),
    )

    unmount()

    const removedEvents = mockOff.mock.calls.map(([event]) => event)
    expect(removedEvents).toContain('table:deleted')
    expect(removedEvents).toContain('error')
  })
})

describe('useWhiteboardCollaboration — relationship events', () => {
  const whiteboardId = 'wb-001'
  const userId = 'user-current'

  let onPositionUpdate: ReturnType<typeof vi.fn>
  let onRelationshipDeleted: ReturnType<typeof vi.fn>
  let onRelationshipError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onPositionUpdate = vi.fn()
    onRelationshipDeleted = vi.fn()
    onRelationshipError = vi.fn()
    vi.clearAllMocks()
  })

  it('TC-RD-03-01: registers relationship:deleted listener on mount', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    const registeredEvents = mockOn.mock.calls.map(([event]) => event)
    expect(registeredEvents).toContain('relationship:deleted')
  })

  it('TC-RD-03-02: relationship:deleted from another user triggers onRelationshipDeleted', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    const deletedCall = mockOn.mock.calls.find(
      ([event]) => event === 'relationship:deleted',
    )
    const handler = deletedCall?.[1]
    expect(handler).toBeDefined()

    act(() => {
      handler({ relationshipId: 'rel-001', deletedBy: 'user-other' })
    })

    expect(onRelationshipDeleted).toHaveBeenCalledWith('rel-001')
  })

  it('TC-RD-03-03: relationship:deleted from current user is ignored (no double-apply)', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    const deletedCall = mockOn.mock.calls.find(
      ([event]) => event === 'relationship:deleted',
    )
    const handler = deletedCall?.[1]

    act(() => {
      handler({ relationshipId: 'rel-001', deletedBy: userId }) // same user
    })

    expect(onRelationshipDeleted).not.toHaveBeenCalled()
  })

  it('TC-RD-03-05: emitRelationshipDelete emits correct WebSocket payload', () => {
    const { result } = renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    act(() => {
      result.current.emitRelationshipDelete('rel-001')
    })

    expect(mockEmit).toHaveBeenCalledWith('relationship:delete', {
      relationshipId: 'rel-001',
    })
  })

  it('TC-RD-03-06: error event with event="relationship:delete" triggers onRelationshipError', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    // There may be multiple 'error' handlers registered (table + relationship)
    const errorCalls = mockOn.mock.calls.filter(([event]) => event === 'error')
    // Find the relationship error handler — it's the one registered by onRelationshipError effect
    // We call all error handlers and verify the relationship one fires
    const errorPayload = {
      event: 'relationship:delete',
      error: 'DELETE_FAILED',
      message: 'Failed',
      relationshipId: 'rel-001',
    }

    act(() => {
      for (const call of errorCalls) {
        call[1](errorPayload)
      }
    })

    expect(onRelationshipError).toHaveBeenCalledWith(errorPayload)
  })

  it('TC-RD-03-07: error event for unrelated event type does NOT trigger onRelationshipError', () => {
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    const errorCalls = mockOn.mock.calls.filter(([event]) => event === 'error')

    act(() => {
      for (const call of errorCalls) {
        call[1]({
          event: 'table:delete',
          error: 'DELETE_FAILED',
          tableId: 'tbl-001',
        })
      }
    })

    expect(onRelationshipError).not.toHaveBeenCalled()
  })

  it('TC-RD-03-08: relationship:deleted listener is cleaned up on unmount', () => {
    const { unmount } = renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined,
        undefined,
        onRelationshipDeleted,
        onRelationshipError,
      ),
    )

    unmount()

    const removedEvents = mockOff.mock.calls.map(([event]) => event)
    expect(removedEvents).toContain('relationship:deleted')
  })
})

describe('useWhiteboardCollaboration — table creation sync (GH #125)', () => {
  const whiteboardId = 'wb-001'
  const userId = 'user-current'

  let onPositionUpdate: ReturnType<typeof vi.fn>
  let onTableCreated: ReturnType<typeof vi.fn>

  // onTableCreated is the 13th positional param — pad the unused slots with
  // undefined to reach it, matching this file's existing convention (see the
  // relationship-events describe block above).
  const renderWithOnTableCreated = () =>
    renderHook(() =>
      useWhiteboardCollaboration(
        whiteboardId,
        userId,
        onPositionUpdate,
        undefined, // onTableDeleted
        undefined, // onTableError
        undefined, // onRelationshipDeleted
        undefined, // onRelationshipError
        undefined, // onRelationshipUpdated
        undefined, // onBulkPositionUpdate
        true, // enabled
        undefined, // onTableUpdated
        undefined, // onTableUpdateError
        onTableCreated,
      ),
    )

  beforeEach(() => {
    onPositionUpdate = vi.fn()
    onTableCreated = vi.fn()
    vi.clearAllMocks()
  })

  it('TC-TC-125-01: registers table:created listener on mount', () => {
    renderWithOnTableCreated()

    const registeredEvents = mockOn.mock.calls.map(([event]) => event)
    expect(registeredEvents).toContain('table:created')
  })

  it('TC-TC-125-02: table:created from another user triggers onTableCreated with the full payload', () => {
    renderWithOnTableCreated()

    const createdCall = mockOn.mock.calls.find(
      ([event]) => event === 'table:created',
    )
    const handler = createdCall?.[1]
    expect(handler).toBeDefined()

    const payload = {
      id: 'tbl-new',
      whiteboardId,
      name: 'widgets',
      description: null,
      positionX: 100,
      positionY: 200,
      width: 240,
      height: 160,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'user-other',
    }

    act(() => {
      handler(payload)
    })

    expect(onTableCreated).toHaveBeenCalledWith(payload)
  })

  it('TC-TC-125-03: table:created from current user is ignored (no double-apply)', () => {
    renderWithOnTableCreated()

    const createdCall = mockOn.mock.calls.find(
      ([event]) => event === 'table:created',
    )
    const handler = createdCall?.[1]

    act(() => {
      handler({
        id: 'tbl-new',
        whiteboardId,
        name: 'widgets',
        description: null,
        positionX: 100,
        positionY: 200,
        width: 240,
        height: 160,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId, // same user — already applied optimistically
      })
    })

    expect(onTableCreated).not.toHaveBeenCalled()
  })

  it('TC-TC-125-04: removes the table:created listener on unmount', () => {
    const { unmount } = renderWithOnTableCreated()

    unmount()

    const removedEvents = mockOff.mock.calls.map(([event]) => event)
    expect(removedEvents).toContain('table:created')
  })
})

// src/hooks/use-column-collaboration.test.ts
// TS-08: useColumnCollaboration unit tests

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useColumnCollaboration } from './use-column-collaboration'

// Mock useCollaboration so we control on/off/emit/connectionState
const mockOn = vi.fn()
const mockOff = vi.fn()
const mockEmit = vi.fn()

let mockConnectionState = 'connected'

vi.mock('./use-collaboration', () => ({
  useCollaboration: () => ({
    emit: mockEmit,
    on: mockOn,
    off: mockOff,
    connectionState: mockConnectionState,
    socket: null,
    sessionId: null,
    activeUsers: [],
    requestSync: vi.fn(),
  }),
}))

describe('useColumnCollaboration', () => {
  const userId = 'user-current'
  const whiteboardId = 'wb-001'

  let callbacks: {
    onColumnCreated: ReturnType<typeof vi.fn>
    onColumnUpdated: ReturnType<typeof vi.fn>
    onColumnDeleted: ReturnType<typeof vi.fn>
    onColumnError: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockConnectionState = 'connected'
    callbacks = {
      onColumnCreated: vi.fn(),
      onColumnUpdated: vi.fn(),
      onColumnDeleted: vi.fn(),
      onColumnError: vi.fn(),
    }
    vi.clearAllMocks()
  })

  it('TC-08-01: registers column:created listener on mount', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))
    const registeredEvents = mockOn.mock.calls.map(([event]) => event)
    expect(registeredEvents).toContain('column:created')
  })

  it('TC-08-02: registers column:updated and column:deleted listeners on mount', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))
    const registeredEvents = mockOn.mock.calls.map(([event]) => event)
    expect(registeredEvents).toContain('column:updated')
    expect(registeredEvents).toContain('column:deleted')
  })

  it('TC-08-03: removes all listeners on unmount', () => {
    const { unmount } = renderHook(() =>
      useColumnCollaboration(whiteboardId, userId, callbacks),
    )
    unmount()
    // off should have been called for each registered event
    const removedEvents = mockOff.mock.calls.map(([event]) => event)
    expect(removedEvents).toContain('column:created')
    expect(removedEvents).toContain('column:updated')
    expect(removedEvents).toContain('column:deleted')
    expect(removedEvents).toContain('error')
  })

  it('TC-08-04: column:created from another user triggers onColumnCreated callback', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))

    // Find the column:created handler registered via `on`
    const createdCall = mockOn.mock.calls.find(
      ([event]) => event === 'column:created',
    )
    const handler = createdCall?.[1]
    expect(handler).toBeDefined()

    // Simulate event from a different user
    act(() => {
      handler({
        id: 'col-new',
        tableId: 'tbl-001',
        name: 'new_col',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: true,
        isUnique: false,
        description: null,
        order: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user-other', // different user
      })
    })

    expect(callbacks.onColumnCreated).toHaveBeenCalled()
  })

  it('TC-08-05: column:created from current user is ignored', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))

    const createdCall = mockOn.mock.calls.find(
      ([event]) => event === 'column:created',
    )
    const handler = createdCall?.[1]

    // Simulate event from the current user
    act(() => {
      handler({
        id: 'col-new',
        tableId: 'tbl-001',
        name: 'my_col',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: true,
        isUnique: false,
        description: null,
        order: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId, // SAME as current user
      })
    })

    expect(callbacks.onColumnCreated).not.toHaveBeenCalled()
  })

  it('TC-08-06: column:deleted event from another user triggers onColumnDeleted callback', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))

    const deletedCall = mockOn.mock.calls.find(
      ([event]) => event === 'column:deleted',
    )
    const handler = deletedCall?.[1]

    act(() => {
      handler({
        columnId: 'col-001',
        tableId: 'tbl-001',
        deletedBy: 'user-other',
      })
    })

    expect(callbacks.onColumnDeleted).toHaveBeenCalledWith({
      columnId: 'col-001',
      tableId: 'tbl-001',
      deletedBy: 'user-other',
    })
  })

  it('TC-08-07: error event for column operation triggers onColumnError callback', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error')
    const handler = errorCall?.[1]

    act(() => {
      handler({
        event: 'column:create',
        error: 'Unique constraint failed',
        message: 'Column already exists',
        tableId: 'tbl-001',
      })
    })

    expect(callbacks.onColumnError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'column:create',
        error: 'Unique constraint failed',
      }),
    )
  })

  it('TC-08-07b: non-column error event does NOT trigger onColumnError', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error')
    const handler = errorCall?.[1]

    act(() => {
      handler({
        event: 'table:create',
        error: 'some error',
        message: 'Table creation failed',
      })
    })

    expect(callbacks.onColumnError).not.toHaveBeenCalled()
  })

  it('TC-08-08: isConnected reflects the underlying connection state', () => {
    mockConnectionState = 'connected'
    const { result: r1 } = renderHook(() =>
      useColumnCollaboration(whiteboardId, userId, callbacks),
    )
    expect(r1.current.isConnected).toBe(true)
    expect(r1.current.connectionState).toBe('connected')
  })

  it('TC-08-08b: isConnected is false when connectionState is "disconnected"', () => {
    mockConnectionState = 'disconnected'
    const { result } = renderHook(() =>
      useColumnCollaboration(whiteboardId, userId, callbacks),
    )
    expect(result.current.isConnected).toBe(false)
  })

  // TC-TD-07-05: SA-M1 error filter cross-check
  // useColumnCollaboration must NOT process table:delete errors
  it('TC-TD-07-05: error event with event="table:delete" does NOT trigger onColumnError', () => {
    renderHook(() => useColumnCollaboration(whiteboardId, userId, callbacks))

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error')
    const handler = errorCall?.[1]
    expect(handler).toBeDefined()

    act(() => {
      handler({
        event: 'table:delete',
        error: 'Table not found',
        message: 'Table deletion failed',
        tableId: 'tbl-001',
      })
    })

    expect(callbacks.onColumnError).not.toHaveBeenCalled()
  })
})

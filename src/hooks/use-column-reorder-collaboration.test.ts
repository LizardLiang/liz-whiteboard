// src/hooks/use-column-reorder-collaboration.test.ts
// Suite S7: useColumnReorderCollaboration (INT-21 through INT-26)

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useColumnReorderCollaboration } from './use-column-reorder-collaboration'

// Mock the useCollaboration hook
const mockEmit = vi.fn()
const mockOn = vi.fn()
const mockOff = vi.fn()

vi.mock('./use-collaboration', () => ({
  useCollaboration: vi.fn(() => ({
    emit: mockEmit,
    on: mockOn,
    off: mockOff,
    connectionState: 'connected',
    sessionId: null,
    activeUsers: [],
    socket: null,
    requestSync: vi.fn(),
  })),
}))

const WHITEBOARD_ID = 'wb-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ID = 'user-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TABLE_ID = 'tbl-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

describe('useColumnReorderCollaboration (Suite S7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeCallbacks = () => {
    const mutations = {
      isLocalDragging: vi.fn().mockReturnValue(false),
      bufferRemoteReorder: vi.fn(),
      onColumnReorderedFromOther: vi.fn(),
      onColumnReorderAck: vi.fn(),
      onColumnReorderError: vi.fn(),
      isQueueFullForTable: vi.fn().mockReturnValue(false),
      setLocalDragging: vi.fn(),
      reconcileAfterDrop: vi.fn(),
      seedConfirmedOrderFromServer: vi.fn(),
      onSyncReconcile: vi.fn(),
    }
    const setNodes = vi.fn()
    const bumpReorderTick = vi.fn()
    return { mutations, setNodes, bumpReorderTick }
  }

  it('INT-21: incoming column:reordered while local drag is active — buffered', () => {
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()
    mutations.isLocalDragging.mockReturnValue(true)

    renderHook(() =>
      useColumnReorderCollaboration(WHITEBOARD_ID, USER_ID, {
        setNodes,
        bumpReorderTick,
        mutations,
      }),
    )

    // Find the column:reordered handler
    const reorderedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'column:reordered',
    )?.[1]

    expect(reorderedHandler).toBeDefined()

    // Simulate column:reordered event
    act(() => {
      reorderedHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-E', 'col-D', 'col-C'],
        reorderedBy: 'other-user',
      })
    })

    expect(mutations.bufferRemoteReorder).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      orderedColumnIds: ['col-E', 'col-D', 'col-C'],
      reorderedBy: 'other-user',
    })
    expect(mutations.onColumnReorderedFromOther).not.toHaveBeenCalled()
  })

  it('INT-22: incoming column:reordered while NOT dragging — applied directly', () => {
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()
    mutations.isLocalDragging.mockReturnValue(false)

    renderHook(() =>
      useColumnReorderCollaboration(WHITEBOARD_ID, USER_ID, {
        setNodes,
        bumpReorderTick,
        mutations,
      }),
    )

    const reorderedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'column:reordered',
    )?.[1]

    act(() => {
      reorderedHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-E', 'col-D', 'col-C'],
        reorderedBy: 'other-user',
      })
    })

    expect(mutations.onColumnReorderedFromOther).toHaveBeenCalledWith(
      TABLE_ID,
      ['col-E', 'col-D', 'col-C'],
      setNodes,
    )
    expect(bumpReorderTick).toHaveBeenCalledWith(TABLE_ID)
    expect(mutations.bufferRemoteReorder).not.toHaveBeenCalled()
  })

  it('INT-23: column:reorder:ack routed to onColumnReorderAck', () => {
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()

    renderHook(() =>
      useColumnReorderCollaboration(WHITEBOARD_ID, USER_ID, {
        setNodes,
        bumpReorderTick,
        mutations,
      }),
    )

    const ackHandler = mockOn.mock.calls.find(
      ([event]) => event === 'column:reorder:ack',
    )?.[1]

    act(() => {
      ackHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-A', 'col-B', 'col-C'],
      })
    })

    expect(mutations.onColumnReorderAck).toHaveBeenCalledWith(
      TABLE_ID,
      ['col-A', 'col-B', 'col-C'],
      setNodes,
      bumpReorderTick,
    )
  })

  it('INT-24: error event column:reorder routed to onColumnReorderError', () => {
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()

    renderHook(() =>
      useColumnReorderCollaboration(WHITEBOARD_ID, USER_ID, {
        setNodes,
        bumpReorderTick,
        mutations,
      }),
    )

    const errorHandler = mockOn.mock.calls.find(
      ([event]) => event === 'error',
    )?.[1]

    act(() => {
      errorHandler({
        event: 'column:reorder',
        error: 'VALIDATION_FAILED',
        message: 'Bad input',
        tableId: TABLE_ID,
      })
    })

    expect(mutations.onColumnReorderError).toHaveBeenCalledWith(
      TABLE_ID,
      'VALIDATION_FAILED',
      setNodes,
    )
  })

  it('INT-24: non-column:reorder errors are ignored', () => {
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()

    renderHook(() =>
      useColumnReorderCollaboration(WHITEBOARD_ID, USER_ID, {
        setNodes,
        bumpReorderTick,
        mutations,
      }),
    )

    const errorHandler = mockOn.mock.calls.find(
      ([event]) => event === 'error',
    )?.[1]

    act(() => {
      errorHandler({
        event: 'column:update',
        error: 'UPDATE_FAILED',
        message: 'Other error',
      })
    })

    expect(mutations.onColumnReorderError).not.toHaveBeenCalled()
  })

  it('INT-22-ext: reorderedBy field absent — does not crash (graceful degrade)', () => {
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()
    mutations.isLocalDragging.mockReturnValue(true)

    renderHook(() =>
      useColumnReorderCollaboration(WHITEBOARD_ID, USER_ID, {
        setNodes,
        bumpReorderTick,
        mutations,
      }),
    )

    const reorderedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'column:reordered',
    )?.[1]

    // No crash when reorderedBy is missing
    expect(() => {
      act(() => {
        reorderedHandler({
          tableId: TABLE_ID,
          orderedColumnIds: ['col-A'],
          // reorderedBy intentionally absent
        })
      })
    }).not.toThrow()

    expect(mutations.bufferRemoteReorder).toHaveBeenCalledWith(
      expect.objectContaining({ reorderedBy: undefined }),
    )
  })
})

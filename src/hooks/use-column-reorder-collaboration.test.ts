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

  // ============================================================================
  // INT-25/INT-26: ack vs broadcast ordering at queue depth ≥ 2 (SA-M2, AC-07d)
  //
  // These tests verify that the collaboration hook correctly routes events to the
  // mutations layer and that the mutations layer (useColumnReorderMutations)
  // maintains correct ordering semantics when multiple reorders are in-flight.
  //
  // The hook itself routes: ack → onColumnReorderAck, broadcast → buffer/apply.
  // The ordering guarantee (SA-H3) lives in onColumnReorderAck (defers applyServerOrder
  // until queue is empty). These tests verify the hook routes correctly so the
  // mutations hook can enforce the ordering contract.
  // ============================================================================

  it('INT-25: ack vs broadcast — forward order at queue depth 2 (ack#1 then broadcast#2)', () => {
    // At queue depth 2: ack(#1) arrives first, then broadcast(#2).
    // The hook should route ack(#1) to onColumnReorderAck and broadcast(#2) to
    // onColumnReorderedFromOther (since we're not locally dragging for the broadcast).
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()

    // Not locally dragging when broadcast arrives (reorder already dropped)
    mutations.isLocalDragging.mockReturnValue(false)

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
    const reorderedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'column:reordered',
    )?.[1]

    expect(ackHandler).toBeDefined()
    expect(reorderedHandler).toBeDefined()

    // Simulate ack for reorder #1 arriving first
    act(() => {
      ackHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-B', 'col-A', 'col-C'],
      })
    })

    // Verify ack routed to onColumnReorderAck (queue pop happens in mutations)
    expect(mutations.onColumnReorderAck).toHaveBeenCalledTimes(1)
    expect(mutations.onColumnReorderAck).toHaveBeenCalledWith(
      TABLE_ID,
      ['col-B', 'col-A', 'col-C'],
      setNodes,
      bumpReorderTick,
    )

    // Then broadcast for reorder #2 arrives — not locally dragging → applied directly
    act(() => {
      reorderedHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-C', 'col-B', 'col-A'],
        reorderedBy: 'other-user',
      })
    })

    // Broadcast applied directly since not locally dragging
    expect(mutations.onColumnReorderedFromOther).toHaveBeenCalledTimes(1)
    expect(mutations.onColumnReorderedFromOther).toHaveBeenCalledWith(
      TABLE_ID,
      ['col-C', 'col-B', 'col-A'],
      setNodes,
    )

    // bufferRemoteReorder was NOT called (not dragging)
    expect(mutations.bufferRemoteReorder).not.toHaveBeenCalled()
  })

  it('INT-26: ack vs broadcast — reverse arrival order stress (broadcast#2 before ack#1)', () => {
    // Stress test: broadcast for reorder #2 arrives BEFORE ack for reorder #1.
    // The hook must still route correctly:
    //   - If locally dragging when broadcast arrives → buffer it
    //   - When ack arrives → route to onColumnReorderAck
    // End state: no snap-back, mutations receives both events correctly.
    const { mutations, setNodes, bumpReorderTick } = makeCallbacks()

    // Initially dragging (so broadcast #2 gets buffered)
    mutations.isLocalDragging.mockReturnValue(true)

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
    const reorderedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'column:reordered',
    )?.[1]

    // Broadcast for reorder #2 arrives FIRST while still dragging → buffered
    act(() => {
      reorderedHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-C', 'col-B', 'col-A'],
        reorderedBy: 'other-user',
      })
    })

    // Should be buffered (not applied directly) since isLocalDragging = true
    expect(mutations.bufferRemoteReorder).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      orderedColumnIds: ['col-C', 'col-B', 'col-A'],
      reorderedBy: 'other-user',
    })
    expect(mutations.onColumnReorderedFromOther).not.toHaveBeenCalled()

    // Now ack for reorder #1 arrives → routed to onColumnReorderAck
    act(() => {
      ackHandler({
        tableId: TABLE_ID,
        orderedColumnIds: ['col-B', 'col-A', 'col-C'],
      })
    })

    expect(mutations.onColumnReorderAck).toHaveBeenCalledTimes(1)
    expect(mutations.onColumnReorderAck).toHaveBeenCalledWith(
      TABLE_ID,
      ['col-B', 'col-A', 'col-C'],
      setNodes,
      bumpReorderTick,
    )

    // The broadcast was correctly buffered (not applied during drag) — no snap-back.
    // reconcileAfterDrop (called separately when drag ends) will flush the buffer.
    expect(mutations.bufferRemoteReorder).toHaveBeenCalledTimes(1)
    expect(mutations.onColumnReorderedFromOther).not.toHaveBeenCalled()
  })
})

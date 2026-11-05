// src/hooks/use-auto-layout-orchestrator.test.ts
// Unit tests for useAutoLayoutOrchestrator — TC-AL-O-01 through O-13

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks (order matters — must be before hook imports; vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock('@xyflow/react', () => ({
  useReactFlow: vi.fn(),
}))

vi.mock('@/lib/react-flow/edge-bundles', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>()
  return {
    ...actual,
    recalculateEdgeRouting: vi.fn(actual.recalculateEdgeRouting),
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/server-functions', () => ({
  updateTablePositionsBulk: vi.fn(),
}))

vi.mock('@/components/auth/AuthContext', () => ({
  useAuthContext: vi.fn(),
}))

// eslint-disable-next-line import/first
import { useReactFlow } from '@xyflow/react'
// eslint-disable-next-line import/first
import { toast } from 'sonner'
// eslint-disable-next-line import/first
import { updateTablePositionsBulk } from '@/lib/server-functions'
// eslint-disable-next-line import/first
import { useAuthContext } from '@/components/auth/AuthContext'
// eslint-disable-next-line import/first
import { DOCK_FIT_PADDING } from '@/lib/react-flow/fit-view-padding'
// eslint-disable-next-line import/first, import/order
import { useAutoLayoutOrchestrator } from './use-auto-layout-orchestrator'
// eslint-disable-next-line import/first, import/order
import type { Mock } from 'vitest'
// eslint-disable-next-line import/first, import/order
import { buildParentIndex, toAbsolute } from '@/lib/react-flow/node-nesting'
// eslint-disable-next-line import/first, import/order
import { reconcileAreaMembership } from '@/lib/react-flow/area-bounds'
// eslint-disable-next-line import/first, import/order
import { recalculateEdgeRouting } from '@/lib/react-flow/edge-bundles'

const mockSetNodes = vi.fn()
const mockSetEdges = vi.fn()
// Two table nodes: the orchestrator bails out when the store holds no tables.
const DEFAULT_NODES = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    type: 'table',
    position: { x: 0, y: 0 },
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    type: 'table',
    position: { x: 5, y: 5 },
  },
]
const mockGetNodes = vi.fn((): Array<any> => DEFAULT_NODES)
const mockGetEdges = vi.fn(() => [])
const mockFitView = vi.fn()
const mockTriggerSessionExpired = vi.fn()

const AUTH_ERROR_RESPONSE = {
  error: 'UNAUTHORIZED' as const,
  status: 401 as const,
}

// Default hook args
const WB_ID = '11111111-1111-1111-1111-111111111111'
const POSITIONS = [
  { id: '22222222-2222-2222-2222-222222222222', x: 100, y: 200 },
  { id: '33333333-3333-3333-3333-333333333333', x: 400, y: 200 },
]

/**
 * Wraps positions in the { positions } shape that useD3ForceLayout
 * now returns. Tests mock runD3ForceLayout with this shape.
 */
const LAYOUT_RESULT = { positions: POSITIONS }

let mockRunD3ForceLayout: Mock
let mockEmitBulkPositionUpdate: Mock

function makeHookArgs() {
  return {
    whiteboardId: WB_ID,
    runD3ForceLayout: mockRunD3ForceLayout,
    emitBulkPositionUpdate: mockEmitBulkPositionUpdate,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mockRunD3ForceLayout = vi.fn()
  mockEmitBulkPositionUpdate = vi.fn()
  ;(useReactFlow as Mock).mockReturnValue({
    setNodes: mockSetNodes,
    setEdges: mockSetEdges,
    getNodes: mockGetNodes,
    getEdges: mockGetEdges,
    fitView: mockFitView,
  })
  ;(useAuthContext as Mock).mockReturnValue({
    triggerSessionExpired: mockTriggerSessionExpired,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// TC-AL-O-01 — Success path
// ---------------------------------------------------------------------------

describe('useAutoLayoutOrchestrator', () => {
  it('TC-AL-O-01: success path — setNodes, persist, emit, fitView, toast', async () => {
    vi.useFakeTimers()
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 2,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    // setNodes called once with all new positions (optimistic apply)
    expect(mockSetNodes).toHaveBeenCalledTimes(1)

    // updateTablePositionsBulk called with correct payload
    expect(updateTablePositionsBulk).toHaveBeenCalledWith({
      data: {
        whiteboardId: WB_ID,
        positions: expect.arrayContaining([
          {
            id: POSITIONS[0].id,
            positionX: POSITIONS[0].x,
            positionY: POSITIONS[0].y,
          },
          {
            id: POSITIONS[1].id,
            positionX: POSITIONS[1].x,
            positionY: POSITIONS[1].y,
          },
        ]),
      },
    })

    // emitBulkPositionUpdate called with correct payload
    expect(mockEmitBulkPositionUpdate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          tableId: POSITIONS[0].id,
          positionX: POSITIONS[0].x,
          positionY: POSITIONS[0].y,
        },
      ]),
      [],
    )

    // success toast
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('2'))

    // fitView called after setTimeout(100)
    vi.runAllTimers()
    expect(mockFitView).toHaveBeenCalledWith({
      padding: DOCK_FIT_PADDING,
      duration: 300,
    })

    expect(result.current.isRunning).toBe(false)
  })

  // TC-AL-O-02 — Layout simulation error
  it('TC-AL-O-02: layout error — no setNodes, no persist, no emit, error toast', async () => {
    mockRunD3ForceLayout.mockResolvedValueOnce(null) // Hook returns null on error

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    expect(mockSetNodes).not.toHaveBeenCalled()
    expect(updateTablePositionsBulk).not.toHaveBeenCalled()
    expect(mockEmitBulkPositionUpdate).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
  })

  // TC-AL-O-03 — Auth error (returned as value, not thrown)
  it('TC-AL-O-03: auth error — persist-failure UX, no success toast, no fitView, no emit', async () => {
    vi.useFakeTimers()
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce(
      AUTH_ERROR_RESPONSE,
    )

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    // setNodes IS called (optimistic apply precedes the await)
    expect(mockSetNodes).toHaveBeenCalled()

    // triggerSessionExpired called
    expect(mockTriggerSessionExpired).toHaveBeenCalled()

    // No success path
    expect(toast.success).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(mockFitView).not.toHaveBeenCalled()
    expect(mockEmitBulkPositionUpdate).not.toHaveBeenCalled()

    // Error toast with Retry
    expect(toast.error).toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
  })

  // TC-AL-O-04 — Persist throws
  it('TC-AL-O-04: persist throws — persist-failure UX, no fitView, no emit', async () => {
    vi.useFakeTimers()
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockRejectedValueOnce(
      new Error('DB connection lost'),
    )

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    expect(mockSetNodes).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    vi.runAllTimers()
    expect(mockFitView).not.toHaveBeenCalled()
    expect(mockEmitBulkPositionUpdate).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
    expect(result.current.persistError).toBeTruthy()
  })

  // TC-AL-O-05 — Retry success
  it('TC-AL-O-05: retry success — re-runs the layout, persists, emits broadcast, clears error', async () => {
    vi.useFakeTimers()
    // First call fails (throw)
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock)
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ success: true, count: 2 })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    // Initial run → persist fails
    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })
    expect(result.current.persistError).toBeTruthy()

    vi.clearAllMocks()
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)

    // Retry → succeeds
    await act(async () => {
      await result.current.handleRetry()
    })

    // The layout runs again from the current board
    expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(1)
    expect(updateTablePositionsBulk).toHaveBeenCalledTimes(1)

    // emitBulkPositionUpdate called
    expect(mockEmitBulkPositionUpdate).toHaveBeenCalled()

    // persistError cleared
    expect(result.current.persistError).toBeNull()
  })

  // TC-AL-O-06 — Retry after unmount: updateTablePositionsBulk NOT called
  it('TC-AL-O-06: retry after unmount — updateTablePositionsBulk NOT called', async () => {
    // Bring to persist-failure state
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockRejectedValueOnce(
      new Error('DB error'),
    )

    const { result, unmount } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    // Unmount (simulate navigation away)
    unmount()
    vi.clearAllMocks()

    // Call handleRetry after unmount
    await act(async () => {
      await result.current.handleRetry()
    })

    // updateTablePositionsBulk must NOT be called
    expect(updateTablePositionsBulk).not.toHaveBeenCalled()
  })

  // TC-AL-O-07 — isMountedRef mid-await guard
  it('TC-AL-O-07: handleRetry after unmount does not call state setters', async () => {
    // Simpler version: bring to persist-failure state, unmount, call handleRetry
    // — the entry-point guard in handleRetry prevents any calls.
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockRejectedValueOnce(
      new Error('DB error'),
    )

    const { result, unmount } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    expect(result.current.persistError).toBeTruthy()

    // Unmount (simulate navigation away)
    unmount()
    vi.clearAllMocks()

    // Call handleRetry after unmount
    await act(async () => {
      await result.current.handleRetry()
    })

    // The isMountedRef.current === false guard fires first
    expect(updateTablePositionsBulk).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  // TC-AL-O-08 — handleAutoLayoutClick with tableCount ≤ 50: runs immediately
  it('TC-AL-O-08: tableCount ≤ 50 runs layout immediately without dialog', async () => {
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 2,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(5)
    })

    expect(result.current.showConfirmDialog).toBe(false)
    expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(1)
  })

  // TC-AL-O-09 — handleAutoLayoutClick with tableCount > 50: sets dialog without running
  it('TC-AL-O-09: tableCount > 50 shows dialog without running layout', () => {
    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    act(() => {
      result.current.handleAutoLayoutClick(51)
    })

    expect(result.current.showConfirmDialog).toBe(true)
    expect(mockRunD3ForceLayout).not.toHaveBeenCalled()
  })

  // TC-AL-O-10 — handleConfirm: hides dialog and calls runLayout
  it('TC-AL-O-10: handleConfirm hides dialog and runs layout', async () => {
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 2,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    // Open dialog
    act(() => {
      result.current.handleAutoLayoutClick(51)
    })
    expect(result.current.showConfirmDialog).toBe(true)

    // Confirm
    await act(async () => {
      await result.current.handleConfirm()
    })

    expect(result.current.showConfirmDialog).toBe(false)
    expect(mockRunD3ForceLayout).toHaveBeenCalled()
  })

  // TC-AL-O-11 — handleCancel: hides dialog without running layout
  it('TC-AL-O-11: handleCancel hides dialog without running layout', () => {
    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    act(() => {
      result.current.handleAutoLayoutClick(51)
    })
    expect(result.current.showConfirmDialog).toBe(true)

    act(() => {
      result.current.handleCancel()
    })

    expect(result.current.showConfirmDialog).toBe(false)
    expect(mockRunD3ForceLayout).not.toHaveBeenCalled()
  })

  // TC-AL-O-12 — isRunning transitions
  it('TC-AL-O-12: isRunning is false before run, and false after successful run', async () => {
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 2,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    expect(result.current.isRunning).toBe(false)

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    // After successful run
    expect(result.current.isRunning).toBe(false)
    expect(result.current.persistError).toBeNull()
  })

  // TC-AL-O-13 — Retry with auth error on second attempt
  it('TC-AL-O-13: retry with auth error — no emit, error toast shown', async () => {
    // First run: persist throws
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock)
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce(AUTH_ERROR_RESPONSE) // retry returns auth error

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    // Initial run → persist fails
    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    // Clear call counts (but keep mock implementations)
    vi.clearAllMocks()
    // Re-apply the return values that were consumed
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce(
      AUTH_ERROR_RESPONSE,
    )
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)

    // Retry → auth error
    await act(async () => {
      await result.current.handleRetry()
    })

    expect(mockEmitBulkPositionUpdate).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    // triggerSessionExpired is called from handlePersistResult which uses the
    // captured triggerSessionExpired from useAuthContext
    // (mockTriggerSessionExpired is the same function reference throughout)
    expect(mockTriggerSessionExpired).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // GH #106 subject-areas grouping bugfix — area nodes excluded from layout
  // input, and onAfterLayout re-fit hook wired into the persist success path.
  // -------------------------------------------------------------------------

  // TC-AL-O-14 — Area nodes filtered out of the runD3ForceLayout input
  it('TC-AL-O-14: area nodes are filtered out of the layout input', async () => {
    // mockReset (not just clearAllMocks from beforeEach) drops any queued
    // .mockResolvedValueOnce/.mockRejectedValueOnce left over from an earlier
    // test that pushed more once-values than it consumed (TC-AL-O-13 does
    // this) — clearAllMocks only clears call history, not the once-queue.
    ;(updateTablePositionsBulk as unknown as Mock).mockReset()

    const tableNode = { id: 'table-1', type: 'table', position: { x: 0, y: 0 } }
    const areaNode = {
      id: 'area-1',
      type: 'area',
      position: { x: 0, y: 0 },
      data: {
        area: {
          id: 'area-1',
          positionX: 0,
          positionY: 0,
          width: 200,
          height: 150,
          memberTableIds: [],
        },
      },
    }
    mockGetNodes.mockReturnValueOnce([tableNode, areaNode] as any)
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 2,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(1)
    const [nodesArg] = mockRunD3ForceLayout.mock.calls[0]
    expect(nodesArg).toEqual([tableNode])
  })

  // TC-AL-O-15 — onAfterLayout called after a successful run
  it('TC-AL-O-15: onAfterLayout is called after successful apply + persist', async () => {
    ;(updateTablePositionsBulk as unknown as Mock).mockReset()
    const mockOnAfterLayout = vi.fn()
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 2,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator({
        ...makeHookArgs(),
        onAfterLayout: mockOnAfterLayout,
      }),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })

    expect(mockOnAfterLayout).toHaveBeenCalledTimes(1)
    // area-autolayout-persistence-fix: onAfterLayout must receive the applied
    // positions (not be called with no args) — the caller uses these to
    // patch the query cache and refit areas from fresh data.
    expect(mockOnAfterLayout).toHaveBeenCalledWith(POSITIONS, [])
  })

  // TC-AL-O-16 — onAfterLayout NOT called on layout error, persist failure, or auth error
  it('TC-AL-O-16: onAfterLayout is not called when layout/persist/auth fails', async () => {
    ;(updateTablePositionsBulk as unknown as Mock).mockReset()
    const mockOnAfterLayout = vi.fn()

    // Layout error
    mockRunD3ForceLayout.mockResolvedValueOnce(null)
    const { result: r1 } = renderHook(() =>
      useAutoLayoutOrchestrator({
        ...makeHookArgs(),
        onAfterLayout: mockOnAfterLayout,
      }),
    )
    await act(async () => {
      await r1.current.handleAutoLayoutClick(2)
    })
    expect(mockOnAfterLayout).not.toHaveBeenCalled()

    // Persist throws
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockRejectedValueOnce(
      new Error('DB error'),
    )
    const { result: r2 } = renderHook(() =>
      useAutoLayoutOrchestrator({
        ...makeHookArgs(),
        onAfterLayout: mockOnAfterLayout,
      }),
    )
    await act(async () => {
      await r2.current.handleAutoLayoutClick(2)
    })
    expect(mockOnAfterLayout).not.toHaveBeenCalled()

    // Auth error
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce(
      AUTH_ERROR_RESPONSE,
    )
    const { result: r3 } = renderHook(() =>
      useAutoLayoutOrchestrator({
        ...makeHookArgs(),
        onAfterLayout: mockOnAfterLayout,
      }),
    )
    await act(async () => {
      await r3.current.handleAutoLayoutClick(2)
    })
    expect(mockOnAfterLayout).not.toHaveBeenCalled()
  })

  // TC-AL-O-17 — onAfterLayout called after a successful retry
  it('TC-AL-O-17: onAfterLayout is called after a successful retry', async () => {
    ;(updateTablePositionsBulk as unknown as Mock).mockReset()
    const mockOnAfterLayout = vi.fn()
    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    ;(updateTablePositionsBulk as unknown as Mock)
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ success: true, count: 2 })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator({
        ...makeHookArgs(),
        onAfterLayout: mockOnAfterLayout,
      }),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(2)
    })
    expect(mockOnAfterLayout).not.toHaveBeenCalled()

    mockRunD3ForceLayout.mockResolvedValueOnce(LAYOUT_RESULT)
    await act(async () => {
      await result.current.handleRetry()
    })
    expect(mockOnAfterLayout).toHaveBeenCalledTimes(1)
    expect(mockOnAfterLayout).toHaveBeenCalledWith(POSITIONS, [])
  })

  // TC-AL-O-18 — Comment-pin nodes filtered out of the layout input AND the
  // bulk-persist payload (GH #110 regression — the n.type === 'table' filter
  // must exclude 'comment' nodes just like it excludes 'area' nodes).
  it('TC-AL-O-18: comment-pin nodes are excluded from layout input and bulk persist payload', async () => {
    ;(updateTablePositionsBulk as unknown as Mock).mockReset()

    const tableNode = { id: 'table-1', type: 'table', position: { x: 0, y: 0 } }
    const areaNode = {
      id: 'area-1',
      type: 'area',
      position: { x: 0, y: 0 },
      data: {
        area: {
          id: 'area-1',
          positionX: 0,
          positionY: 0,
          width: 200,
          height: 150,
          memberTableIds: [],
        },
      },
    }
    const commentNode = {
      id: 'comment-1',
      type: 'comment',
      position: { x: 0, y: 0 },
    }
    mockGetNodes.mockReturnValueOnce([tableNode, areaNode, commentNode] as any)

    // Layout result only contains the table node's position — mirrors what
    // the real d3-force layout would produce once comment/area nodes are
    // excluded from its input.
    const tableOnlyLayoutResult = {
      positions: [{ id: 'table-1', x: 10, y: 20 }],
    }
    mockRunD3ForceLayout.mockResolvedValueOnce(tableOnlyLayoutResult)
    ;(updateTablePositionsBulk as unknown as Mock).mockResolvedValueOnce({
      success: true,
      count: 1,
    })

    const { result } = renderHook(() =>
      useAutoLayoutOrchestrator(makeHookArgs()),
    )

    await act(async () => {
      await result.current.handleAutoLayoutClick(3)
    })

    // Layout input excludes both the area node and the comment-pin node.
    expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(1)
    const [nodesArg] = mockRunD3ForceLayout.mock.calls[0]
    expect(nodesArg).toEqual([tableNode])

    // Bulk persist payload contains only the table's position — no
    // area-1 or comment-1 entry ever reaches updateTablePositionsBulk.
    expect(updateTablePositionsBulk).toHaveBeenCalledWith({
      data: {
        whiteboardId: WB_ID,
        positions: [{ id: 'table-1', positionX: 10, positionY: 20 }],
      },
    })
  })
  // Area-aware layout: areas are passed in, members are stored RELATIVE to the
  // area's NEW origin, the payload carries the bounds, and retry re-sends them.
  describe('area-aware layout', () => {
    const AREA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const MEMBER_ID = POSITIONS[0].id
    const FREE_ID = POSITIONS[1].id
    const areaNode = {
      id: AREA_ID,
      type: 'area',
      position: { x: 0, y: 0 },
      width: 200,
      height: 150,
      data: {
        area: {
          id: AREA_ID,
          positionX: 0,
          positionY: 0,
          width: 200,
          height: 150,
          memberTableIds: [MEMBER_ID],
        },
      },
    }
    const memberNode = {
      id: MEMBER_ID,
      type: 'table',
      parentId: AREA_ID,
      position: { x: 10, y: 10 },
    }
    const freeNode = { id: FREE_ID, type: 'table', position: { x: 0, y: 0 } }
    const NEW_AREA = {
      id: AREA_ID,
      positionX: 500,
      positionY: 300,
      width: 400,
      height: 260,
    }
    // Member's absolute position inside the new area rect.
    const POSITIONS_WITH_AREA = [
      { id: MEMBER_ID, x: 524, y: 344 },
      { id: FREE_ID, x: 50, y: 60 },
    ]

    // A minimal React Flow store. Like the real one (@xyflow/react 12),
    // setNodes only QUEUES its argument: the store changes at the next flush
    // (a microtask here, the next render there), so getNodes() right after a
    // setNodes() still returns the old nodes. After unmount the queue is
    // never applied. A value or an updater may be queued.
    let store: Array<any> = []
    let queue: Array<any> = []
    let rfMounted = true

    function flushQueue() {
      const pending = queue
      queue = []
      if (!rfMounted) return
      for (const next of pending)
        store = typeof next === 'function' ? next(store) : next
    }

    function arrange(times = 1) {
      store = [areaNode, memberNode, freeNode]
      queue = []
      rfMounted = true
      mockGetNodes.mockImplementation(() => store)
      mockSetNodes.mockImplementation((next: any) => {
        queue.push(next)
        queueMicrotask(flushQueue)
      })
      mockSetEdges.mockImplementation((next: any) => {
        if (typeof next === 'function') next([])
      })
      for (let i = 0; i < times; i++) {
        mockRunD3ForceLayout.mockResolvedValueOnce({
          positions: POSITIONS_WITH_AREA,
          areas: [NEW_AREA],
        })
      }
    }

    afterEach(() => {
      mockGetNodes.mockImplementation(() => DEFAULT_NODES)
      mockSetNodes.mockReset()
    })

    it('passes area inputs (with membership) to the layout', async () => {
      arrange()
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({ success: true, count: 2 })
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator(makeHookArgs()),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      const [nodesArg, , areasArg] = mockRunD3ForceLayout.mock.calls[0]
      expect(nodesArg.map((n: any) => n.id)).toEqual([MEMBER_ID, FREE_ID])
      expect(areasArg).toEqual([
        {
          id: AREA_ID,
          positionX: 0,
          positionY: 0,
          width: 200,
          height: 150,
          memberTableIds: [MEMBER_ID],
        },
      ])
    })

    it('stores members relative to the new area origin and resizes the area node', async () => {
      arrange()
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({ success: true, count: 2 })
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator(makeHookArgs()),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      const stored = mockSetNodes.mock.calls[0][0] as Array<any>
      const byId = new Map(stored.map((n) => [n.id, n]))
      expect(byId.get(MEMBER_ID).position).toEqual({ x: 24, y: 44 })
      expect(byId.get(MEMBER_ID).parentId).toBe(AREA_ID)
      expect(byId.get(FREE_ID).position).toEqual({ x: 50, y: 60 })
      const a = byId.get(AREA_ID)
      expect(a.position).toEqual({ x: 500, y: 300 })
      expect(a.width).toBe(400)
      expect(a.height).toBe(260)
      expect(a.data.area.width).toBe(400)
      expect(a.data.area.memberTableIds).toEqual([MEMBER_ID])
    })

    it('persists area bounds in the payload and hands them to onAfterLayout', async () => {
      arrange()
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({ success: true, count: 2 })
      const onAfterLayout = vi.fn()
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator({ ...makeHookArgs(), onAfterLayout }),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      const payload = (
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mock.calls[0][0].data
      expect(payload.areas).toEqual([NEW_AREA])
      expect(payload).not.toHaveProperty('memberTableIds')
      expect(onAfterLayout).toHaveBeenCalledWith(POSITIONS_WITH_AREA, [
        NEW_AREA,
      ])
    })

    it('broadcasts positions and area bounds in one emit', async () => {
      arrange()
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({ success: true, count: 2 })
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator(makeHookArgs()),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      expect(mockEmitBulkPositionUpdate).toHaveBeenCalledTimes(1)
      expect(mockEmitBulkPositionUpdate).toHaveBeenCalledWith(
        POSITIONS_WITH_AREA.map((p) => ({
          tableId: p.id,
          positionX: p.x,
          positionY: p.y,
        })),
        [NEW_AREA],
      )
    })

    it('retry re-runs the layout and sends the area bounds again', async () => {
      arrange(2)
      const mockBulk = updateTablePositionsBulk as unknown as ReturnType<
        typeof vi.fn
      >
      mockBulk.mockRejectedValueOnce(new Error('network'))
      mockBulk.mockResolvedValueOnce({ success: true, count: 2 })
      const onAfterLayout = vi.fn()
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator({ ...makeHookArgs(), onAfterLayout }),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      await act(async () => {
        await result.current.handleRetry()
      })
      expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(2)
      expect(mockBulk).toHaveBeenCalledTimes(2)
      expect(mockBulk.mock.calls[1][0].data.areas).toEqual([NEW_AREA])
      expect(onAfterLayout).toHaveBeenCalledWith(expect.any(Array), [NEW_AREA])
    })

    const OLD_AREA = {
      id: AREA_ID,
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 150,
    }

    it('persist throws: store nodes and area bounds are restored', async () => {
      arrange()
      const original = [areaNode, memberNode, freeNode]
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('network'))
      const onAreaBoundsChange = vi.fn()
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator({ ...makeHookArgs(), onAreaBoundsChange }),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      expect(mockSetNodes).toHaveBeenCalledTimes(2)
      expect(store).toEqual(original)
      expect(mockSetEdges).toHaveBeenCalledTimes(2)
      expect(onAreaBoundsChange).toHaveBeenNthCalledWith(1, [NEW_AREA])
      expect(onAreaBoundsChange).toHaveBeenNthCalledWith(2, [OLD_AREA])
    })

    it('auth error: store nodes and area bounds are restored', async () => {
      arrange()
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(AUTH_ERROR_RESPONSE)
      const onAreaBoundsChange = vi.fn()
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator({ ...makeHookArgs(), onAreaBoundsChange }),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      expect(mockSetNodes).toHaveBeenCalledTimes(2)
      expect(store).toEqual([areaNode, memberNode, freeNode])
      expect(onAreaBoundsChange).toHaveBeenLastCalledWith([OLD_AREA])
    })

    it('retry success applies the store nodes and area bounds again', async () => {
      arrange(2)
      const mockBulk = updateTablePositionsBulk as unknown as ReturnType<
        typeof vi.fn
      >
      mockBulk.mockRejectedValueOnce(new Error('network'))
      mockBulk.mockResolvedValueOnce({ success: true, count: 2 })
      const onAreaBoundsChange = vi.fn()
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator({ ...makeHookArgs(), onAreaBoundsChange }),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      await act(async () => {
        await result.current.handleRetry()
      })
      expect(mockSetNodes).toHaveBeenCalledTimes(3)
      expect(mockSetNodes.mock.calls[2][0]).toEqual(
        mockSetNodes.mock.calls[0][0],
      )
      expect(onAreaBoundsChange).toHaveBeenLastCalledWith([NEW_AREA])
    })

    it('a failed retry rolls its own apply back too', async () => {
      arrange(2)
      const mockBulk = updateTablePositionsBulk as unknown as ReturnType<
        typeof vi.fn
      >
      mockBulk.mockRejectedValueOnce(new Error('network'))
      mockBulk.mockResolvedValueOnce(AUTH_ERROR_RESPONSE)
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator(makeHookArgs()),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      await act(async () => {
        await result.current.handleRetry()
      })
      expect(mockSetNodes).toHaveBeenCalledTimes(4)
      expect(store).toEqual([areaNode, memberNode, freeNode])
    })

    it('a 1px member drag after a failed layout keeps the member in its area', async () => {
      arrange()
      ;(
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('network'))
      const onAreaBoundsChange = vi.fn()
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator({ ...makeHookArgs(), onAreaBoundsChange }),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      // What the canvas holds after the failure: the restored store nodes and
      // the `areas` state last written through onAreaBoundsChange.
      const stored = store
      const storedArea = stored.find((n) => n.id === AREA_ID)
      const storedMember = stored.find((n) => n.id === MEMBER_ID)
      const bounds = onAreaBoundsChange.mock.calls.at(-1)![0][0]
      const areaState = {
        ...bounds,
        memberTableIds: storedArea.data.area.memberTableIds,
      }
      expect(storedArea.position).toEqual({
        x: areaState.positionX,
        y: areaState.positionY,
      })
      const parent = buildParentIndex([areaState]).get(MEMBER_ID)
      const abs = toAbsolute(
        { x: storedMember.position.x + 1, y: storedMember.position.y + 1 },
        parent,
      )
      const { leave } = reconcileAreaMembership([areaState], MEMBER_ID, {
        x: abs.x + 50,
        y: abs.y + 25,
      })
      expect(leave).toEqual([])
    })

    describe('rollback, stale runs, retry, unmount', () => {
      function deferred<T>() {
        let resolve!: (v: T) => void
        let reject!: (e: unknown) => void
        const promise = new Promise<T>((res, rej) => {
          resolve = res
          reject = rej
        })
        return { promise, resolve, reject }
      }
      const mockBulk = () =>
        updateTablePositionsBulk as unknown as ReturnType<typeof vi.fn>

      it('Retry after a table was deleted lays out the current board and succeeds', async () => {
        arrange()
        mockBulk().mockRejectedValueOnce(new Error('network'))
        mockBulk().mockResolvedValueOnce({ success: true, count: 1 })
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator(makeHookArgs()),
        )
        await act(async () => {
          await result.current.handleAutoLayoutClick(2)
        })
        // A peer deleted the free table while the save was failing.
        store = store.filter((n) => n.id !== FREE_ID)
        mockRunD3ForceLayout.mockResolvedValueOnce({
          positions: [POSITIONS_WITH_AREA[0]],
          areas: [NEW_AREA],
        })
        await act(async () => {
          await result.current.handleRetry()
        })
        expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(2)
        const second = mockBulk().mock.calls[1][0].data
        expect(second.positions.map((p: any) => p.id)).toEqual([MEMBER_ID])
        expect(result.current.persistError).toBeNull()
      })

      it('a failed save keeps a table a peer added, a rename, and a peer move', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator(makeHookArgs()),
        )
        let run!: Promise<void>
        await act(async () => {
          run = Promise.resolve(result.current.handleAutoLayoutClick(2))
          await Promise.resolve()
        })
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0))
        })
        // While the save is in flight a peer adds a table, renames the free
        // table and moves the member by 7px.
        const peerTable = {
          id: 'peer-table',
          type: 'table',
          position: { x: 900, y: 900 },
        }
        store = [
          ...store.map((n) =>
            n.id === FREE_ID
              ? { ...n, data: { renamed: true } }
              : n.id === MEMBER_ID
                ? { ...n, position: { x: n.position.x + 7, y: n.position.y } }
                : n,
          ),
          peerTable,
        ]
        await act(async () => {
          save.reject(new Error('network'))
          await run
          await new Promise((r) => setTimeout(r, 0))
        })
        const byId = new Map(store.map((n) => [n.id, n]))
        expect(byId.get('peer-table')).toEqual(peerTable)
        expect(byId.get(FREE_ID).data).toEqual({ renamed: true })
        expect(byId.get(FREE_ID).position).toEqual({ x: 0, y: 0 })
        // The peer-moved member keeps its absolute place: 7px right of the
        // laid-out spot, expressed against the restored area origin.
        expect(byId.get(MEMBER_ID).position).toEqual({
          x: 24 + 7 + NEW_AREA.positionX - 0,
          y: 44 + NEW_AREA.positionY - 0,
        })
        expect(byId.get(AREA_ID).position).toEqual({ x: 0, y: 0 })
      })

      it('an old run that fails after a newer run started does not revert', async () => {
        arrange(2)
        const first = deferred<unknown>()
        mockBulk().mockReturnValueOnce(first.promise)
        mockBulk().mockResolvedValueOnce({ success: true, count: 2 })
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator(makeHookArgs()),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        await act(async () => {
          await result.current.handleAutoLayoutClick(2)
        })
        const afterSecond = store
        mockSetNodes.mockClear()
        ;(toast.error as unknown as Mock).mockClear()
        await act(async () => {
          first.reject(new Error('network'))
          await new Promise((r) => setTimeout(r, 0))
        })
        expect(mockSetNodes).not.toHaveBeenCalled()
        expect(store).toBe(afterSecond)
        expect(toast.error).not.toHaveBeenCalled()
        expect(result.current.persistError).toBeNull()
      })

      it('Retry while a run is in flight does nothing', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator(makeHookArgs()),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(1)
        await act(async () => {
          await result.current.handleRetry()
        })
        expect(mockRunD3ForceLayout).toHaveBeenCalledTimes(1)
        expect(mockBulk()).toHaveBeenCalledTimes(1)
        await act(async () => {
          save.resolve({ success: true, count: 2 })
          await new Promise((r) => setTimeout(r, 0))
        })
        expect(result.current.isRunning).toBe(false)
      })

      it.each([
        ['returns no layout', null],
        ['finds no table', 'empty'],
      ])(
        'a newer run that %s does not stop an older failing save from reverting',
        async (_label, kind) => {
          arrange()
          const original = [areaNode, memberNode, freeNode]
          const first = deferred<unknown>()
          mockBulk().mockReturnValueOnce(first.promise)
          const { result } = renderHook(() =>
            useAutoLayoutOrchestrator(makeHookArgs()),
          )
          await act(async () => {
            void result.current.handleAutoLayoutClick(2)
            await new Promise((r) => setTimeout(r, 0))
          })
          const applied = store
          if (kind === 'empty') {
            mockGetNodes.mockImplementation(() => [areaNode])
          } else {
            mockRunD3ForceLayout.mockResolvedValueOnce(null)
          }
          await act(async () => {
            await result.current.handleAutoLayoutClick(2)
          })
          mockGetNodes.mockImplementation(() => store)
          expect(store).toBe(applied)
          ;(toast.error as unknown as Mock).mockClear()
          await act(async () => {
            first.reject(new Error('network'))
            await new Promise((r) => setTimeout(r, 0))
          })
          expect(store).toEqual(original)
          expect(toast.error).toHaveBeenCalledTimes(1)
          expect(result.current.persistError).toBeTruthy()
          expect(result.current.isRunning).toBe(false)
        },
      )

      it('mirrors the layout positions into the cache before the save resolves', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const onTablePositionsChange = vi.fn()
        const onAfterLayout = vi.fn()
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator({
            ...makeHookArgs(),
            onTablePositionsChange,
            onAfterLayout,
          }),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        expect(onTablePositionsChange).toHaveBeenCalledWith(POSITIONS_WITH_AREA)
        expect(onAfterLayout).not.toHaveBeenCalled()
        await act(async () => {
          save.resolve({ success: true, count: 2 })
          await new Promise((r) => setTimeout(r, 0))
        })
      })

      it('a failed save mirrors the pre-layout absolute positions of restored tables only', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const onTablePositionsChange = vi.fn()
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator({
            ...makeHookArgs(),
            onTablePositionsChange,
          }),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        // A peer moves the member by 7px while the save is in flight.
        store = store.map((n) =>
          n.id === MEMBER_ID
            ? { ...n, position: { x: n.position.x + 7, y: n.position.y } }
            : n,
        )
        onTablePositionsChange.mockClear()
        await act(async () => {
          save.reject(new Error('network'))
          await new Promise((r) => setTimeout(r, 0))
        })
        // The free table is restored to its saved spot. The member is
        // excluded: its cache value stays what the peer's move left.
        expect(onTablePositionsChange).toHaveBeenCalledTimes(1)
        expect(onTablePositionsChange).toHaveBeenCalledWith([
          { id: FREE_ID, x: 0, y: 0 },
        ])
      })

      it('a failed save restores a member to its pre-layout ABSOLUTE position', async () => {
        arrange()
        mockBulk().mockRejectedValueOnce(new Error('network'))
        const onTablePositionsChange = vi.fn()
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator({
            ...makeHookArgs(),
            onTablePositionsChange,
          }),
        )
        await act(async () => {
          await result.current.handleAutoLayoutClick(2)
        })
        const last = onTablePositionsChange.mock.calls.at(-1)![0]
        expect(last).toEqual(
          expect.arrayContaining([
            { id: MEMBER_ID, x: 10, y: 10 },
            { id: FREE_ID, x: 0, y: 0 },
          ]),
        )
      })

      it('a failed save re-routes edges against the restored nodes, not an empty list', async () => {
        arrange()
        mockBulk().mockRejectedValueOnce(new Error('network'))
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator(makeHookArgs()),
        )
        await act(async () => {
          await result.current.handleAutoLayoutClick(2)
        })
        const route = recalculateEdgeRouting as unknown as Mock
        const [, nodesArg, movedArg] = route.mock.calls.at(-1)!
        expect(nodesArg.map((n: any) => [n.id, n.position])).toEqual([
          [MEMBER_ID, { x: 10, y: 10 }],
          [FREE_ID, { x: 0, y: 0 }],
        ])
        expect([...movedArg].sort()).toEqual([FREE_ID, MEMBER_ID].sort())
      })

      it('unmount during a save that then fails hands the previous area bounds to the cache', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const onAreaBoundsChange = vi.fn()
        const { result, unmount } = renderHook(() =>
          useAutoLayoutOrchestrator({ ...makeHookArgs(), onAreaBoundsChange }),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        unmount()
        rfMounted = false
        onAreaBoundsChange.mockClear()
        save.reject(new Error('network'))
        await new Promise((r) => setTimeout(r, 0))
        expect(onAreaBoundsChange).toHaveBeenCalledWith([OLD_AREA])
      })

      it('a stale run that saved later does not patch the cache over the newer run', async () => {
        arrange(2)
        const first = deferred<unknown>()
        mockBulk().mockReturnValueOnce(first.promise)
        mockBulk().mockResolvedValueOnce({ success: true, count: 2 })
        const onAfterLayout = vi.fn()
        const { result } = renderHook(() =>
          useAutoLayoutOrchestrator({ ...makeHookArgs(), onAfterLayout }),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        await act(async () => {
          await result.current.handleAutoLayoutClick(2)
        })
        expect(onAfterLayout).toHaveBeenCalledTimes(1)
        mockEmitBulkPositionUpdate.mockClear()
        await act(async () => {
          first.resolve({ success: true, count: 2 })
          await new Promise((r) => setTimeout(r, 0))
        })
        expect(mockEmitBulkPositionUpdate).toHaveBeenCalledTimes(1)
        expect(onAfterLayout).toHaveBeenCalledTimes(1)
      })

      it('unmount during a save that then fails takes the mirrored layout out of the cache', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const onTablePositionsChange = vi.fn()
        const { result, unmount } = renderHook(() =>
          useAutoLayoutOrchestrator({
            ...makeHookArgs(),
            onTablePositionsChange,
          }),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        unmount()
        rfMounted = false
        onTablePositionsChange.mockClear()
        save.reject(new Error('network'))
        await new Promise((r) => setTimeout(r, 0))
        expect(onTablePositionsChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            { id: MEMBER_ID, x: 10, y: 10 },
            { id: FREE_ID, x: 0, y: 0 },
          ]),
        )
      })

      it('unmount during the save still broadcasts and patches the cache', async () => {
        arrange()
        const save = deferred<unknown>()
        mockBulk().mockReturnValueOnce(save.promise)
        const onAfterLayout = vi.fn()
        const { result, unmount } = renderHook(() =>
          useAutoLayoutOrchestrator({ ...makeHookArgs(), onAfterLayout }),
        )
        await act(async () => {
          void result.current.handleAutoLayoutClick(2)
          await new Promise((r) => setTimeout(r, 0))
        })
        unmount()
        rfMounted = false
        ;(toast.success as unknown as Mock).mockClear()
        save.resolve({ success: true, count: 2 })
        await new Promise((r) => setTimeout(r, 0))
        expect(mockEmitBulkPositionUpdate).toHaveBeenCalledWith(
          POSITIONS_WITH_AREA.map((p) => ({
            tableId: p.id,
            positionX: p.x,
            positionY: p.y,
          })),
          [NEW_AREA],
        )
        expect(onAfterLayout).toHaveBeenCalledWith(POSITIONS_WITH_AREA, [
          NEW_AREA,
        ])
        expect(toast.success).not.toHaveBeenCalled()
      })
    })

    it('does nothing when the board has areas but no tables', async () => {
      mockGetNodes.mockReturnValue([areaNode] as any)
      const { result } = renderHook(() =>
        useAutoLayoutOrchestrator(makeHookArgs()),
      )
      await act(async () => {
        await result.current.handleAutoLayoutClick(2)
      })
      expect(mockRunD3ForceLayout).not.toHaveBeenCalled()
      expect(mockSetNodes).not.toHaveBeenCalled()
      expect(updateTablePositionsBulk).not.toHaveBeenCalled()
      expect(result.current.isRunning).toBe(false)
    })
  })
})

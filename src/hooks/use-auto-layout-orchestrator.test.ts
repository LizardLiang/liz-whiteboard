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
  it('TC-AL-O-05: retry success — re-submits same payload, emits broadcast, clears error', async () => {
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

    // Retry → succeeds
    await act(async () => {
      await result.current.handleRetry()
    })

    // runD3ForceLayout NOT called again (no recompute)
    expect(mockRunD3ForceLayout).not.toHaveBeenCalled()

    // updateTablePositionsBulk called with the same payload
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
    const areaNode = { id: 'area-1', type: 'area', position: { x: 0, y: 0 } }
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

    await act(async () => {
      await result.current.handleRetry()
    })
    expect(mockOnAfterLayout).toHaveBeenCalledTimes(1)
    // area-autolayout-persistence-fix: retry re-submits the same payload, so
    // onAfterLayout must receive that same payload's positions converted
    // back to the { id, x, y } shape (the stashed payload uses
    // { id, positionX, positionY }).
    expect(mockOnAfterLayout).toHaveBeenCalledWith(POSITIONS, [])
  })

  // TC-AL-O-18 — Comment-pin nodes filtered out of the layout input AND the
  // bulk-persist payload (GH #110 regression — the n.type === 'table' filter
  // must exclude 'comment' nodes just like it excludes 'area' nodes).
  it('TC-AL-O-18: comment-pin nodes are excluded from layout input and bulk persist payload', async () => {
    ;(updateTablePositionsBulk as unknown as Mock).mockReset()

    const tableNode = { id: 'table-1', type: 'table', position: { x: 0, y: 0 } }
    const areaNode = { id: 'area-1', type: 'area', position: { x: 0, y: 0 } }
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

    function arrange() {
      mockGetNodes.mockReturnValue([areaNode, memberNode, freeNode] as any)
      mockRunD3ForceLayout.mockResolvedValueOnce({
        positions: POSITIONS_WITH_AREA,
        areas: [NEW_AREA],
      })
    }

    afterEach(() => {
      mockGetNodes.mockReturnValue(DEFAULT_NODES)
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

    it('retry re-sends the area bounds', async () => {
      arrange()
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
      expect(mockSetNodes.mock.calls[1][0]).toEqual(original)
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
      expect(onAreaBoundsChange).toHaveBeenLastCalledWith([OLD_AREA])
    })

    it('retry success re-applies the store nodes and area bounds', async () => {
      arrange()
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

    it('a failed retry does not overwrite the store a second time', async () => {
      arrange()
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
      expect(mockSetNodes).toHaveBeenCalledTimes(2)
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
      const stored = mockSetNodes.mock.calls.at(-1)![0] as Array<any>
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

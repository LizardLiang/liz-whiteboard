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
// eslint-disable-next-line import/first, import/order
import { useAutoLayoutOrchestrator } from './use-auto-layout-orchestrator'

const mockSetNodes = vi.fn()
const mockGetNodes = vi.fn(() => [])
const mockGetEdges = vi.fn(() => [])
const mockFitView = vi.fn()
const mockTriggerSessionExpired = vi.fn()

const AUTH_ERROR_RESPONSE = { error: 'UNAUTHORIZED' as const, status: 401 as const }

// Default hook args
const WB_ID = '11111111-1111-1111-1111-111111111111'
const POSITIONS = [
  { id: '22222222-2222-2222-2222-222222222222', x: 100, y: 200 },
  { id: '33333333-3333-3333-3333-333333333333', x: 400, y: 200 },
]

let mockRunD3ForceLayout: ReturnType<typeof vi.fn>
let mockEmitBulkPositionUpdate: ReturnType<typeof vi.fn>

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

  ;(useReactFlow as ReturnType<typeof vi.fn>).mockReturnValue({
    setNodes: mockSetNodes,
    getNodes: mockGetNodes,
    getEdges: mockGetEdges,
    fitView: mockFitView,
  })

  ;(useAuthContext as ReturnType<typeof vi.fn>).mockReturnValue({
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
          { id: POSITIONS[0].id, positionX: POSITIONS[0].x, positionY: POSITIONS[0].y },
          { id: POSITIONS[1].id, positionX: POSITIONS[1].x, positionY: POSITIONS[1].y },
        ]),
      },
    })

    // emitBulkPositionUpdate called with correct payload
    expect(mockEmitBulkPositionUpdate).toHaveBeenCalledWith(
      expect.arrayContaining([
        { tableId: POSITIONS[0].id, positionX: POSITIONS[0].x, positionY: POSITIONS[0].y },
      ]),
    )

    // success toast
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('2'))

    // fitView called after setTimeout(100)
    vi.runAllTimers()
    expect(mockFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 300 })

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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>)
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
    mockRunD3ForceLayout.mockResolvedValueOnce(POSITIONS)
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>)
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
    ;(updateTablePositionsBulk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
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
})

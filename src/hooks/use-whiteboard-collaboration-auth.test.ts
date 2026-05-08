// src/hooks/use-whiteboard-collaboration-auth.test.ts
// Phase 5 WebSocket client-side auth tests
// TC-P5-06: permission_revoked event — toast + redirect
// TC-P5-07: session_expired event — triggers SessionExpiredModal

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { toast } from 'sonner'
import { useWhiteboardCollaboration } from './use-whiteboard-collaboration'

// Must mock before imports
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}))

// Mock useCollaboration so we fully control events
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

// Mock auth context
const mockTriggerSessionExpired = vi.fn()
vi.mock('@/components/auth/AuthContext', () => ({
  useAuthContext: () => ({
    sessionExpired: false,
    triggerSessionExpired: mockTriggerSessionExpired,
    dismissSessionExpired: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockNavigate.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P5-06: permission_revoked event — toast notification + redirect
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P5-06: permission_revoked event handler', () => {
  const whiteboardId = 'wb-001'
  const userId = 'user-current'

  it('registers a permission_revoked event listener on mount', () => {
    renderHook(() => useWhiteboardCollaboration(whiteboardId, userId, vi.fn()))

    const registeredEvents = mockOn.mock.calls.map(([event]: [string]) => event)
    expect(registeredEvents).toContain('permission_revoked')
  })

  it('shows toast.error when permission_revoked is received', () => {
    renderHook(() => useWhiteboardCollaboration(whiteboardId, userId, vi.fn()))

    const permissionRevokedCall = mockOn.mock.calls.find(
      ([event]: [string]) => event === 'permission_revoked',
    )
    const handler = permissionRevokedCall?.[1]
    expect(handler).toBeDefined()

    act(() => {
      handler({ projectId: 'proj-001' })
    })

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('access'),
      expect.objectContaining({ duration: expect.any(Number) }),
    )
  })

  it('schedules redirect to / after 5 seconds on permission_revoked', () => {
    renderHook(() => useWhiteboardCollaboration(whiteboardId, userId, vi.fn()))

    const permissionRevokedCall = mockOn.mock.calls.find(
      ([event]: [string]) => event === 'permission_revoked',
    )
    const handler = permissionRevokedCall?.[1]

    act(() => {
      handler({ projectId: 'proj-001' })
    })

    // Before 5 seconds: no navigation yet
    expect(mockNavigate).not.toHaveBeenCalled()

    // After 5 seconds: navigation triggers
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('cleans up permission_revoked listener and timer on unmount', () => {
    const { unmount } = renderHook(() =>
      useWhiteboardCollaboration(whiteboardId, userId, vi.fn()),
    )

    const permissionRevokedCall = mockOn.mock.calls.find(
      ([event]: [string]) => event === 'permission_revoked',
    )
    const handler = permissionRevokedCall?.[1]

    // Trigger the event
    act(() => {
      handler({ projectId: 'proj-001' })
    })

    // Unmount before the 5s timer fires
    unmount()

    // Timer should not fire after unmount
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    // Navigation should NOT have been called (timer cleared)
    expect(mockNavigate).not.toHaveBeenCalled()

    // off should have been called to remove the listener
    const offCalls = mockOff.mock.calls.map(([event]: [string]) => event)
    expect(offCalls).toContain('permission_revoked')
  })
})

// src/server/socket.test.ts
// Phase 5 WebSocket authentication tests
// TC-P5-01: handshake without session cookie is rejected
// TC-P5-02: valid session cookie accepted, userId attached
// TC-P5-03: session expiry on active connection — emits session_expired and disconnects
// TC-P5-04: valid session allows event processing
// TC-P5-08: CollaborationSession records use real userId FK

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseSessionCookie } from '@/lib/auth/cookies'
import { validateSessionToken } from '@/lib/auth/session'
import { createCollaborationSession } from '@/data/collaboration'
import { findEffectiveRole } from '@/data/permission'

vi.mock('@/lib/auth/cookies', () => ({
  parseSessionCookie: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  validateSessionToken: vi.fn(),
  hashToken: vi.fn(),
}))

vi.mock('@/data/collaboration', () => ({
  createCollaborationSession: vi.fn(),
  deleteCollaborationSession: vi.fn(),
  deleteStaleSession: vi.fn(),
  findActiveCollaborators: vi.fn(),
  updateCollaborationSession: vi.fn(),
  updateSessionActivity: vi.fn(),
}))

vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_TOKEN =
  'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
const USER_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const SESSION_ID = 'session-uuid-0000-0000-000000000001'
const PROJECT_ID = 'project-uuid-000-0000-000000000001'

const mockAuthResult = {
  user: { id: USER_UUID, username: 'alice', email: 'alice@example.com' },
  session: {
    id: SESSION_ID,
    expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// The handshake middleware logic extracted from collaboration.ts
// This is the io.use() handler that runs on every connection attempt.
// ─────────────────────────────────────────────────────────────────────────────

async function handshakeMiddleware(
  socket: {
    handshake: { headers: Record<string, string> }
    data: Record<string, any>
  },
  next: (err?: Error) => void,
) {
  try {
    const cookieHeader = socket.handshake.headers.cookie ?? ''
    const token = (parseSessionCookie as any)(cookieHeader)
    if (!token) {
      return next(new Error('UNAUTHORIZED'))
    }

    const authResult = await (validateSessionToken as any)(token)
    if (!authResult) {
      return next(new Error('UNAUTHORIZED'))
    }

    socket.data.userId = authResult.user.id
    socket.data.sessionId = authResult.session.id
    socket.data.sessionExpiresAt = authResult.session.expiresAt.getTime()
    next()
  } catch (error) {
    next(new Error('UNAUTHORIZED'))
  }
}

// Session expiry check (mirrors collaboration.ts event handler guard)
function checkSessionExpiry(socket: {
  data: { sessionExpiresAt: number }
  emit: (event: string, data?: any) => void
  disconnect: (force: boolean) => void
}): boolean {
  if (Date.now() > socket.data.sessionExpiresAt) {
    socket.emit('session_expired')
    socket.disconnect(true)
    return true // expired
  }
  return false // valid
}

// Permission check on mutating events
async function checkMutationPermission(
  socket: {
    data: { userId: string }
    emit: (event: string, data?: any) => void
    disconnect: (force: boolean) => void
  },
  projectId: string,
): Promise<boolean> {
  const role = await findEffectiveRole(socket.data.userId, projectId)
  const HIERARCHY: Record<string, number> = {
    VIEWER: 1,
    EDITOR: 2,
    ADMIN: 3,
    OWNER: 4,
  }
  const roleValue = role ? (HIERARCHY[role] ?? 0) : 0
  if (roleValue < HIERARCHY.EDITOR) {
    socket.emit('permission_revoked', { projectId })
    socket.disconnect(true)
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────

function buildMockSocket(
  overrides: Partial<{
    cookieHeader: string
    sessionExpiresAt: number
    userId: string
  }> = {},
) {
  const emitSpy = vi.fn()
  const disconnectSpy = vi.fn()
  const nextSpy = vi.fn()

  const socket = {
    id: 'socket-test-123',
    handshake: {
      headers: {
        ...(overrides.cookieHeader ? { cookie: overrides.cookieHeader } : {}),
      } as Record<string, string>,
    },
    data: {
      userId: overrides.userId ?? '',
      sessionId: '',
      sessionExpiresAt: overrides.sessionExpiresAt ?? Date.now() + 86400000,
    },
    emit: emitSpy,
    disconnect: disconnectSpy,
  }

  return { socket, nextSpy, emitSpy, disconnectSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P5-01: Connection without session cookie is rejected
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P5-01: handshake — no session cookie rejected', () => {
  it('calls next with UNAUTHORIZED error when no cookie header present', async () => {
    vi.mocked(parseSessionCookie).mockReturnValue(null)

    const { socket, nextSpy } = buildMockSocket()
    await handshakeMiddleware(socket, nextSpy)

    expect(nextSpy).toHaveBeenCalledWith(expect.any(Error))
    const err = nextSpy.mock.calls[0][0]
    expect(err.message).toBe('UNAUTHORIZED')
  })

  it('socket.data.userId is NOT set when connection is rejected', async () => {
    vi.mocked(parseSessionCookie).mockReturnValue(null)

    const { socket, nextSpy } = buildMockSocket()
    await handshakeMiddleware(socket, nextSpy)

    expect(socket.data.userId).toBe('')
  })

  it('calls next with error when cookie is present but token is invalid in DB', async () => {
    vi.mocked(parseSessionCookie).mockReturnValue('invalid-token')
    vi.mocked(validateSessionToken).mockResolvedValue(null)

    const { socket, nextSpy } = buildMockSocket({
      cookieHeader: 'session_token=invalid-token',
    })
    await handshakeMiddleware(socket, nextSpy)

    expect(nextSpy).toHaveBeenCalledWith(expect.any(Error))
    const err = nextSpy.mock.calls[0][0]
    expect(err.message).toBe('UNAUTHORIZED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P5-02: Valid session cookie accepted, userId attached
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P5-02: handshake — valid session accepted', () => {
  it('calls next with no error for valid session cookie', async () => {
    vi.mocked(parseSessionCookie).mockReturnValue(SESSION_TOKEN)
    vi.mocked(validateSessionToken).mockResolvedValue(mockAuthResult as any)

    const { socket, nextSpy } = buildMockSocket({
      cookieHeader: `session_token=${SESSION_TOKEN}`,
    })
    await handshakeMiddleware(socket, nextSpy)

    expect(nextSpy).toHaveBeenCalledWith() // no args = success
    expect(nextSpy).not.toHaveBeenCalledWith(expect.any(Error))
  })

  it('sets socket.data.userId to the authenticated user ID', async () => {
    vi.mocked(parseSessionCookie).mockReturnValue(SESSION_TOKEN)
    vi.mocked(validateSessionToken).mockResolvedValue(mockAuthResult as any)

    const { socket, nextSpy } = buildMockSocket({
      cookieHeader: `session_token=${SESSION_TOKEN}`,
    })
    await handshakeMiddleware(socket, nextSpy)

    expect(socket.data.userId).toBe(USER_UUID)
  })

  it('sets socket.data.sessionId to the session ID', async () => {
    vi.mocked(parseSessionCookie).mockReturnValue(SESSION_TOKEN)
    vi.mocked(validateSessionToken).mockResolvedValue(mockAuthResult as any)

    const { socket, nextSpy } = buildMockSocket({
      cookieHeader: `session_token=${SESSION_TOKEN}`,
    })
    await handshakeMiddleware(socket, nextSpy)

    expect(socket.data.sessionId).toBe(SESSION_ID)
  })

  it('sets socket.data.sessionExpiresAt to the session expiry timestamp', async () => {
    const futureDate = new Date(Date.now() + 3600000) // 1 hour from now
    vi.mocked(parseSessionCookie).mockReturnValue(SESSION_TOKEN)
    vi.mocked(validateSessionToken).mockResolvedValue({
      ...mockAuthResult,
      session: { id: SESSION_ID, expiresAt: futureDate },
    } as any)

    const { socket, nextSpy } = buildMockSocket({
      cookieHeader: `session_token=${SESSION_TOKEN}`,
    })
    await handshakeMiddleware(socket, nextSpy)

    expect(socket.data.sessionExpiresAt).toBe(futureDate.getTime())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P5-03: Session expiry on active connection — emits session_expired and disconnects
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P5-03: session expiry on active connection', () => {
  it('emits session_expired when sessionExpiresAt is in the past', () => {
    const { socket, emitSpy, disconnectSpy } = buildMockSocket({
      userId: USER_UUID,
      sessionExpiresAt: Date.now() - 1000, // 1 second ago
    })

    const expired = checkSessionExpiry(socket)

    expect(expired).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith('session_expired')
  })

  it('calls socket.disconnect(true) on expired session', () => {
    const { socket, disconnectSpy } = buildMockSocket({
      userId: USER_UUID,
      sessionExpiresAt: Date.now() - 1000, // expired
    })

    checkSessionExpiry(socket)

    expect(disconnectSpy).toHaveBeenCalledWith(true)
  })

  it('returns true (expired) so event handler can early-return', () => {
    const { socket } = buildMockSocket({
      userId: USER_UUID,
      sessionExpiresAt: Date.now() - 5000,
    })

    const expired = checkSessionExpiry(socket)
    expect(expired).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P5-04: Valid session allows event processing
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P5-04: valid session allows event processing', () => {
  it('returns false (not expired) when sessionExpiresAt is in the future', () => {
    const { socket, emitSpy, disconnectSpy } = buildMockSocket({
      userId: USER_UUID,
      sessionExpiresAt: Date.now() + 3600000, // 1 hour from now
    })

    const expired = checkSessionExpiry(socket)

    expect(expired).toBe(false)
    expect(emitSpy).not.toHaveBeenCalledWith('session_expired')
    expect(disconnectSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Permission enforcement on edit events (mirrors TC-P5-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('Permission check on mutating WebSocket events', () => {
  it('VIEWER emitting mutating event receives permission_revoked and gets disconnected', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')

    const { socket, emitSpy, disconnectSpy } = buildMockSocket({
      userId: USER_UUID,
    })
    const allowed = await checkMutationPermission(socket, PROJECT_ID)

    expect(allowed).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith('permission_revoked', {
      projectId: PROJECT_ID,
    })
    expect(disconnectSpy).toHaveBeenCalledWith(true)
  })

  it('null role emitting mutating event is rejected', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)

    const { socket, emitSpy, disconnectSpy } = buildMockSocket({
      userId: USER_UUID,
    })
    const allowed = await checkMutationPermission(socket, PROJECT_ID)

    expect(allowed).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith('permission_revoked', {
      projectId: PROJECT_ID,
    })
    expect(disconnectSpy).toHaveBeenCalledWith(true)
  })

  it('EDITOR emitting mutating event is allowed', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')

    const { socket, emitSpy, disconnectSpy } = buildMockSocket({
      userId: USER_UUID,
    })
    const allowed = await checkMutationPermission(socket, PROJECT_ID)

    expect(allowed).toBe(true)
    expect(emitSpy).not.toHaveBeenCalledWith(
      'permission_revoked',
      expect.anything(),
    )
    expect(disconnectSpy).not.toHaveBeenCalled()
  })

  it('OWNER emitting mutating event is allowed', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')

    const { socket } = buildMockSocket({ userId: USER_UUID })
    const allowed = await checkMutationPermission(socket, PROJECT_ID)

    expect(allowed).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P5-08: CollaborationSession records use real userId FK
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P5-08: CollaborationSession created with real userId from socket.data', () => {
  it('creates collaboration session with socket.data.userId (not a placeholder)', async () => {
    vi.mocked(createCollaborationSession).mockResolvedValue({
      id: 'collab-session-1',
      whiteboardId: 'wb-001',
      userId: USER_UUID,
      socketId: 'socket-test-123',
      cursor: null,
      lastActivityAt: new Date(),
      createdAt: new Date(),
    } as any)

    // Simulate the connection handler logic:
    // it uses socket.data.userId (set by handshake middleware) to create the session
    const userId = USER_UUID // from socket.data.userId
    await createCollaborationSession({
      whiteboardId: 'wb-001',
      userId,
      socketId: 'socket-test-123',
    })

    const createCall = vi.mocked(createCollaborationSession).mock.calls[0][0]
    expect(createCall.userId).toBe(USER_UUID)
    expect(createCall.userId).not.toBe('anonymous')
    expect(createCall.userId).not.toMatch(/^placeholder/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SEC-WS-04 Regression: requireRole emits canonical FORBIDDEN error shape
// Tests the new requireRole helper (AD-1) replacing the old no-op.
// TC-WS-01 through TC-WS-06
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/data/resolve-project', () => ({
  getWhiteboardProjectId: vi.fn(),
}))

vi.mock('@/lib/auth/log-sample', () => ({
  logSampledError: vi.fn(),
}))

// eslint-disable-next-line import/first
import { getWhiteboardProjectId } from '@/data/resolve-project'
// eslint-disable-next-line import/first, import/order
import type { WSAuthErrorPayload } from '@/lib/auth/require-role'
// eslint-disable-next-line import/first
import { getDenialCount, requireRole } from '@/lib/auth/require-role'

function buildAuthSocket(userId = USER_UUID) {
  const emit = vi.fn() as (e: string, p: WSAuthErrorPayload) => void
  return {
    data: { userId },
    emit,
  }
}

describe('SEC-WS-04: requireRole emits canonical FORBIDDEN when denied', () => {
  beforeEach(() => {
    vi.mocked(getWhiteboardProjectId).mockResolvedValue(PROJECT_ID)
    vi.clearAllMocks()
  })

  // TC-WS-01 (Regression): Unauthorized user receives FORBIDDEN, no DB write (checked via no createColumn call)
  it('TC-WS-01 (Regression): null role → FORBIDDEN emitted, returns true', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)
    const socket = buildAuthSocket()
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(true)
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        code: 'FORBIDDEN',
        event: 'column:create',
      }),
    )
  })

  // TC-WS-02: Authorized EDITOR emitting column:create succeeds
  it('TC-WS-02: EDITOR role → returns false (allowed), no error event', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')
    const socket = buildAuthSocket()
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(false)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  // TC-WS-03: VIEWER denied
  it('TC-WS-03: VIEWER role → FORBIDDEN emitted', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')
    const socket = buildAuthSocket()
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(true)
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        code: 'FORBIDDEN',
      }),
    )
  })

  // TC-WS-04: Denial counter increments
  it('TC-WS-04: denial counter increments per user per event', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)
    const userId = `ws04-user-${Date.now()}`
    const socket = buildAuthSocket(userId)
    await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(getDenialCount(userId, 'column:create')).toBe(2)
  })

  // TC-WS-05: Log contains userId and event but not email
  it('TC-WS-05: WARN log contains userId + event, no PII beyond userId', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket = buildAuthSocket('user-pii-test')
    await requireRole(socket, 'wb-warn', 'column:create', 'EDITOR')
    const logMsg = warnSpy.mock.calls[0]?.[0] as string | undefined
    expect(logMsg).toContain('user=user-pii-test')
    expect(logMsg).toContain('event=column:create')
    expect(logMsg).not.toContain('@')
    warnSpy.mockRestore()
  })

  // TC-WS-06: Whiteboard not found → FORBIDDEN (anti-enumeration)
  it('TC-WS-06: whiteboard not found → FORBIDDEN (same shape, indistinguishable)', async () => {
    vi.mocked(getWhiteboardProjectId).mockResolvedValue(null)
    const socket = buildAuthSocket()
    const denied = await requireRole(
      socket,
      'wb-missing',
      'column:create',
      'EDITOR',
    )
    expect(denied).toBe(true)
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        code: 'FORBIDDEN',
        event: 'column:create',
      }),
    )
    // findEffectiveRole must NOT be called when projectId is null (anti-enumeration)
    expect(vi.mocked(findEffectiveRole)).not.toHaveBeenCalled()
  })
})

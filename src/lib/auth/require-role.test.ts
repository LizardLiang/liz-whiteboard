// src/lib/auth/require-role.test.ts
// Suite 1 — Unit: requireRole / requireServerFnRole helpers (Phase 1.3)
// TC-RR-01 through TC-RR-14
// Suite 3 — Unit: Error class shapes
// TC-ERR-01 through TC-ERR-04

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the data layer so tests never touch the DB
vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
}))

vi.mock('@/data/resolve-project', () => ({
  getWhiteboardProjectId: vi.fn(),
}))

vi.mock('@/lib/auth/log-sample', () => ({
  logSampledError: vi.fn(),
}))

// eslint-disable-next-line import/first
import { findEffectiveRole } from '@/data/permission'
// eslint-disable-next-line import/first
import { getWhiteboardProjectId } from '@/data/resolve-project'
// eslint-disable-next-line import/first
import { logSampledError } from '@/lib/auth/log-sample'
// eslint-disable-next-line import/first, import/order
import type { WSAuthErrorPayload } from './require-role'
// eslint-disable-next-line import/first, import/order
import {
  BatchDeniedError,
  ForbiddenError,
  getDenialCount,
  requireRole,
  requireServerFnRole,
} from './require-role'

const mockFindEffectiveRole = vi.mocked(findEffectiveRole)
const mockGetWhiteboardProjectId = vi.mocked(getWhiteboardProjectId)
const mockLogSampledError = vi.mocked(logSampledError)

function makeMockSocket(userId = 'user-1') {
  return {
    data: { userId },
    emit: vi.fn() as (e: string, p: WSAuthErrorPayload) => void,
  }
}

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWhiteboardProjectId.mockResolvedValue('project-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // TC-RR-01: authorized user returns false (no denial)
  it('TC-RR-01: authorized EDITOR returns false, no emit', async () => {
    mockFindEffectiveRole.mockResolvedValue('EDITOR')
    const socket = makeMockSocket()
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(false)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  // TC-RR-02: insufficient role emits FORBIDDEN and returns true
  it('TC-RR-02: VIEWER on EDITOR-required emits FORBIDDEN and returns true', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    const socket = makeMockSocket('user-2')
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(true)
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: 'FORBIDDEN',
      event: 'column:create',
    }))
    expect(getDenialCount('user-2', 'column:create')).toBeGreaterThanOrEqual(1)
  })

  // TC-RR-03: null role (no membership) emits FORBIDDEN and returns true
  it('TC-RR-03: null role emits FORBIDDEN and returns true', async () => {
    mockFindEffectiveRole.mockResolvedValue(null)
    const socket = makeMockSocket('user-3')
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(true)
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: 'FORBIDDEN',
    }))
  })

  // TC-RR-04: whiteboard not found (null projectId) emits FORBIDDEN, findEffectiveRole not called
  it('TC-RR-04: null projectId emits FORBIDDEN, findEffectiveRole not called', async () => {
    mockGetWhiteboardProjectId.mockResolvedValue(null)
    const socket = makeMockSocket('user-4')
    const denied = await requireRole(socket, 'wb-missing', 'column:create', 'EDITOR')
    expect(denied).toBe(true)
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: 'FORBIDDEN',
    }))
    expect(mockFindEffectiveRole).not.toHaveBeenCalled()
  })

  // TC-RR-05: role lookup throws → fails closed, emits FORBIDDEN, logs sampled error
  it('TC-RR-05: role lookup throws → fails closed, does not rethrow', async () => {
    mockFindEffectiveRole.mockRejectedValue(new Error('DB_TIMEOUT'))
    const socket = makeMockSocket('user-5')
    await expect(requireRole(socket, 'wb-1', 'column:create', 'EDITOR')).resolves.toBe(true)
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: 'FORBIDDEN',
    }))
    expect(mockLogSampledError).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-5',
      errorClass: 'RBAC_LOOKUP_FAILED',
    }))
  })

  // TC-RR-06: denial counter increments cumulatively
  it('TC-RR-06: denial counter increments 3x across 3 calls', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    // Reset by using a unique user+event combo per test (counter is cumulative in-process)
    const userId = `user-rr06-${Date.now()}`
    const sock = { data: { userId }, emit: vi.fn() as (e: string, p: WSAuthErrorPayload) => void }
    await requireRole(sock, 'wb-1', 'evt:counter', 'EDITOR')
    await requireRole(sock, 'wb-1', 'evt:counter', 'EDITOR')
    await requireRole(sock, 'wb-1', 'evt:counter', 'EDITOR')
    expect(getDenialCount(userId, 'evt:counter')).toBe(3)
  })

  // TC-RR-BOUNDED: denial counter Map is size-bounded (Hermes BLOCKER-2)
  // Uses 1001 unique keys to exceed the 1000-entry cap and verifies the oldest is evicted.
  it('TC-RR-BOUNDED: denialCounter evicts oldest entry when at capacity (1001 unique keys)', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    // We need to test the eviction logic by calling incrementDenialCounter directly
    // via requireRole with 1001 unique userId:eventName combinations.
    // After 1001 entries, the first entry should be evicted and have count 0.
    const firstUserId = `user-bounded-first-${Date.now()}`
    const firstSocket = { data: { userId: firstUserId }, emit: vi.fn() as (e: string, p: WSAuthErrorPayload) => void }
    // Insert first entry
    await requireRole(firstSocket, 'wb-1', 'bounded:event', 'EDITOR')
    expect(getDenialCount(firstUserId, 'bounded:event')).toBe(1)

    // Fill up to capacity (1001 additional unique entries to trigger eviction)
    for (let i = 0; i < 1001; i++) {
      const sock = { data: { userId: `user-bounded-filler-${Date.now()}-${i}` }, emit: vi.fn() as (e: string, p: WSAuthErrorPayload) => void }
      await requireRole(sock, 'wb-1', 'bounded:event', 'EDITOR')
    }

    // The first entry should have been evicted (count drops back to 0)
    expect(getDenialCount(firstUserId, 'bounded:event')).toBe(0)
  })

  // TC-RR-11: OWNER satisfies EDITOR minimum
  it('TC-RR-11: OWNER role satisfies EDITOR minimum — returns false', async () => {
    mockFindEffectiveRole.mockResolvedValue('OWNER')
    const socket = makeMockSocket()
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(false)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  // TC-RR-12: VIEWER does not satisfy EDITOR minimum
  it('TC-RR-12: VIEWER does not satisfy EDITOR minimum — returns true', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    const socket = makeMockSocket()
    const denied = await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    expect(denied).toBe(true)
  })

  // TC-RR-13: WSAuthErrorPayload shape completeness — no extra fields
  it('TC-RR-13: emitted payload has exactly code, event, message — no resource IDs', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    const socket = makeMockSocket()
    await requireRole(socket, 'wb-1', 'column:create', 'EDITOR')
    const [, payload] = vi.mocked(socket.emit).mock.calls[0] as [string, WSAuthErrorPayload]
    expect(Object.keys(payload).sort()).toEqual(['code', 'event', 'message'].sort())
    expect(payload.code).toBe('FORBIDDEN')
    expect(payload.event).toBe('column:create')
    expect(typeof payload.message).toBe('string')
  })

  // TC-RR-14: WARN log contains userId, eventName, whiteboardId, role, required — no PII
  it('TC-RR-14: console.warn log contains userId, event, whiteboard', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket = makeMockSocket('user-log-test')
    await requireRole(socket, 'wb-log', 'column:create', 'EDITOR')
    const call = warnSpy.mock.calls[0]?.[0] as string | undefined
    expect(call).toContain('user=user-log-test')
    expect(call).toContain('event=column:create')
    expect(call).toContain('whiteboard=wb-log')
    warnSpy.mockRestore()
  })
})

describe('requireServerFnRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-RR-07: authorized user resolves without throwing
  it('TC-RR-07: authorized EDITOR resolves without throw', async () => {
    mockFindEffectiveRole.mockResolvedValue('EDITOR')
    await expect(requireServerFnRole('user-1', 'project-1', 'EDITOR')).resolves.toBeUndefined()
  })

  // TC-RR-08: insufficient role throws ForbiddenError
  it('TC-RR-08: VIEWER on EDITOR-required throws ForbiddenError with status 403', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    await expect(requireServerFnRole('user-1', 'project-1', 'EDITOR')).rejects.toThrow(ForbiddenError)
    try {
      await requireServerFnRole('user-1', 'project-1', 'EDITOR')
    } catch (e) {
      expect((e as ForbiddenError).status).toBe(403)
      expect((e as ForbiddenError).errorCode).toBe('FORBIDDEN')
    }
  })

  // TC-RR-09: null projectId throws ForbiddenError, findEffectiveRole not called
  it('TC-RR-09: null projectId throws ForbiddenError without calling findEffectiveRole', async () => {
    await expect(requireServerFnRole('user-1', null, 'EDITOR')).rejects.toThrow(ForbiddenError)
    expect(mockFindEffectiveRole).not.toHaveBeenCalled()
  })

  // TC-RR-10: role lookup throws → rethrows as ForbiddenError, logs sampled error
  it('TC-RR-10: DB throw → rethrows as ForbiddenError, original error not leaked', async () => {
    mockFindEffectiveRole.mockRejectedValue(new Error('CONN_POOL_EXHAUSTED'))
    let caught: unknown
    try {
      await requireServerFnRole('user-1', 'project-1', 'EDITOR')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ForbiddenError)
    expect((caught as ForbiddenError).message).not.toContain('CONN_POOL_EXHAUSTED')
    expect(mockLogSampledError).toHaveBeenCalledWith(expect.objectContaining({
      errorClass: 'RBAC_LOOKUP_FAILED',
    }))
  })

  // TC-RR-11 (server fn variant): OWNER satisfies EDITOR minimum
  it('TC-RR-11: OWNER satisfies EDITOR — resolves', async () => {
    mockFindEffectiveRole.mockResolvedValue('OWNER')
    await expect(requireServerFnRole('user-1', 'project-1', 'EDITOR')).resolves.toBeUndefined()
  })

  // TC-RR-12 (server fn variant): VIEWER does not satisfy EDITOR
  it('TC-RR-12: VIEWER does not satisfy EDITOR — throws', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    await expect(requireServerFnRole('user-1', 'project-1', 'EDITOR')).rejects.toThrow(ForbiddenError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Error class shapes
// TC-ERR-01 through TC-ERR-04
// ─────────────────────────────────────────────────────────────────────────────

describe('ForbiddenError', () => {
  // TC-ERR-01: correct HTTP shape
  it('TC-ERR-01: has status 403, errorCode FORBIDDEN, name ForbiddenError, default message', () => {
    const e = new ForbiddenError()
    expect(e.status).toBe(403)
    expect(e.errorCode).toBe('FORBIDDEN')
    expect(e.name).toBe('ForbiddenError')
    expect(e.message).toBe('You do not have access to this resource.')
  })

  // TC-ERR-02: custom message propagates
  it('TC-ERR-02: custom message is used', () => {
    const e = new ForbiddenError('custom msg')
    expect(e.message).toBe('custom msg')
  })
})

describe('BatchDeniedError', () => {
  // TC-ERR-03: correct HTTP shape with BATCH_DENIED code
  it('TC-ERR-03: has status 403, errorCode BATCH_DENIED, message contains expected text', () => {
    const e = new BatchDeniedError()
    expect(e.status).toBe(403)
    expect(e.errorCode).toBe('BATCH_DENIED')
    expect(e.message).toContain('One or more items target a resource you no longer have access to')
  })

  // TC-ERR-04: message does NOT expose tableId, item index, or projectId
  it('TC-ERR-04: message is static — no dynamic values (no id/index/project)', () => {
    const e = new BatchDeniedError()
    // The message should not contain dynamic identifier-like patterns
    // We allow "resource" (it is in the static text) but not "table" or "index"
    expect(e.message).not.toMatch(/table[Ii][dD]|itemIndex|projectId/)
    // Confirm there is no number that looks like an index (e.g. "item 2 of 3")
    expect(e.message).not.toMatch(/item \d+ of \d+/)
  })
})

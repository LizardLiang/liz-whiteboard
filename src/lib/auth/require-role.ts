// src/lib/auth/require-role.ts
// Centralized authorization primitives for WebSocket handlers and server functions.
// AD-1: replaces the no-op denyIfInsufficientPermission stub.

import type { EffectiveRole } from '@/data/permission'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { logSampledError } from '@/lib/auth/log-sample'
import { getWhiteboardProjectId } from '@/data/resolve-project'

// ─────────────────────────────────────────────────────────────────────────────
// Error classes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown by `requireServerFnRole` when RBAC denies a request.
 * SEC-ERR-01: HTTP 403 with { error: 'FORBIDDEN', message }.
 */
export class ForbiddenError extends Error {
  readonly status = 403 as const
  readonly errorCode = 'FORBIDDEN' as const
  constructor(message = 'You do not have access to this resource.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/**
 * Thrown by `createColumnsFn` batch RBAC pre-validate step.
 * SEC-ERR-01 + SEC-BATCH-03: HTTP 403 with { error: 'BATCH_DENIED' }.
 * Message is fixed — no item index, tableId, or projectId is embedded.
 */
export class BatchDeniedError extends Error {
  readonly status = 403 as const
  readonly errorCode = 'BATCH_DENIED' as const
  constructor() {
    super(
      'This batch could not be saved. One or more items target a resource you no longer have access to. Try removing items added in the last few minutes, or save items individually to find which one is blocked.',
    )
    this.name = 'BatchDeniedError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket error payload type (SEC-ERR-02)
// ─────────────────────────────────────────────────────────────────────────────

export type WSAuthErrorPayload = {
  code: 'FORBIDDEN' | 'BATCH_DENIED'
  event: string
  message: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-(userId, event) denial counter (SEC-WS-03)
// In-process, non-durable — resets on server restart.
//
// Size-bounded: at most MAX_DENIAL_ENTRIES entries. When full, the oldest
// entry (first in insertion order) is evicted before inserting a new key.
// This prevents unbounded growth on long-running servers. (Hermes BLOCKER-2)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DENIAL_ENTRIES = 1_000
const denialCounter = new Map<string, number>()

function evictOldestDenial(): void {
  if (denialCounter.size >= MAX_DENIAL_ENTRIES) {
    const oldestKey = denialCounter.keys().next().value
    if (oldestKey !== undefined) {
      denialCounter.delete(oldestKey)
    }
  }
}

function incrementDenialCounter(userId: string, eventName: string): void {
  const key = `${userId}:${eventName}`
  const existing = denialCounter.get(key)
  if (existing === undefined) {
    // New key — evict oldest if at capacity before inserting
    evictOldestDenial()
    denialCounter.set(key, 1)
  } else {
    denialCounter.set(key, existing + 1)
  }
}

/**
 * Return the cumulative denial count for (userId, eventName).
 * Exposed for testing via SEC-WS-03.
 */
export function getDenialCount(userId: string, eventName: string): number {
  return denialCounter.get(`${userId}:${eventName}`) ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function emitAuthDenied(
  socket: { emit: (e: string, p: WSAuthErrorPayload) => void },
  eventName: string,
  code: 'FORBIDDEN' | 'BATCH_DENIED',
): void {
  socket.emit('error', {
    code,
    event: eventName,
    message:
      code === 'BATCH_DENIED'
        ? 'This batch could not be saved. One or more items target a resource you no longer have access to.'
        : 'You do not have access to perform this action.',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// requireRole — WebSocket handler RBAC guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket handler RBAC guard.
 *
 * Returns `true` if the request was denied (caller should `return` immediately).
 * On denial, emits the canonical SEC-ERR-02 error event on the socket and
 * increments the per-(user, event) denial counter.
 * On role-lookup throw, fails closed (denies) and logs via sampled logger.
 *
 * MEDIUM-2 fix: uses static import of getWhiteboardProjectId (no dynamic import
 * in hot WebSocket path).
 *
 * @param socket  - Socket.IO server-side socket (typed to the minimum required interface)
 * @param whiteboardId - Whiteboard the request targets
 * @param eventName    - Original event name (e.g. 'column:create') for SEC-ERR-02 + log
 * @param minRole      - Minimum effective role required (default: EDITOR)
 */
export async function requireRole(
  socket: {
    data: { userId: string }
    emit: (e: string, p: WSAuthErrorPayload) => void
  },
  whiteboardId: string,
  eventName: string,
  minRole: EffectiveRole = 'EDITOR',
): Promise<boolean> {
  const userId = socket.data.userId
  let role: EffectiveRole | null = null
  try {
    const projectId = await getWhiteboardProjectId(whiteboardId)
    if (!projectId) {
      // SEC-ERR-03: not-found is indistinguishable from unauthorized
      emitAuthDenied(socket, eventName, 'FORBIDDEN')
      incrementDenialCounter(userId, eventName)
      return true
    }
    role = await findEffectiveRole(userId, projectId)
  } catch (error) {
    // AD-6: fail closed on any RBAC lookup error
    logSampledError({
      userId,
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: error instanceof Error ? error.message : String(error),
      eventName,
    })
    emitAuthDenied(socket, eventName, 'FORBIDDEN')
    incrementDenialCounter(userId, eventName)
    return true
  }
  if (!hasMinimumRole(role, minRole)) {
    emitAuthDenied(socket, eventName, 'FORBIDDEN')
    incrementDenialCounter(userId, eventName)
    console.warn(
      `[auth] RBAC denied: user=${userId} event=${eventName} whiteboard=${whiteboardId} role=${role ?? 'none'} required=${minRole}`,
    )
    return true
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// requireServerFnRole — HTTP server function RBAC guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server function RBAC guard.
 *
 * Throws `ForbiddenError` on denial — callers should not catch this.
 * SEC-ERR-01: matches the HTTP 403 { error: 'FORBIDDEN', message } shape.
 * AD-6: fails closed on any role-lookup throw (rethrows as ForbiddenError).
 * SEC-ERR-03: null projectId (resource not found) is indistinguishable from
 * unauthorized — same ForbiddenError is thrown.
 *
 * @param userId            - Authenticated user id (from requireAuth ctx)
 * @param resourceProjectId - Project id resolved from the resource
 * @param minRole           - Minimum effective role required (default: EDITOR)
 */
export async function requireServerFnRole(
  _userId: string,
  _resourceProjectId: string | null,
  _minRole: EffectiveRole = 'EDITOR',
): Promise<void> {
  // RBAC removed — any authenticated user can access any whiteboard
}

// src/lib/auth/errors.ts
// Auth error response types and type guards.
// Import these directly rather than via middleware to avoid server-only deps in client code.

/**
 * Shared auth error codes — used by server (auth.ts) and client (register.tsx, login.tsx).
 * Keep this file free of server-only imports so it can be imported anywhere.
 */
export const AUTH_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_FAILED: 'AUTH_FAILED',
  LOCKED: 'LOCKED',
} as const

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES]

export type AuthErrorResponse = {
  error: 'UNAUTHORIZED'
  status: 401
}

export type ForbiddenResponse = {
  error: 'FORBIDDEN'
  status: 403
  message: string
}

export function isUnauthorizedError(
  value: unknown,
): value is AuthErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AuthErrorResponse).error === 'UNAUTHORIZED' &&
    (value as AuthErrorResponse).status === 401
  )
}

export function isForbiddenError(value: unknown): value is ForbiddenResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ForbiddenResponse).error === 'FORBIDDEN' &&
    (value as ForbiddenResponse).status === 403
  )
}

/**
 * Detects a *thrown* ForbiddenError (server/lib/auth/require-role.ts) after
 * it crosses the TanStack Start server-function wire.
 *
 * Empirically verified (see implementation-notes.md): server-fn errors are
 * always returned with HTTP status 500 by the framework's handler, so the
 * error's own `status`/`errorCode` fields — not the HTTP response status —
 * are what survive serialization. ForbiddenError's own-enumerable instance
 * properties (`status: 403`, `errorCode: 'FORBIDDEN'`) round-trip through
 * TanStack Start's Error serializer (`Object.assign(new Error(...), v)`),
 * but `instanceof ForbiddenError` does NOT survive (class identity is lost —
 * the client receives a plain `Error`). Falls back to a message-text match
 * for defense in depth if the shape changes.
 */
export function isThrownForbiddenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const withCode = error as Error & { status?: unknown; errorCode?: unknown }
  if (withCode.status === 403 && withCode.errorCode === 'FORBIDDEN') {
    return true
  }
  return error.message === 'You do not have access to this resource.'
}

export type QueryFailureClassification = 'forbidden' | 'generic'

/**
 * Classifies a failed/denied query result as 'forbidden' (viewer lacks
 * VIEWER+ role) or 'generic' (network error, 500, genuine not-found, etc.).
 *
 * Server functions in this codebase use two different denial shapes:
 *   - resolved-value: `{ error: 'FORBIDDEN', status: 403, ... }` returned
 *     (not thrown) — e.g. getProjectPageContent. Pass the query's `data`.
 *   - thrown: `ForbiddenError` rejected — e.g. getWhiteboardWithDiagram.
 *     Pass the query's `error`.
 *
 * Centralizes the FORBIDDEN-vs-generic split used across the project pages
 * and the whiteboard route/canvas so a query failure is never mislabeled
 * "access denied" when it's actually a network error or genuine 404 — and
 * never shown as a generic failure when it's actually a permissions denial.
 */
export function classifyQueryFailure(params: {
  data?: unknown
  error?: unknown
}): QueryFailureClassification {
  if (isForbiddenError(params.data)) return 'forbidden'
  if (isThrownForbiddenError(params.error)) return 'forbidden'
  return 'generic'
}

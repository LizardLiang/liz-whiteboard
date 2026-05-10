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

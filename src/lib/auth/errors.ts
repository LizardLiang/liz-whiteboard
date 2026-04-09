// src/lib/auth/errors.ts
// Auth error response types and type guards.
// Import these directly rather than via middleware to avoid server-only deps in client code.

export type AuthErrorResponse = {
  error: 'UNAUTHORIZED'
  status: 401
}

export type ForbiddenResponse = {
  error: 'FORBIDDEN'
  status: 403
  message: string
}

export function isUnauthorizedError(value: unknown): value is AuthErrorResponse {
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

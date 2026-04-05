// src/lib/auth/middleware.ts
// requireAuth higher-order function for wrapping createServerFn handlers

import { getRequest } from '@tanstack/react-start/server'
import { getSessionFromCookie } from './cookies'
import type { AuthUser, AuthSession } from './session'

export interface AuthContext {
  user: AuthUser
  session: AuthSession
}

export interface AuthErrorResponse {
  error: 'UNAUTHORIZED'
  status: 401
}

export interface ForbiddenResponse {
  error: 'FORBIDDEN'
  status: 403
  message: string
}

/**
 * Wrap a createServerFn handler with authentication.
 * Extracts the session cookie from the request, validates it, and passes
 * { user, session } to the handler. Returns a 401 response if invalid.
 *
 * Usage:
 * ```ts
 * export const myFn = createServerFn({ method: 'GET' }).handler(
 *   requireAuth(async ({ user }, input) => {
 *     return doSomething(user.id)
 *   })
 * )
 * ```
 */
export function requireAuth<TInput, TResult>(
  handler: (ctx: AuthContext, input: TInput) => Promise<TResult>,
) {
  return async ({
    data,
  }: {
    data: TInput
  }): Promise<TResult | AuthErrorResponse> => {
    const request = getRequest()
    const authResult = await getSessionFromCookie(request)
    if (!authResult) {
      return { error: 'UNAUTHORIZED', status: 401 } as AuthErrorResponse
    }
    return handler(
      { user: authResult.user, session: authResult.session },
      data,
    )
  }
}

/**
 * Type guard to check if a result is an UNAUTHORIZED error
 */
export function isUnauthorizedError(
  result: unknown,
): result is AuthErrorResponse {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    (result as AuthErrorResponse).error === 'UNAUTHORIZED'
  )
}

/**
 * Type guard to check if a result is a FORBIDDEN error
 */
export function isForbiddenError(
  result: unknown,
): result is ForbiddenResponse {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    (result as ForbiddenResponse).error === 'FORBIDDEN'
  )
}

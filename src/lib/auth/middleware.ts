// src/lib/auth/middleware.ts
// requireAuth higher-order function for wrapping createServerFn handlers
// NOTE: This module imports @tanstack/react-start/server — it is SERVER-ONLY.
// Client code should import type guards from '@/lib/auth/errors' instead.

import type { AuthUser, AuthSession } from './session'

// Re-export error types/guards for server-side consumers
export type { AuthErrorResponse, ForbiddenResponse } from './errors'
export { isUnauthorizedError, isForbiddenError } from './errors'

export interface AuthContext {
  user: AuthUser
  session: AuthSession
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
    const { getRequest } = await import('@tanstack/react-start/server')
    const { getSessionFromCookie } = await import('./cookies')
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


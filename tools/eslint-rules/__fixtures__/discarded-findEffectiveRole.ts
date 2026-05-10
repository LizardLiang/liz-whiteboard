// Fixture: discarded findEffectiveRole call — should trigger missingRequiresCall
// Cassandra HIGH-1: The rule must NOT pass when findEffectiveRole is called but
// the result is discarded (never used in a conditional or hasMinimumRole check).
// This pattern acquires a role value but never evaluates it against a threshold,
// leaving RBAC completely absent despite the call appearing in the body.

import { createServerFn } from '@tanstack/react-start'

declare function requireAuth(fn: any): any
declare function findEffectiveRole(
  userId: string,
  projectId: string,
): Promise<string | null>

// VIOLATION: findEffectiveRole called but result discarded, no hasMinimumRole
/**
 * @requires editor
 */
export const discardedRoleFn = createServerFn({ method: 'GET' }).handler(
  requireAuth(async ({ user }: any, projectId: string) => {
    // Call findEffectiveRole but throw away the result — RBAC is bypassed
    await findEffectiveRole(user.id, projectId)
    return { data: 'sensitive data' }
  }),
)

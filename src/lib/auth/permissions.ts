// src/lib/auth/permissions.ts
// Role hierarchy helpers for project-level permissions

const ROLE_HIERARCHY = {
  VIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4,
} as const

type EffectiveRole = keyof typeof ROLE_HIERARCHY

/**
 * Check whether an effective role meets the minimum required role.
 *
 * @param effective - The user's actual role on the project (or null if no access)
 * @param required - The minimum role required for the operation
 * @returns true if effective role >= required role
 */
export function hasMinimumRole(
  effective: EffectiveRole | null,
  required: EffectiveRole,
): boolean {
  if (!effective) return false
  return ROLE_HIERARCHY[effective] >= ROLE_HIERARCHY[required]
}

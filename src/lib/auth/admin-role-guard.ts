// src/lib/auth/admin-role-guard.ts
// ONE policy for every path that sets, changes, or removes a project role:
//
//   Granting or inviting the ADMIN role, and changing or removing an existing
//   ADMIN, requires the caller to be the project OWNER.
//
// An ADMIN may still manage EDITOR and VIEWER members. Used by grantPermission,
// updatePermission, revokePermission, and invite creation, so the four paths
// cannot drift apart again.

import type { EffectiveRole } from '@/data/permission'
import type { ProjectRoleValue } from '@/data/schema'

export interface AdminRoleDenial {
  error: 'FORBIDDEN'
  status: 403
  message: string
}

/**
 * @param actorRole  the caller's effective role on the project
 * @param change.newRole  the role being set; `null` when the member is removed
 * @param change.targetRole  the target's current effective role, or `null`
 *   when the target is not yet a member (grant, invite)
 * @returns a FORBIDDEN payload when the policy denies the change, else null
 */
export function checkAdminRoleChange(
  actorRole: EffectiveRole | null,
  change: {
    newRole: ProjectRoleValue | null
    targetRole: EffectiveRole | null
  },
): AdminRoleDenial | null {
  if (actorRole === 'OWNER') return null
  if (change.newRole === 'ADMIN') {
    return {
      error: 'FORBIDDEN',
      status: 403,
      message: 'Only the project owner can grant the admin role',
    }
  }
  if (change.targetRole === 'ADMIN') {
    return {
      error: 'FORBIDDEN',
      status: 403,
      message:
        change.newRole === null
          ? 'Only the project owner can remove an admin'
          : "Only the project owner can change an admin's role",
    }
  }
  return null
}

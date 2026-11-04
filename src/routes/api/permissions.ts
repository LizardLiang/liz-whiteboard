// src/routes/api/permissions.ts
// Project permission management server functions

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import { hasMinimumRole } from '@/lib/auth/permissions'
import {
  findEffectiveRole,
  findProjectMembers,
  removeProjectMember,
  setProjectMemberRole,
} from '@/data/permission'
import { checkAdminRoleChange } from '@/lib/auth/admin-role-guard'
import { findUserByEmail, findUserById } from '@/data/user'
import { findProjectById } from '@/data/project'
import {
  grantPermissionSchema,
  revokePermissionSchema,
  updatePermissionSchema,
} from '@/data/schema'

/**
 * List all permissions for a project.
 * Requires ADMIN or OWNER effective role.
 *
 * @requires admin
 */
export const listProjectPermissions = createServerFn({ method: 'GET' })
  .validator((projectId: unknown) => {
    if (typeof projectId !== 'string') throw new Error('Invalid projectId')
    return projectId
  })
  .handler(
    requireAuth(async ({ user }, projectId) => {
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'ADMIN')) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: 'Only ADMIN or OWNER can view permissions',
        }
      }

      // Get project owner info
      const project = await findProjectById(projectId)
      const ownerUser = project?.ownerId
        ? await findUserById(project.ownerId)
        : null
      const owner = ownerUser
        ? {
            id: ownerUser.id,
            username: ownerUser.username,
            email: ownerUser.email,
          }
        : null

      const members = await findProjectMembers(projectId)

      return {
        owner,
        members: members.map((m) => ({
          userId: m.userId,
          username: m.user.username,
          email: m.user.email,
          role: m.role,
        })),
      }
    }),
  )

/**
 * Grant a permission to a user by email.
 * Requires ADMIN or OWNER effective role; granting ADMIN requires OWNER.
 *
 * @requires admin
 */
export const grantPermission = createServerFn({ method: 'POST' })
  .validator((data: unknown) => grantPermissionSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      const effectiveRole = await findEffectiveRole(user.id, data.projectId)
      if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: 'Only ADMIN or OWNER can grant permissions',
        }
      }

      // Find target user by email
      const targetUser = await findUserByEmail(data.email)
      if (!targetUser) {
        return {
          error: 'USER_NOT_FOUND' as const,
          status: 404,
          message: 'No user found with that email address',
        }
      }

      // Prevent modifying the owner
      const project = await findProjectById(data.projectId)
      if (project?.ownerId === targetUser.id) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: "Cannot modify the project owner's access",
        }
      }

      // Granting ADMIN, or overwriting an existing ADMIN, needs OWNER.
      const targetRole = await findEffectiveRole(targetUser.id, data.projectId)
      const adminDenial = checkAdminRoleChange(effectiveRole, {
        newRole: data.role,
        targetRole,
      })
      if (adminDenial) return adminDenial

      // Upsert the permission (create or update)
      const member = await setProjectMemberRole({
        projectId: data.projectId,
        userId: targetUser.id,
        role: data.role,
      })

      return { success: true, member }
    }),
  )

/**
 * Update a user's role on a project.
 * Requires ADMIN or OWNER. Only OWNER can change an ADMIN's role.
 *
 * @requires admin
 */
export const updatePermission = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updatePermissionSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      const effectiveRole = await findEffectiveRole(user.id, data.projectId)
      if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: 'Only ADMIN or OWNER can update permissions',
        }
      }

      // The target must be a real user; the owner's access is not editable here.
      const targetUser = await findUserById(data.userId)
      if (!targetUser) {
        return {
          error: 'USER_NOT_FOUND' as const,
          status: 404,
          message: 'No user found with that id',
        }
      }
      const project = await findProjectById(data.projectId)
      if (project?.ownerId === data.userId) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: "Cannot modify the project owner's access",
        }
      }

      // Granting ADMIN, or changing an existing ADMIN, needs OWNER.
      const targetRole = await findEffectiveRole(data.userId, data.projectId)
      const adminDenial = checkAdminRoleChange(effectiveRole, {
        newRole: data.role,
        targetRole,
      })
      if (adminDenial) return adminDenial

      const member = await setProjectMemberRole({
        projectId: data.projectId,
        userId: data.userId,
        role: data.role,
      })

      return { success: true, member }
    }),
  )

/**
 * Revoke a user's permission on a project.
 * Requires ADMIN or OWNER. Rules:
 * - Owner cannot be removed (ownership is on Project.ownerId)
 * - Only OWNER can remove an ADMIN
 *
 * @requires admin
 */
export const revokePermission = createServerFn({ method: 'POST' })
  .validator((data: unknown) => revokePermissionSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      const effectiveRole = await findEffectiveRole(user.id, data.projectId)
      if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: 'Only ADMIN or OWNER can revoke permissions',
        }
      }

      // Prevent removing the owner
      const project = await findProjectById(data.projectId)
      if (project?.ownerId === data.userId) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: "Cannot remove the project owner's access",
        }
      }

      // Only OWNER can remove an ADMIN
      const targetRole = await findEffectiveRole(data.userId, data.projectId)
      const adminDenial = checkAdminRoleChange(effectiveRole, {
        newRole: null,
        targetRole,
      })
      if (adminDenial) return adminDenial

      await removeProjectMember(data.projectId, data.userId)
      return { success: true }
    }),
  )

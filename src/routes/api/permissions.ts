// src/routes/api/permissions.ts
// Project permission management server functions

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import { hasMinimumRole } from '@/lib/auth/permissions'
import {
  createProjectMember,
  deleteProjectMember,
  findEffectiveRole,
  findProjectMembers,
  upsertProjectMember,
} from '@/data/permission'
import { findUserByEmail } from '@/data/user'
import { prisma } from '@/db'
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
  .inputValidator((projectId: unknown) => {
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
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          owner: { select: { id: true, username: true, email: true } },
        },
      })

      const members = await findProjectMembers(projectId)

      return {
        owner: project?.owner ?? null,
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
 * Requires ADMIN or OWNER effective role.
 *
 * @requires admin
 */
export const grantPermission = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => grantPermissionSchema.parse(data))
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
      const project = await prisma.project.findUnique({
        where: { id: data.projectId },
        select: { ownerId: true },
      })
      if (project?.ownerId === targetUser.id) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: "Cannot modify the project owner's access",
        }
      }

      // Upsert the permission (create or update)
      const member = await upsertProjectMember({
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
  .inputValidator((data: unknown) => updatePermissionSchema.parse(data))
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

      // Check if target is an ADMIN — only OWNER can change ADMINs
      const targetRole = await findEffectiveRole(data.userId, data.projectId)
      if (targetRole === 'ADMIN' && effectiveRole !== 'OWNER') {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: "Only the project owner can change an admin's role",
        }
      }

      const member = await upsertProjectMember({
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
  .inputValidator((data: unknown) => revokePermissionSchema.parse(data))
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
      const project = await prisma.project.findUnique({
        where: { id: data.projectId },
        select: { ownerId: true },
      })
      if (project?.ownerId === data.userId) {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: "Cannot remove the project owner's access",
        }
      }

      // Only OWNER can remove an ADMIN
      const targetRole = await findEffectiveRole(data.userId, data.projectId)
      if (targetRole === 'ADMIN' && effectiveRole !== 'OWNER') {
        return {
          error: 'FORBIDDEN' as const,
          status: 403,
          message: 'Only the project owner can remove an admin',
        }
      }

      await deleteProjectMember(data.projectId, data.userId)
      return { success: true }
    }),
  )

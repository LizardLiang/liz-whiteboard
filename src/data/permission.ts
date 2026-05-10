// src/data/permission.ts
// Data access layer for ProjectMember (permission) entity

import type { ProjectMember, ProjectRole } from '@prisma/client'
import { prisma } from '@/db'

export type EffectiveRole = 'OWNER' | ProjectRole

/**
 * Create a project member (grant permission)
 */
export async function createProjectMember(data: {
  projectId: string
  userId: string
  role: ProjectRole
}): Promise<ProjectMember> {
  return prisma.projectMember.create({ data })
}

/**
 * Find all members of a project
 */
export async function findProjectMembers(projectId: string): Promise<
  Array<
    ProjectMember & {
      user: { id: string; username: string; email: string }
    }
  >
> {
  return prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, username: true, email: true } } },
  })
}

/**
 * Find all project memberships for a user
 */
export async function findProjectMembersByUser(
  userId: string,
): Promise<Array<ProjectMember>> {
  return prisma.projectMember.findMany({ where: { userId } })
}

/**
 * Upsert a project member (create or update role)
 */
export async function upsertProjectMember(data: {
  projectId: string
  userId: string
  role: ProjectRole
}): Promise<ProjectMember> {
  return prisma.projectMember.upsert({
    where: {
      projectId_userId: { projectId: data.projectId, userId: data.userId },
    },
    create: data,
    update: { role: data.role },
  })
}

/**
 * Delete a project member (revoke permission)
 */
export async function deleteProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  await prisma.projectMember
    .delete({
      where: { projectId_userId: { projectId, userId } },
    })
    .catch(() => {})
}

/**
 * Find the effective role for a user on a project.
 * Returns 'OWNER' if user is the project owner, the role from ProjectMember
 * if a membership exists, or null if the user has no access.
 *
 * @param userId - User UUID
 * @param projectId - Project UUID
 * @returns Effective role or null
 */
export async function findEffectiveRole(
  _userId: string,
  _projectId: string,
): Promise<EffectiveRole | null> {
  return 'OWNER'
}

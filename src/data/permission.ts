// src/data/permission.ts
// Data access layer for ProjectMember (permission) entity

import type { ProjectMember } from '@/data/models'
import type { ProjectRoleValue as ProjectRole } from '@/data/schema'
import { db, genId, insert, mapProjectMember, nowMs } from '@/db'

export type EffectiveRole = 'OWNER' | ProjectRole

/**
 * ProjectMember joined with a minimal user selection (mirrors the Prisma
 * `include: { user: { select: { id, username, email } } }` shape).
 */
export type ProjectMemberWithUser = ProjectMember & {
  user: { id: string; username: string; email: string }
}

/**
 * Create a project member (grant permission)
 */
export async function createProjectMember(data: {
  projectId: string
  userId: string
  role: ProjectRole
}): Promise<ProjectMember> {
  const id = genId()
  const ts = nowMs()
  insert('ProjectMember', {
    id,
    projectId: data.projectId,
    userId: data.userId,
    role: data.role,
    createdAt: ts,
    updatedAt: ts,
  })
  return mapProjectMember(
    db.prepare('SELECT * FROM "ProjectMember" WHERE "id" = ?').get(id),
  )!
}

/**
 * Find all members of a project
 */
export async function findProjectMembers(
  projectId: string,
): Promise<Array<ProjectMemberWithUser>> {
  const members = db
    .prepare('SELECT * FROM "ProjectMember" WHERE "projectId" = ?')
    .all(projectId)
    .map((r) => mapProjectMember(r)!)

  return members.map((member) => {
    const user = db
      .prepare('SELECT "id", "username", "email" FROM "User" WHERE "id" = ?')
      .get(member.userId)
    return {
      ...member,
      user: {
        id: user!.id as string,
        username: user!.username as string,
        email: user!.email as string,
      },
    }
  })
}

/**
 * Find all project memberships for a user
 */
export async function findProjectMembersByUser(
  userId: string,
): Promise<Array<ProjectMember>> {
  return db
    .prepare('SELECT * FROM "ProjectMember" WHERE "userId" = ?')
    .all(userId)
    .map((r) => mapProjectMember(r)!)
}

/**
 * Upsert a project member (create or update role)
 */
export async function upsertProjectMember(data: {
  projectId: string
  userId: string
  role: ProjectRole
}): Promise<ProjectMember> {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "ProjectMember" ("id", "projectId", "userId", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT("projectId", "userId") DO UPDATE SET "role" = excluded."role", "updatedAt" = excluded."updatedAt"',
  ).run(id, data.projectId, data.userId, data.role, ts, ts)
  return mapProjectMember(
    db
      .prepare(
        'SELECT * FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
      )
      .get(data.projectId, data.userId),
  )!
}

/**
 * Delete a project member (revoke permission)
 */
export async function deleteProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  try {
    db.prepare(
      'DELETE FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
    ).run(projectId, userId)
  } catch {
    // ignore
  }
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
  userId: string,
  projectId: string,
): Promise<EffectiveRole | null> {
  const project = db
    .prepare('SELECT "ownerId" FROM "Project" WHERE "id" = ?')
    .get(projectId) as { ownerId: string | null } | undefined

  if (!project) return null
  if (project.ownerId === userId) return 'OWNER'

  const member = db
    .prepare(
      'SELECT "role" FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
    )
    .get(projectId, userId) as { role: ProjectRole } | undefined

  return member?.role ?? null
}

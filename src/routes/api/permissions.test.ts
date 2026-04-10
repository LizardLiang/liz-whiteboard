// src/routes/api/permissions.test.ts
// Phase 4 permission management tests
// TC-P4-07 through TC-P4-10

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/db'
import {
  deleteProjectMember,
  findEffectiveRole,
  findProjectMembers,
  upsertProjectMember,
} from '@/data/permission'
import { findUserByEmail } from '@/data/user'
import { getSessionFromCookie } from '@/lib/auth/cookies'
import { hasMinimumRole } from '@/lib/auth/permissions'

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
  setResponseHeader: vi.fn(),
}))

vi.mock('@/db', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectMember: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
  createProjectMember: vi.fn(),
  findProjectMembers: vi.fn(),
  upsertProjectMember: vi.fn(),
  deleteProjectMember: vi.fn(),
}))

vi.mock('@/data/user', () => ({
  findUserByEmail: vi.fn(),
}))

vi.mock('@/lib/auth/cookies', () => ({
  getSessionFromCookie: vi.fn(),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const OWNER_ID = 'owner-uuid-0000-0000-000000000001'
const ADMIN_ID = 'admin-uuid-0000-0000-000000000002'
const EDITOR_ID = 'editor-uuid-000-0000-000000000003'
const VIEWER_ID = 'viewer-uuid-000-0000-000000000004'
const TARGET_ID = 'target-uuid-000-0000-000000000005'

const mockOwnerUser = {
  id: OWNER_ID,
  username: 'owner',
  email: 'owner@example.com',
}
const mockAdminUser = {
  id: ADMIN_ID,
  username: 'admin',
  email: 'admin@example.com',
}
const mockTargetUser = {
  id: TARGET_ID,
  username: 'target',
  email: 'target@example.com',
}

// ─────────────────────────────────────────────────────────────────────────────
// Core handler functions that mirror the permission server functions
// (testing logic without the TanStack Start plumbing)
// ─────────────────────────────────────────────────────────────────────────────

async function listProjectPermissionsHandler(
  callerId: string,
  projectId: string,
) {
  const role = await findEffectiveRole(callerId, projectId)
  if (!hasMinimumRole(role, 'ADMIN')) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can view permissions',
    }
  }

  const project = await (prisma.project as any).findUnique({
    where: { id: projectId },
    include: { owner: { select: { id: true, username: true, email: true } } },
  })

  const members = await findProjectMembers(projectId)
  return {
    owner: project?.owner ?? null,
    members: members.map((m: any) => ({
      userId: m.userId,
      username: m.user.username,
      email: m.user.email,
      role: m.role,
    })),
  }
}

async function grantPermissionHandler(
  callerId: string,
  data: { projectId: string; email: string; role: string },
) {
  const effectiveRole = await findEffectiveRole(callerId, data.projectId)
  if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can grant permissions',
    }
  }

  const targetUser = await findUserByEmail(data.email)
  if (!targetUser) {
    return {
      error: 'USER_NOT_FOUND' as const,
      status: 404,
      message: 'No user found with that email address',
    }
  }

  const project = await (prisma.project as any).findUnique({
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

  // Only OWNER can grant ADMIN role
  if (data.role === 'ADMIN' && effectiveRole !== 'OWNER') {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only OWNER can grant ADMIN role',
    }
  }

  const member = await upsertProjectMember({
    projectId: data.projectId,
    userId: targetUser.id,
    role: data.role as any,
  })

  return { success: true, member }
}

async function updatePermissionHandler(
  callerId: string,
  data: { projectId: string; userId: string; role: string },
) {
  const effectiveRole = await findEffectiveRole(callerId, data.projectId)
  if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can update permissions',
    }
  }

  const project = await (prisma.project as any).findUnique({
    where: { id: data.projectId },
    select: { ownerId: true },
  })
  if (project?.ownerId === data.userId) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: "Cannot change the project owner's role",
    }
  }

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
    role: data.role as any,
  })

  return { success: true, member }
}

async function revokePermissionHandler(
  callerId: string,
  data: { projectId: string; userId: string },
) {
  const effectiveRole = await findEffectiveRole(callerId, data.projectId)
  if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can revoke permissions',
    }
  }

  const project = await (prisma.project as any).findUnique({
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
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
    id: PROJECT_ID,
    ownerId: OWNER_ID,
    owner: mockOwnerUser,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-07: grantPermission — ADMIN can add EDITOR; ADMIN cannot add ADMIN
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-07: grantPermission role enforcement', () => {
  it('ADMIN can grant EDITOR role to a new user', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(findUserByEmail).mockResolvedValue(mockTargetUser as any)
    vi.mocked(upsertProjectMember).mockResolvedValue({
      id: 'member-1',
      projectId: PROJECT_ID,
      userId: TARGET_ID,
      role: 'EDITOR',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'EDITOR',
    })

    expect(result).toMatchObject({ success: true })
    expect(upsertProjectMember).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'EDITOR' }),
    )
  })

  it('ADMIN cannot grant ADMIN role (only OWNER can grant ADMIN)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(findUserByEmail).mockResolvedValue(mockTargetUser as any)

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'ADMIN',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(upsertProjectMember).not.toHaveBeenCalled()
  })

  it('OWNER can grant ADMIN role', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')
    vi.mocked(findUserByEmail).mockResolvedValue(mockTargetUser as any)
    vi.mocked(upsertProjectMember).mockResolvedValue({
      id: 'member-1',
      projectId: PROJECT_ID,
      userId: TARGET_ID,
      role: 'ADMIN',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await grantPermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'ADMIN',
    })

    expect(result).toMatchObject({ success: true })
  })

  it('non-ADMIN caller cannot grant any permissions', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')

    const result = await grantPermissionHandler(EDITOR_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'VIEWER',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
  })

  it('returns USER_NOT_FOUND when target email does not exist', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(findUserByEmail).mockResolvedValue(null)

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'nobody@example.com',
      role: 'VIEWER',
    })

    expect(result.error).toBe('USER_NOT_FOUND')
    expect(result.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-08: updatePermission — admin cannot demote owner; only owner can demote admin
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-08: updatePermission role constraints', () => {
  it('ADMIN cannot change OWNER role (owner ID detected from ownerId)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    // Project has OWNER_ID as ownerId
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID,
    })

    const result = await updatePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
      role: 'VIEWER',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(upsertProjectMember).not.toHaveBeenCalled()
  })

  it('ADMIN cannot demote another ADMIN', async () => {
    vi.mocked(findEffectiveRole)
      .mockResolvedValueOnce('ADMIN') // caller's role
      .mockResolvedValueOnce('ADMIN') // target's role

    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID, // target is not the owner
    })

    const result = await updatePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: 'another-admin-uuid',
      role: 'EDITOR',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(upsertProjectMember).not.toHaveBeenCalled()
  })

  it('OWNER can demote another ADMIN', async () => {
    vi.mocked(findEffectiveRole)
      .mockResolvedValueOnce('OWNER') // caller's role
      .mockResolvedValueOnce('ADMIN') // target's role

    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID,
    })

    vi.mocked(upsertProjectMember).mockResolvedValue({
      id: 'member-1',
      projectId: PROJECT_ID,
      userId: ADMIN_ID,
      role: 'EDITOR',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await updatePermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      userId: ADMIN_ID,
      role: 'EDITOR',
    })

    expect(result).toMatchObject({ success: true })
    expect(upsertProjectMember).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'EDITOR' }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-09: revokePermission — owner cannot be removed
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-09: revokePermission — owner protection', () => {
  it('ADMIN cannot remove the project owner', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID,
    })

    const result = await revokePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(result.message).toContain('owner')
    expect(deleteProjectMember).not.toHaveBeenCalled()
  })

  it('OWNER cannot revoke own ownership (owner is not in ProjectMember table)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID,
    })

    const result = await revokePermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(deleteProjectMember).not.toHaveBeenCalled()
  })

  it('ADMIN cannot remove another ADMIN (only OWNER can)', async () => {
    vi.mocked(findEffectiveRole)
      .mockResolvedValueOnce('ADMIN') // caller's role
      .mockResolvedValueOnce('ADMIN') // target's role

    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID,
    })

    const result = await revokePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: 'another-admin-uuid',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(deleteProjectMember).not.toHaveBeenCalled()
  })

  it('OWNER can remove a regular member', async () => {
    vi.mocked(findEffectiveRole)
      .mockResolvedValueOnce('OWNER') // caller's role
      .mockResolvedValueOnce('EDITOR') // target's role

    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: PROJECT_ID,
      ownerId: OWNER_ID,
    })
    vi.mocked(deleteProjectMember).mockResolvedValue()

    const result = await revokePermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
    })

    expect(result).toMatchObject({ success: true })
    expect(deleteProjectMember).toHaveBeenCalledWith(PROJECT_ID, EDITOR_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-10: listProjectPermissions — non-ADMIN/OWNER gets 403
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-10: listProjectPermissions role enforcement', () => {
  it('VIEWER caller gets 403', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')

    const result = await listProjectPermissionsHandler(VIEWER_ID, PROJECT_ID)

    expect(result.error).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
  })

  it('EDITOR caller gets 403', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')

    const result = await listProjectPermissionsHandler(EDITOR_ID, PROJECT_ID)

    expect(result.error).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
  })

  it('null role (no access) caller gets 403', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)

    const result = await listProjectPermissionsHandler(
      'random-user',
      PROJECT_ID,
    )

    expect(result.error).toBe('FORBIDDEN')
  })

  it('ADMIN caller gets the member list', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(findProjectMembers).mockResolvedValue([
      {
        id: 'member-1',
        projectId: PROJECT_ID,
        userId: EDITOR_ID,
        role: 'EDITOR',
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: EDITOR_ID,
          username: 'editor',
          email: 'editor@example.com',
        },
      },
    ] as any)

    const result = await listProjectPermissionsHandler(ADMIN_ID, PROJECT_ID)

    expect(result.error).toBeUndefined()
    expect((result as any).members).toHaveLength(1)
    expect((result as any).members[0].role).toBe('EDITOR')
  })

  it('OWNER caller gets the member list', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')
    vi.mocked(findProjectMembers).mockResolvedValue([])

    const result = await listProjectPermissionsHandler(OWNER_ID, PROJECT_ID)

    expect(result.error).toBeUndefined()
    expect((result as any).members).toHaveLength(0)
  })
})

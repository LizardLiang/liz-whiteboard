// src/routes/api/permissions.test.ts
// Phase 4 permission-management integration tests (TC-P4-07 through TC-P4-10).
//
// These exercise the real permission server-function logic against an in-memory
// SQLite database. The handler functions below mirror the createServerFn
// handlers in permissions.ts; all DB-backed calls are REAL (project/user
// lookups + ProjectMember CRUD). The ONLY mock is `findEffectiveRole`, which is
// currently a non-DB-backed stub (it always returns 'OWNER'), so it is mocked
// to drive the role-based branches the tests cover — exactly the seam the
// original suite controlled.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteProjectMember,
  findEffectiveRole,
  findProjectMembers,
  upsertProjectMember,
} from '@/data/permission'
import { findUserByEmail, findUserById } from '@/data/user'
import { findProjectById } from '@/data/project'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

// Keep the real ProjectMember CRUD; mock only the (stubbed) role resolver.
vi.mock('@/data/permission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/permission')>()
  return {
    ...actual,
    findEffectiveRole: vi.fn(),
  }
})

const mockedFindEffectiveRole = vi.mocked(findEffectiveRole)

// ─────────────────────────────────────────────────────────────────────────────
// Handlers mirroring permissions.ts logic, using the REAL data layer.
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

  const project = await findProjectById(projectId)
  const ownerUser = project?.ownerId
    ? await findUserById(project.ownerId)
    : null
  const owner = ownerUser
    ? { id: ownerUser.id, username: ownerUser.username, email: ownerUser.email }
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

  const project = await findProjectById(data.projectId)
  if (project?.ownerId === targetUser.id) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: "Cannot modify the project owner's access",
    }
  }

  // Only OWNER can grant the ADMIN role.
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

  const project = await findProjectById(data.projectId)
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

  const project = await findProjectById(data.projectId)
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
// Seeded fixtures (real rows)
// ─────────────────────────────────────────────────────────────────────────────

let OWNER_ID = ''
let ADMIN_ID = ''
let EDITOR_ID = ''
let TARGET_ID = ''
let PROJECT_ID = ''

/** Count ProjectMember rows for a project (read-back assertion helper). */
async function memberRole(
  projectId: string,
  userId: string,
): Promise<string | undefined> {
  const members = await findProjectMembers(projectId)
  return members.find((m) => m.userId === userId)?.role
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  OWNER_ID = makeUser({ username: 'owner', email: 'owner@example.com' }).id
  ADMIN_ID = makeUser({ username: 'admin', email: 'admin@example.com' }).id
  EDITOR_ID = makeUser({ username: 'editor', email: 'editor@example.com' }).id
  TARGET_ID = makeUser({ username: 'target', email: 'target@example.com' }).id
  PROJECT_ID = makeProject({ name: 'Test Project', ownerId: OWNER_ID }).id
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-07: grantPermission — ADMIN can add EDITOR; ADMIN cannot add ADMIN
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-07: grantPermission role enforcement', () => {
  it('ADMIN can grant EDITOR role to a new user', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'EDITOR',
    })

    expect(result).toMatchObject({ success: true })
    // Real membership row persisted with the EDITOR role.
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBe('EDITOR')
  })

  it('ADMIN cannot grant ADMIN role (only OWNER can grant ADMIN)', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'ADMIN',
    })

    expect(result.error).toBe('FORBIDDEN')
    // No membership was created.
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBeUndefined()
  })

  it('OWNER can grant ADMIN role', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')

    const result = await grantPermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'ADMIN',
    })

    expect(result).toMatchObject({ success: true })
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBe('ADMIN')
  })

  it('non-ADMIN caller cannot grant any permissions', async () => {
    mockedFindEffectiveRole.mockResolvedValue('EDITOR')

    const result = await grantPermissionHandler(EDITOR_ID, {
      projectId: PROJECT_ID,
      email: 'target@example.com',
      role: 'VIEWER',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBeUndefined()
  })

  it('returns USER_NOT_FOUND when the target email does not exist', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'nobody@example.com',
      role: 'VIEWER',
    })

    expect(result.error).toBe('USER_NOT_FOUND')
    expect(result.status).toBe(404)
  })

  it('cannot grant a permission that targets the project owner', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await grantPermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      email: 'owner@example.com',
      role: 'EDITOR',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(result.message).toContain('owner')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-08: updatePermission — admin cannot demote owner; only owner demotes admin
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-08: updatePermission role constraints', () => {
  it('ADMIN cannot change the OWNER role (detected via project.ownerId)', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await updatePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
      role: 'VIEWER',
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(await memberRole(PROJECT_ID, OWNER_ID)).toBeUndefined()
  })

  it('ADMIN cannot demote another ADMIN', async () => {
    mockedFindEffectiveRole
      .mockResolvedValueOnce('ADMIN') // caller's role
      .mockResolvedValueOnce('ADMIN') // target's role
    // Seed the target admin as an existing ADMIN member.
    await upsertProjectMember({
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
      role: 'ADMIN',
    })

    const result = await updatePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
      role: 'EDITOR',
    })

    expect(result.error).toBe('FORBIDDEN')
    // Role unchanged (still ADMIN).
    expect(await memberRole(PROJECT_ID, EDITOR_ID)).toBe('ADMIN')
  })

  it('OWNER can demote another ADMIN', async () => {
    mockedFindEffectiveRole
      .mockResolvedValueOnce('OWNER') // caller's role
      .mockResolvedValueOnce('ADMIN') // target's role
    await upsertProjectMember({
      projectId: PROJECT_ID,
      userId: ADMIN_ID,
      role: 'ADMIN',
    })

    const result = await updatePermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      userId: ADMIN_ID,
      role: 'EDITOR',
    })

    expect(result).toMatchObject({ success: true })
    expect(await memberRole(PROJECT_ID, ADMIN_ID)).toBe('EDITOR')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-09: revokePermission — owner protection
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-09: revokePermission — owner protection', () => {
  it('ADMIN cannot remove the project owner', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await revokePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
    })

    expect(result.error).toBe('FORBIDDEN')
    expect(result.message).toContain('owner')
  })

  it('OWNER cannot revoke their own ownership', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')

    const result = await revokePermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
    })

    expect(result.error).toBe('FORBIDDEN')
  })

  it('ADMIN cannot remove another ADMIN (only OWNER can)', async () => {
    mockedFindEffectiveRole
      .mockResolvedValueOnce('ADMIN') // caller's role
      .mockResolvedValueOnce('ADMIN') // target's role
    await upsertProjectMember({
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
      role: 'ADMIN',
    })

    const result = await revokePermissionHandler(ADMIN_ID, {
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
    })

    expect(result.error).toBe('FORBIDDEN')
    // Membership still present (not deleted).
    expect(await memberRole(PROJECT_ID, EDITOR_ID)).toBe('ADMIN')
  })

  it('OWNER can remove a regular member', async () => {
    mockedFindEffectiveRole
      .mockResolvedValueOnce('OWNER') // caller's role
      .mockResolvedValueOnce('EDITOR') // target's role
    await upsertProjectMember({
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
      role: 'EDITOR',
    })
    expect(await memberRole(PROJECT_ID, EDITOR_ID)).toBe('EDITOR')

    const result = await revokePermissionHandler(OWNER_ID, {
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
    })

    expect(result).toMatchObject({ success: true })
    // Membership row deleted from the DB.
    expect(await memberRole(PROJECT_ID, EDITOR_ID)).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-10: listProjectPermissions — non-ADMIN/OWNER gets 403
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-10: listProjectPermissions role enforcement', () => {
  it('VIEWER caller gets 403', async () => {
    mockedFindEffectiveRole.mockResolvedValue('VIEWER')

    const result = await listProjectPermissionsHandler(EDITOR_ID, PROJECT_ID)

    expect(result.error).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
  })

  it('EDITOR caller gets 403', async () => {
    mockedFindEffectiveRole.mockResolvedValue('EDITOR')

    const result = await listProjectPermissionsHandler(EDITOR_ID, PROJECT_ID)

    expect(result.error).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
  })

  it('null role (no access) caller gets 403', async () => {
    mockedFindEffectiveRole.mockResolvedValue(null)

    const result = await listProjectPermissionsHandler(TARGET_ID, PROJECT_ID)

    expect(result.error).toBe('FORBIDDEN')
  })

  it('ADMIN caller gets the member list with owner info', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')
    await upsertProjectMember({
      projectId: PROJECT_ID,
      userId: EDITOR_ID,
      role: 'EDITOR',
    })

    const result = await listProjectPermissionsHandler(ADMIN_ID, PROJECT_ID)

    expect(result.error).toBeUndefined()
    expect((result as any).owner.id).toBe(OWNER_ID)
    expect((result as any).members).toHaveLength(1)
    expect((result as any).members[0].role).toBe('EDITOR')
    expect((result as any).members[0].email).toBe('editor@example.com')
  })

  it('OWNER caller gets an (empty) member list', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')

    const result = await listProjectPermissionsHandler(OWNER_ID, PROJECT_ID)

    expect(result.error).toBeUndefined()
    expect((result as any).members).toHaveLength(0)
  })
})

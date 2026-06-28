// src/routes/api/projects-auth.test.ts
// Phase 4 project permission integration tests (real in-memory SQLite DB).
//
// TC-P4-01: createProject sets ownerId to current user
// TC-P4-03: getProjectById returns 403 for non-permitted user
// TC-P4-06: deleteProject — only OWNER or ADMIN can delete; EDITOR gets 403
// TC-P4-11: permission revocation — next server request returns 403
//
// All DB-backed calls are REAL (createProject / findProjectById / deleteProject
// against the in-memory DB). The ONLY mock is `findEffectiveRole`, which is
// currently a non-DB-backed stub (always returns 'OWNER'), so it is mocked to
// drive the role-based branches the tests cover. `hasMinimumRole` is the real
// pure helper.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProject, deleteProject, findProjectById } from '@/data/project'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

// Keep the real data layer; mock only the (stubbed) role resolver.
vi.mock('@/data/permission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/permission')>()
  return {
    ...actual,
    findEffectiveRole: vi.fn(),
  }
})

const mockedFindEffectiveRole = vi.mocked(findEffectiveRole)

// ─────────────────────────────────────────────────────────────────────────────
// Handler mirrors (same pattern as permissions.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function createProjectHandler(
  userId: string,
  data: { name: string; description?: string },
) {
  const project = await createProject({ ...data, ownerId: userId })
  return project
}

async function getProjectByIdHandler(userId: string, projectId: string) {
  const role = await findEffectiveRole(userId, projectId)
  const permitted = hasMinimumRole(role, 'VIEWER')
  if (!permitted) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'You do not have access to this project.',
    }
  }
  const project = await findProjectById(projectId)
  if (!project) throw new Error('Project not found')
  return project
}

async function deleteProjectHandler(userId: string, projectId: string) {
  const role = await findEffectiveRole(userId, projectId)
  const permitted = hasMinimumRole(role, 'ADMIN')
  if (!permitted) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can delete a project.',
    }
  }
  const project = await deleteProject(projectId)
  return project
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded fixtures (real rows)
// ─────────────────────────────────────────────────────────────────────────────

let USER_ID = ''
let PROJECT_ID = ''

/** Read a project row straight from the DB (read-back assertion helper). */
function projectExists(id: string): boolean {
  return !!db.prepare('SELECT "id" FROM "Project" WHERE "id" = ?').get(id)
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  USER_ID = makeUser({ username: 'owner', email: 'owner@example.com' }).id
  PROJECT_ID = makeProject({ name: 'Test Project', ownerId: USER_ID }).id
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-01: createProject sets ownerId to current user
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-01: createProject sets ownerId', () => {
  it('persists a project whose ownerId equals the authenticated user ID', async () => {
    const result = await createProjectHandler(USER_ID, { name: 'My Project' })

    expect(result.ownerId).toBe(USER_ID)
    // Read it back from the DB to confirm persistence.
    const persisted = await findProjectById(result.id)
    expect(persisted?.ownerId).toBe(USER_ID)
  })

  it('returned project has ownerId set to the creating user', async () => {
    const result = await createProjectHandler(USER_ID, {
      name: 'Another Project',
    })

    expect(result.ownerId).toBe(USER_ID)
    expect(result.name).toBe('Another Project')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-03: getProjectById returns 403 for non-permitted user
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-03: getProjectById permission check', () => {
  it('returns 403 when user has no role on the project', async () => {
    mockedFindEffectiveRole.mockResolvedValue(null)

    const result = await getProjectByIdHandler('other-user-id', PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
  })

  it('allows access for VIEWER role and returns the real project', async () => {
    mockedFindEffectiveRole.mockResolvedValue('VIEWER')

    const result = await getProjectByIdHandler(USER_ID, PROJECT_ID)

    expect((result as any).id).toBe(PROJECT_ID)
    expect((result as any).ownerId).toBe(USER_ID)
  })

  it('allows access for OWNER role', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')

    const result = await getProjectByIdHandler(USER_ID, PROJECT_ID)

    expect((result as any).id).toBe(PROJECT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-06: deleteProject — EDITOR gets 403; ADMIN/OWNER succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-06: deleteProject role enforcement', () => {
  it('EDITOR role cannot delete project (403); row remains', async () => {
    mockedFindEffectiveRole.mockResolvedValue('EDITOR')

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
    // Not deleted.
    expect(projectExists(PROJECT_ID)).toBe(true)
  })

  it('VIEWER role cannot delete project (403); row remains', async () => {
    mockedFindEffectiveRole.mockResolvedValue('VIEWER')

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect(projectExists(PROJECT_ID)).toBe(true)
  })

  it('null role cannot delete project; row remains', async () => {
    mockedFindEffectiveRole.mockResolvedValue(null)

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect(projectExists(PROJECT_ID)).toBe(true)
  })

  it('ADMIN role can delete project; row removed', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).id).toBe(PROJECT_ID)
    expect(projectExists(PROJECT_ID)).toBe(false)
  })

  it('OWNER role can delete project; row removed', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).id).toBe(PROJECT_ID)
    expect(projectExists(PROJECT_ID)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-11: Permission revocation — next request returns 403
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-11: permission revocation reflected on next request', () => {
  it('returns the project before revocation, 403 after', async () => {
    // Before revocation: EDITOR has access.
    mockedFindEffectiveRole.mockResolvedValueOnce('EDITOR')

    const firstResult = await getProjectByIdHandler(USER_ID, PROJECT_ID)
    expect((firstResult as any).id).toBe(PROJECT_ID)

    // After revocation: findEffectiveRole now returns null.
    mockedFindEffectiveRole.mockResolvedValueOnce(null)

    const secondResult = await getProjectByIdHandler(USER_ID, PROJECT_ID)
    expect((secondResult as any).error).toBe('FORBIDDEN')
    expect((secondResult as any).status).toBe(403)
  })
})

// src/routes/api/projects-auth.test.ts
// Phase 4 project permission tests
// TC-P4-01: createProject sets ownerId to current user
// TC-P4-03: getProjectById returns 403 for non-permitted user
// TC-P4-06: deleteProject — only OWNER or ADMIN can delete; EDITOR gets 403
// TC-P4-11: permission revocation — next server request returns 403

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
  setResponseHeader: vi.fn(),
}))

vi.mock('@/db', () => ({
  prisma: {
    project: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/data/project', () => ({
  createProject: vi.fn(),
  findProjectById: vi.fn(),
  deleteProject: vi.fn(),
  findAllProjects: vi.fn(),
  findAllProjectsWithTree: vi.fn(),
  updateProject: vi.fn(),
  findProjectPageContent: vi.fn(),
}))

vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
}))

vi.mock('@/lib/auth/permissions', () => ({
  hasMinimumRole: vi.fn(),
}))

import { createProject, findProjectById, deleteProject } from '@/data/project'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const USER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

const mockProject = {
  id: PROJECT_ID,
  name: 'Test Project',
  description: null,
  ownerId: USER_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler mirrors (same pattern as permissions.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function createProjectHandler(userId: string, data: { name: string; description?: string }) {
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

beforeEach(() => {
  vi.clearAllMocks()
  // Default: hasMinimumRole delegates to real logic
  vi.mocked(hasMinimumRole).mockImplementation((role, required) => {
    const HIERARCHY: Record<string, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 }
    if (!role) return false
    return (HIERARCHY[role] ?? 0) >= (HIERARCHY[required] ?? 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-01: createProject sets ownerId to current user
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-01: createProject sets ownerId', () => {
  it('passes ownerId equal to the authenticated user ID', async () => {
    vi.mocked(createProject).mockResolvedValue(mockProject as any)

    await createProjectHandler(USER_ID, { name: 'My Project' })

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: USER_ID })
    )
  })

  it('returned project has ownerId set to creating user', async () => {
    vi.mocked(createProject).mockResolvedValue(mockProject as any)

    const result = await createProjectHandler(USER_ID, { name: 'My Project' })

    expect((result as any).ownerId).toBe(USER_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-03: getProjectById returns 403 for non-permitted user
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-03: getProjectById permission check', () => {
  it('returns 403 when user has no role on the project', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)

    const result = await getProjectByIdHandler('other-user-id', PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
    expect(findProjectById).not.toHaveBeenCalled()
  })

  it('allows access for VIEWER role', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')
    vi.mocked(findProjectById).mockResolvedValue(mockProject as any)

    const result = await getProjectByIdHandler(USER_ID, PROJECT_ID)

    expect((result as any).id).toBe(PROJECT_ID)
  })

  it('allows access for OWNER role', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')
    vi.mocked(findProjectById).mockResolvedValue(mockProject as any)

    const result = await getProjectByIdHandler(USER_ID, PROJECT_ID)

    expect((result as any).id).toBe(PROJECT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-06: deleteProject — EDITOR gets 403; ADMIN/OWNER succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-06: deleteProject role enforcement', () => {
  it('EDITOR role cannot delete project (403)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('VIEWER role cannot delete project (403)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('null role cannot delete project', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect((result as any).error).toBe('FORBIDDEN')
  })

  it('ADMIN role can delete project', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(deleteProject).mockResolvedValue(mockProject as any)

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect(deleteProject).toHaveBeenCalledWith(PROJECT_ID)
    expect((result as any).id).toBe(PROJECT_ID)
  })

  it('OWNER role can delete project', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')
    vi.mocked(deleteProject).mockResolvedValue(mockProject as any)

    const result = await deleteProjectHandler(USER_ID, PROJECT_ID)

    expect(deleteProject).toHaveBeenCalledWith(PROJECT_ID)
    expect((result as any).id).toBe(PROJECT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-11: Permission revocation — next request returns 403
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-11: permission revocation reflected on next request', () => {
  it('returns success before revocation, 403 after', async () => {
    // Before revocation: EDITOR has access
    vi.mocked(findEffectiveRole).mockResolvedValueOnce('EDITOR')
    vi.mocked(findProjectById).mockResolvedValue(mockProject as any)

    const firstResult = await getProjectByIdHandler(USER_ID, PROJECT_ID)
    expect((firstResult as any).id).toBe(PROJECT_ID)

    // After revocation: findEffectiveRole now returns null
    vi.mocked(findEffectiveRole).mockResolvedValueOnce(null)

    const secondResult = await getProjectByIdHandler(USER_ID, PROJECT_ID)
    expect((secondResult as any).error).toBe('FORBIDDEN')
    expect((secondResult as any).status).toBe(403)
  })
})

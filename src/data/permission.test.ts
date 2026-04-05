// src/data/permission.test.ts
// Unit tests for permission data-access functions (TC-P1-07)

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { prisma } from '@/db'
import { findEffectiveRole } from './permission'

describe('permission data-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('TC-P1-07: findEffectiveRole', () => {
    it('returns OWNER when userId matches project ownerId', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        ownerId: 'user-A',
      } as any)

      const role = await findEffectiveRole('user-A', 'project-1')

      expect(role).toBe('OWNER')
    })

    it('returns ProjectMember role when userId does not match ownerId', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        ownerId: 'user-B',
      } as any)
      vi.mocked(prisma.projectMember.findUnique).mockResolvedValue({
        role: 'EDITOR',
      } as any)

      const role = await findEffectiveRole('user-A', 'project-1')

      expect(role).toBe('EDITOR')
    })

    it('returns null when no membership found', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        ownerId: 'user-B',
      } as any)
      vi.mocked(prisma.projectMember.findUnique).mockResolvedValue(null)

      const role = await findEffectiveRole('user-C', 'project-1')

      expect(role).toBeNull()
    })

    it('returns null when project does not exist', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

      const role = await findEffectiveRole('user-A', 'nonexistent-project')

      expect(role).toBeNull()
    })
  })
})

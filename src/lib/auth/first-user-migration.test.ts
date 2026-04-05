// src/lib/auth/first-user-migration.test.ts
// Unit tests for first-user data migration (TC-P2-09 through TC-P2-10)

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  prisma: {
    project: {
      updateMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/db'
import { migrateDataToFirstUser } from './first-user-migration'

describe('migrateDataToFirstUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-P2-09: assigns all ownerless projects
  it('TC-P2-09: assigns all ownerless projects to the first user', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 3 })

    await migrateDataToFirstUser('first-user-uuid')

    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { ownerId: null },
      data: { ownerId: 'first-user-uuid' },
    })
  })

  // TC-P2-10: idempotent — already-owned projects untouched
  it('TC-P2-10: uses where: { ownerId: null } to filter only ownerless projects', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 })

    await migrateDataToFirstUser('user-uuid')
    await migrateDataToFirstUser('user-uuid')

    // Both calls use the same filter — only affects ownerless rows
    expect(prisma.project.updateMany).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(prisma.project.updateMany).mock.calls) {
      expect((call[0] as any).where).toEqual({ ownerId: null })
    }
  })

  it('TC-P2-10: does not throw on second invocation', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 })

    await expect(migrateDataToFirstUser('user-uuid')).resolves.not.toThrow()
    await expect(migrateDataToFirstUser('user-uuid')).resolves.not.toThrow()
  })
})

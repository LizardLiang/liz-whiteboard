// src/data/session.test.ts
// Unit tests for auth session data-access functions (TC-P1-06)

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAuthSession,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  findAuthSessionByTokenHash,
} from './session'
import { prisma } from '@/db'

vi.mock('@/db', () => ({
  prisma: {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

const mockSession = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  tokenHash: 'abc123def456'.padEnd(64, '0'),
  userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date(),
}

describe('session data-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('TC-P1-06: createAuthSession', () => {
    it('calls prisma.session.create with correct fields', async () => {
      vi.mocked(prisma.session.create).mockResolvedValue(mockSession as any)

      await createAuthSession({
        tokenHash: mockSession.tokenHash,
        userId: mockSession.userId,
        expiresAt: mockSession.expiresAt,
      })

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: {
          tokenHash: mockSession.tokenHash,
          userId: mockSession.userId,
          expiresAt: mockSession.expiresAt,
        },
      })
    })
  })

  describe('TC-P1-06: findAuthSessionByTokenHash', () => {
    it('queries session by tokenHash with user include', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue(mockSession as any)

      await findAuthSessionByTokenHash(mockSession.tokenHash)

      expect(prisma.session.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: mockSession.tokenHash },
        }),
      )
    })

    it('returns null when session not found', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue(null)

      const result = await findAuthSessionByTokenHash('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('TC-P1-06: deleteAuthSession', () => {
    it('calls prisma.session.delete with session id', async () => {
      vi.mocked(prisma.session.delete).mockResolvedValue(mockSession as any)

      await deleteAuthSession(mockSession.id)

      expect(prisma.session.delete).toHaveBeenCalledWith({
        where: { id: mockSession.id },
      })
    })
  })

  describe('TC-P1-06: deleteExpiredAuthSessions', () => {
    it('calls prisma.session.deleteMany with expiresAt lt current time', async () => {
      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 0 })

      await deleteExpiredAuthSessions()

      expect(prisma.session.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
          },
        }),
      )
    })
  })
})

// src/lib/auth/rate-limit.test.ts
// Unit tests for account lockout rate limiting (TC-P2-14 through TC-P2-16)

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkLockout, clearLockout, recordFailedLogin } from './rate-limit'
import { prisma } from '@/db'

vi.mock('@/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe('rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-P2-14: locked after 5 failed attempts
  describe('TC-P2-14: lockout after 5 failures', () => {
    it('sets lockedUntil when reaching 5 failed attempts', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        failedLoginAttempts: 4,
        lockedUntil: null,
      } as any)
      vi.mocked(prisma.user.update).mockResolvedValue({} as any)

      await recordFailedLogin('alice@example.com')

      // Implementation increments in JS then writes absolute value (not Prisma increment)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            failedLoginAttempts: 5,
            lockedUntil: expect.any(Date),
          }),
        }),
      )

      const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0]
      const lockedUntil = (updateCall.data as any).lockedUntil as Date
      const expectedMinLock = Date.now() + 14 * 60 * 1000 // at least 14 minutes
      expect(lockedUntil.getTime()).toBeGreaterThan(expectedMinLock)
    })

    it('checkLockout returns locked=true when lockedUntil is in the future', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000) // 10 min from now
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        failedLoginAttempts: 5,
        lockedUntil: futureDate,
      } as any)

      const result = await checkLockout('alice@example.com')

      expect(result.locked).toBe(true)
      if (result.locked) {
        expect(result.unlocksAt).toBeInstanceOf(Date)
        expect(result.unlocksAt!.getTime()).toBeGreaterThan(Date.now())
      }
    })
  })

  // TC-P2-15: lockout expires after 15 minutes
  describe('TC-P2-15: lockout expiry', () => {
    it('returns locked=false when lockedUntil is in the past', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000) // 1 minute ago
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        failedLoginAttempts: 5,
        lockedUntil: pastDate,
      } as any)

      const result = await checkLockout('alice@example.com')

      expect(result.locked).toBe(false)
    })

    it('returns locked=false when lockedUntil is null', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        failedLoginAttempts: 0,
        lockedUntil: null,
      } as any)

      const result = await checkLockout('alice@example.com')

      expect(result.locked).toBe(false)
    })
  })

  // TC-P2-16: no attempt recorded for non-existent email
  describe('TC-P2-16: anti-enumeration — no lockout for non-existent email', () => {
    it('does not call prisma.user.update when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      await recordFailedLogin('notexist@example.com')

      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('checkLockout returns locked=false for non-existent email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const result = await checkLockout('ghost@example.com')

      expect(result.locked).toBe(false)
    })
  })

  describe('clearLockout', () => {
    it('resets failedLoginAttempts and lockedUntil to null', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({} as any)

      await clearLockout('user-id-1')

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      })
    })
  })
})

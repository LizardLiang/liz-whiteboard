// src/data/user.test.ts
// Unit tests for user data-access functions (TC-P1-05)

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createUser, findUserByEmail, findUserById } from './user'
import { prisma } from '@/db'

// Mock the db module before imports that use it
vi.mock('@/db', () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}))

const mockUser = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  username: 'alice',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hashedpassword',
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

describe('user data-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('TC-P1-05: createUser', () => {
    it('calls prisma.user.create with correct fields', async () => {
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser as any)

      const result = await createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$12$hashedpassword',
      })

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          username: 'alice',
          email: 'alice@example.com',
          passwordHash: '$2b$12$hashedpassword',
        },
      })
      expect(result).toEqual(mockUser)
    })
  })

  describe('TC-P1-05: findUserByEmail', () => {
    it('returns user when found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await findUserByEmail('alice@example.com')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      })
      expect(result).toEqual(mockUser)
    })

    it('returns null when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const result = await findUserByEmail('notfound@example.com')

      expect(result).toBeNull()
    })
  })

  describe('TC-P1-05: findUserById', () => {
    it('returns user when found by ID', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await findUserById('f47ac10b-58cc-4372-a567-0e02b2c3d479')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
      })
      expect(result).toEqual(mockUser)
    })

    it('returns null when user not found by ID', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const result = await findUserById('00000000-0000-0000-0000-000000000000')

      expect(result).toBeNull()
    })
  })
})

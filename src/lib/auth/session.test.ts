// src/lib/auth/session.test.ts
// Unit tests for session token generation and validation (TC-P2-04 through TC-P2-08)

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createUserSession,
  generateSessionToken,
  hashToken,
  validateSessionToken,
} from './session'
import { prisma } from '@/db'

vi.mock('@/db', () => ({
  prisma: {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

const mockUser = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  username: 'alice',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hashed',
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('session token', () => {
  // TC-P2-04: generateSessionToken does not use crypto.randomUUID
  describe('TC-P2-04: generateSessionToken', () => {
    it('returns a 64-character hex string', () => {
      const token = generateSessionToken()

      expect(token).toHaveLength(64)
      expect(token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns different tokens on each call', () => {
      const t1 = generateSessionToken()
      const t2 = generateSessionToken()

      expect(t1).not.toBe(t2)
    })

    it('is NOT a UUID format (confirms randomBytes not randomUUID)', () => {
      const token = generateSessionToken()
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

      expect(token).not.toMatch(uuidPattern)
    })
  })

  // TC-P2-04: hashToken
  describe('hashToken', () => {
    it('returns a 64-character SHA-256 hex string', () => {
      const hash = hashToken('sometoken')

      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('is deterministic for the same input', () => {
      expect(hashToken('abc')).toBe(hashToken('abc'))
    })

    it('differs for different inputs', () => {
      expect(hashToken('abc')).not.toBe(hashToken('def'))
    })
  })
})

describe('session management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-P2-05: createUserSession stores tokenHash not raw token
  describe('TC-P2-05: createUserSession', () => {
    it('stores tokenHash (SHA-256 of raw token) not the raw token', async () => {
      vi.mocked(prisma.session.create).mockResolvedValue({
        id: 'session-id',
        tokenHash: 'hash',
        userId: 'user',
        expiresAt: new Date(),
        createdAt: new Date(),
      } as any)

      const { token } = await createUserSession('user-uuid', false)

      const createCall = vi.mocked(prisma.session.create).mock.calls[0][0]
      const { tokenHash } = createCall.data as { tokenHash: string }

      // tokenHash must be 64 chars (SHA-256)
      expect(tokenHash).toHaveLength(64)
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)

      // raw token must differ from tokenHash
      expect(token).not.toBe(tokenHash)

      // SHA-256(token) must equal tokenHash
      const expectedHash = createHash('sha256').update(token).digest('hex')
      expect(tokenHash).toBe(expectedHash)
    })
  })

  // TC-P2-07: default expiry is 24 hours
  describe('TC-P2-07: createUserSession default expiry (24h)', () => {
    it('sets expiresAt to approximately 24 hours from now', async () => {
      vi.mocked(prisma.session.create).mockResolvedValue({
        id: 'session-id',
        tokenHash: 'hash',
        userId: 'user',
        expiresAt: new Date(),
        createdAt: new Date(),
      } as any)

      const before = Date.now()
      await createUserSession('user-uuid', false)
      const after = Date.now()

      const createCall = vi.mocked(prisma.session.create).mock.calls[0][0]
      const { expiresAt } = createCall.data as { expiresAt: Date }

      const expectedMs = 24 * 60 * 60 * 1000
      const expiresMs = expiresAt.getTime()

      expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - 1000)
      expect(expiresMs).toBeLessThanOrEqual(after + expectedMs + 1000)
    })
  })

  // TC-P2-08: rememberMe expiry is 30 days
  describe('TC-P2-08: createUserSession rememberMe expiry (30 days)', () => {
    it('sets expiresAt to approximately 30 days from now when rememberMe=true', async () => {
      vi.mocked(prisma.session.create).mockResolvedValue({
        id: 'session-id',
        tokenHash: 'hash',
        userId: 'user',
        expiresAt: new Date(),
        createdAt: new Date(),
      } as any)

      const before = Date.now()
      await createUserSession('user-uuid', true)
      const after = Date.now()

      const createCall = vi.mocked(prisma.session.create).mock.calls[0][0]
      const { expiresAt } = createCall.data as { expiresAt: Date }

      const expectedMs = 30 * 24 * 60 * 60 * 1000
      const expiresMs = expiresAt.getTime()

      expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - 1000)
      expect(expiresMs).toBeLessThanOrEqual(after + expectedMs + 1000)
    })
  })

  // TC-P2-06: validateSessionToken returns null for expired session
  describe('TC-P2-06: validateSessionToken', () => {
    it('returns null and deletes expired session', async () => {
      const expiredSession = {
        id: 'session-id',
        tokenHash: 'hash',
        userId: 'user-id',
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
        createdAt: new Date(),
        user: mockUser,
      }
      vi.mocked(prisma.session.findUnique).mockResolvedValue(
        expiredSession as any,
      )
      vi.mocked(prisma.session.delete).mockResolvedValue(expiredSession as any)

      const result = await validateSessionToken('sometoken')

      expect(result).toBeNull()
      expect(prisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-id' },
      })
    })

    it('returns null for unknown token without calling delete', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue(null)

      const result = await validateSessionToken('unknowntoken')

      expect(result).toBeNull()
      expect(prisma.session.delete).not.toHaveBeenCalled()
    })

    it('returns user and session for valid non-expired session', async () => {
      const validSession = {
        id: 'session-id',
        tokenHash: 'hash',
        userId: mockUser.id,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
        createdAt: new Date(),
        user: mockUser,
      }
      vi.mocked(prisma.session.findUnique).mockResolvedValue(
        validSession as any,
      )

      const result = await validateSessionToken('validtoken')

      expect(result).not.toBeNull()
      expect(result?.user.id).toBe(mockUser.id)
      expect(result?.session.id).toBe('session-id')
    })
  })
})

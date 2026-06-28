// src/lib/auth/session.test.ts
// Integration tests for session token generation and validation
// (TC-P2-04 through TC-P2-08) against a real in-memory SQLite database.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createUserSession,
  generateSessionToken,
  hashToken,
  validateSessionToken,
} from './session'
import { db } from '@/db'
import { createAuthSession } from '@/data/session'
import { makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => resetDb())

// Read a Session row directly from the DB by its token hash.
function findSessionRowByHash(tokenHash: string) {
  return db
    .prepare('SELECT * FROM "Session" WHERE "tokenHash" = ?')
    .get(tokenHash) as
    | { id: string; tokenHash: string; userId: string; expiresAt: number }
    | undefined
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
  // TC-P2-05: createUserSession stores tokenHash not raw token
  describe('TC-P2-05: createUserSession', () => {
    it('stores tokenHash (SHA-256 of raw token) not the raw token', async () => {
      const { id: userId } = makeUser()

      const { token, session } = await createUserSession(userId, false)

      // The raw token must NOT be present in the DB; only its hash is stored.
      const expectedHash = createHash('sha256').update(token).digest('hex')
      const row = findSessionRowByHash(expectedHash)

      expect(row).toBeDefined()
      expect(row!.tokenHash).toHaveLength(64)
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(row!.tokenHash).toBe(expectedHash)
      // Raw token differs from the stored hash, and the raw token is not stored.
      expect(token).not.toBe(row!.tokenHash)
      expect(findSessionRowByHash(token)).toBeUndefined()
      // Returned session id matches the persisted row.
      expect(session.id).toBe(row!.id)
      expect(row!.userId).toBe(userId)
    })
  })

  // TC-P2-07: default expiry is 24 hours
  describe('TC-P2-07: createUserSession default expiry (24h)', () => {
    it('sets expiresAt to approximately 24 hours from now', async () => {
      const { id: userId } = makeUser()

      const before = Date.now()
      const { session } = await createUserSession(userId, false)
      const after = Date.now()

      const expectedMs = 24 * 60 * 60 * 1000
      const expiresMs = session.expiresAt.getTime()

      expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - 1000)
      expect(expiresMs).toBeLessThanOrEqual(after + expectedMs + 1000)
    })
  })

  // TC-P2-08: rememberMe expiry is 30 days
  describe('TC-P2-08: createUserSession rememberMe expiry (30 days)', () => {
    it('sets expiresAt to approximately 30 days from now when rememberMe=true', async () => {
      const { id: userId } = makeUser()

      const before = Date.now()
      const { session } = await createUserSession(userId, true)
      const after = Date.now()

      const expectedMs = 30 * 24 * 60 * 60 * 1000
      const expiresMs = session.expiresAt.getTime()

      expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - 1000)
      expect(expiresMs).toBeLessThanOrEqual(after + expectedMs + 1000)
    })
  })

  // TC-P2-06: validateSessionToken returns null for expired session
  describe('TC-P2-06: validateSessionToken', () => {
    it('returns null and deletes an expired session', async () => {
      const { id: userId } = makeUser()

      // Seed an already-expired session directly via the data layer.
      const rawToken = generateSessionToken()
      const tokenHash = hashToken(rawToken)
      const session = await createAuthSession({
        tokenHash,
        userId,
        expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
      })
      expect(findSessionRowByHash(tokenHash)).toBeDefined()

      const result = await validateSessionToken(rawToken)

      expect(result).toBeNull()
      // Lazy expiry: the expired row must have been deleted from the DB.
      expect(findSessionRowByHash(tokenHash)).toBeUndefined()
      expect(
        db.prepare('SELECT * FROM "Session" WHERE "id" = ?').get(session.id),
      ).toBeUndefined()
    })

    it('returns null for an unknown token and leaves other sessions intact', async () => {
      const { id: userId } = makeUser()
      // A valid, unrelated session that must survive the unknown-token lookup.
      const { token: goodToken } = await createUserSession(userId, false)
      const goodHash = hashToken(goodToken)

      const result = await validateSessionToken('unknowntoken')

      expect(result).toBeNull()
      // No deletion happened: the unrelated valid session is still present.
      expect(findSessionRowByHash(goodHash)).toBeDefined()
    })

    it('returns the user and session for a valid non-expired session', async () => {
      const { id: userId } = makeUser({
        username: 'alice',
        email: 'alice@example.com',
      })

      const { token, session } = await createUserSession(userId, false)

      const result = await validateSessionToken(token)

      expect(result).not.toBeNull()
      expect(result?.user.id).toBe(userId)
      expect(result?.user.username).toBe('alice')
      expect(result?.user.email).toBe('alice@example.com')
      expect(result?.session.id).toBe(session.id)
      // The expiry is returned as a Date (mapper output).
      expect(result?.session.expiresAt).toBeInstanceOf(Date)
    })

    it('keeps a valid session in the DB after validation', async () => {
      const { id: userId } = makeUser()
      const { token } = await createUserSession(userId, false)
      const hash = hashToken(token)

      await validateSessionToken(token)

      expect(findSessionRowByHash(hash)).toBeDefined()
    })
  })
})

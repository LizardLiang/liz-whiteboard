// src/data/session.test.ts
// Integration tests for auth session data-access functions (TC-P1-06).
// Runs against an in-memory SQLite DB (vitest.config sets DATABASE_URL=:memory:).

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createAuthSession,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  findAuthSessionByTokenHash,
} from './session'
import { db } from '@/db'
import { makeUser, resetDb } from '@/test/db-helpers'

const tokenHash = 'abc123def456'.padEnd(64, '0')

describe('session data-access', () => {
  beforeEach(() => resetDb())

  describe('TC-P1-06: createAuthSession', () => {
    it('persists a session with the given fields and returns the mapped row', async () => {
      const user = makeUser()
      const expiresAt = new Date(Date.now() + 86400000)

      const session = await createAuthSession({
        tokenHash,
        userId: user.id,
        expiresAt,
      })

      expect(session.id).toEqual(expect.any(String))
      expect(session.tokenHash).toBe(tokenHash)
      expect(session.userId).toBe(user.id)
      // Dates round-trip through the unix-ms storage format.
      expect(session.expiresAt).toBeInstanceOf(Date)
      expect(session.expiresAt.getTime()).toBe(expiresAt.getTime())
      expect(session.createdAt).toBeInstanceOf(Date)

      // Confirm it was actually written.
      const row = db
        .prepare('SELECT * FROM "Session" WHERE "id" = ?')
        .get(session.id) as Record<string, unknown>
      expect(row.tokenHash).toBe(tokenHash)
      expect(row.userId).toBe(user.id)
    })
  })

  describe('TC-P1-06: findAuthSessionByTokenHash', () => {
    it('returns the session joined with a minimal user when found', async () => {
      const user = makeUser({ username: 'carol', email: 'carol@example.com' })
      await createAuthSession({
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      })

      const result = await findAuthSessionByTokenHash(tokenHash)

      expect(result).not.toBeNull()
      expect(result?.tokenHash).toBe(tokenHash)
      expect(result?.userId).toBe(user.id)
      // Nested user shape (mirrors Prisma include: { user: { select } }).
      expect(result?.user).toEqual({
        id: user.id,
        username: 'carol',
        email: 'carol@example.com',
      })
    })

    it('returns null when no session has that token hash', async () => {
      const result = await findAuthSessionByTokenHash('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('TC-P1-06: deleteAuthSession', () => {
    it('removes the session with the given id', async () => {
      const user = makeUser()
      const session = await createAuthSession({
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      })

      await deleteAuthSession(session.id)

      const row = db
        .prepare('SELECT * FROM "Session" WHERE "id" = ?')
        .get(session.id)
      expect(row).toBeUndefined()
      expect(await findAuthSessionByTokenHash(tokenHash)).toBeNull()
    })
  })

  describe('TC-P1-06: deleteExpiredAuthSessions', () => {
    it('deletes only sessions whose expiresAt is in the past and returns the count', async () => {
      const user = makeUser()
      const now = Date.now()

      // Two expired, one still valid.
      await createAuthSession({
        tokenHash: 'expired1'.padEnd(64, '0'),
        userId: user.id,
        expiresAt: new Date(now - 1000),
      })
      await createAuthSession({
        tokenHash: 'expired2'.padEnd(64, '0'),
        userId: user.id,
        expiresAt: new Date(now - 50000),
      })
      const valid = await createAuthSession({
        tokenHash: 'valid'.padEnd(64, '0'),
        userId: user.id,
        expiresAt: new Date(now + 86400000),
      })

      const deleted = await deleteExpiredAuthSessions()

      expect(deleted).toBe(2)
      // The valid session survives.
      const remaining = db
        .prepare('SELECT "id" FROM "Session"')
        .all() as Array<{ id: string }>
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(valid.id)
    })

    it('returns 0 when there are no expired sessions', async () => {
      const user = makeUser()
      await createAuthSession({
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      })

      expect(await deleteExpiredAuthSessions()).toBe(0)
    })
  })
})

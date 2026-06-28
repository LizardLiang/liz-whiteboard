// src/lib/auth/rate-limit.test.ts
// Integration tests for account lockout rate limiting (TC-P2-14 through TC-P2-16).
// Runs against an in-memory SQLite DB. lockedUntil is stored as unix-ms or null.

import { beforeEach, describe, expect, it } from 'vitest'

import { checkLockout, clearLockout, recordFailedLogin } from './rate-limit'
import { db } from '@/db'
import { makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => resetDb())

function lockoutRow(id: string): {
  failedLoginAttempts: number
  lockedUntil: number | null
} {
  return db
    .prepare(
      'SELECT "failedLoginAttempts", "lockedUntil" FROM "User" WHERE "id" = ?',
    )
    .get(id) as { failedLoginAttempts: number; lockedUntil: number | null }
}

describe('rate limiting', () => {
  // TC-P2-14: locked after 5 failed attempts
  describe('TC-P2-14: lockout after 5 failures', () => {
    it('increments the counter on each failed login', async () => {
      const email = 'alice@example.com'
      const user = makeUser({ email })

      await recordFailedLogin(email)
      expect(lockoutRow(user.id).failedLoginAttempts).toBe(1)

      await recordFailedLogin(email)
      expect(lockoutRow(user.id).failedLoginAttempts).toBe(2)
    })

    it('sets lockedUntil ~15 min in the future when reaching 5 attempts', async () => {
      const email = 'alice@example.com'
      const user = makeUser({ email })

      for (let i = 0; i < 5; i++) await recordFailedLogin(email)

      const row = lockoutRow(user.id)
      expect(row.failedLoginAttempts).toBe(5)
      expect(row.lockedUntil).not.toBeNull()
      // at least 14 minutes out
      expect(row.lockedUntil!).toBeGreaterThan(Date.now() + 14 * 60 * 1000)
    })

    it('checkLockout returns locked=true when lockedUntil is in the future', async () => {
      const email = 'alice@example.com'
      const user = makeUser({ email })
      const future = Date.now() + 10 * 60 * 1000
      db.prepare('UPDATE "User" SET "lockedUntil" = ? WHERE "id" = ?').run(
        future,
        user.id,
      )

      const result = await checkLockout(email)

      expect(result.locked).toBe(true)
      expect(result.unlocksAt).toBeInstanceOf(Date)
      expect(result.unlocksAt!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  // TC-P2-15: lockout expires after 15 minutes
  describe('TC-P2-15: lockout expiry', () => {
    it('returns locked=false when lockedUntil is in the past', async () => {
      const email = 'alice@example.com'
      const user = makeUser({ email })
      const past = Date.now() - 60 * 1000
      db.prepare(
        'UPDATE "User" SET "lockedUntil" = ?, "failedLoginAttempts" = 5 WHERE "id" = ?',
      ).run(past, user.id)

      const result = await checkLockout(email)
      expect(result.locked).toBe(false)
    })

    it('returns locked=false when lockedUntil is null', async () => {
      const email = 'alice@example.com'
      makeUser({ email })

      const result = await checkLockout(email)
      expect(result.locked).toBe(false)
    })

    it('resets the counter to 1 when recording a failure after lockout expiry', async () => {
      const email = 'alice@example.com'
      const user = makeUser({ email })
      const past = Date.now() - 60 * 1000
      db.prepare(
        'UPDATE "User" SET "lockedUntil" = ?, "failedLoginAttempts" = 5 WHERE "id" = ?',
      ).run(past, user.id)

      await recordFailedLogin(email)

      const row = lockoutRow(user.id)
      expect(row.failedLoginAttempts).toBe(1)
    })
  })

  // TC-P2-16: no attempt recorded for non-existent email
  describe('TC-P2-16: anti-enumeration — no lockout for non-existent email', () => {
    it('does not create or modify any user for an unknown email', async () => {
      await expect(
        recordFailedLogin('notexist@example.com'),
      ).resolves.toBeUndefined()

      const count = db
        .prepare('SELECT COUNT(*) AS c FROM "User"')
        .get() as { c: number }
      expect(count.c).toBe(0)
    })

    it('checkLockout returns locked=false for non-existent email', async () => {
      const result = await checkLockout('ghost@example.com')
      expect(result.locked).toBe(false)
    })
  })

  describe('clearLockout', () => {
    it('resets failedLoginAttempts and lockedUntil to null', async () => {
      const user = makeUser({ email: 'alice@example.com' })
      db.prepare(
        'UPDATE "User" SET "failedLoginAttempts" = 5, "lockedUntil" = ? WHERE "id" = ?',
      ).run(Date.now() + 60_000, user.id)

      await clearLockout(user.id)

      const row = lockoutRow(user.id)
      expect(row.failedLoginAttempts).toBe(0)
      expect(row.lockedUntil).toBeNull()
    })
  })
})

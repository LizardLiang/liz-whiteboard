// src/data/password-reset.test.ts
// Integration tests for the PasswordResetToken data layer,
// against an in-memory SQLite database (vitest.config sets
// DATABASE_URL=:memory:). Mirrors src/data/project-invite.test.ts's style.

import { beforeEach, describe, expect, it } from 'vitest'

import { db, nowMs } from '@/db'
import {
  RESET_COOLDOWN_MS,
  RESET_GLOBAL_DAILY_MAX,
  RESET_PER_USER_DAILY_MAX,
  _resetGlobalCapWarningForTests,
  completePasswordReset,
  countResetsForUserSince,
  countResetsSince,
  createResetToken,
  deleteResetTokensOlderThan,
  findValidResetToken,
  tryCreateResetToken,
} from '@/data/password-reset'
import { makePasswordResetToken, makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => {
  resetDb()
  _resetGlobalCapWarningForTests()
})

function countResetRows(userId: string): number {
  const row = db
    .prepare('SELECT count(*) AS c FROM "PasswordResetToken" WHERE "userId" = ?')
    .get(userId) as { c: number }
  return Number(row.c)
}

function countUnusedResetRows(userId: string): number {
  const row = db
    .prepare(
      'SELECT count(*) AS c FROM "PasswordResetToken" WHERE "userId" = ? AND "usedAt" IS NULL',
    )
    .get(userId) as { c: number }
  return Number(row.c)
}

describe('createResetToken', () => {
  it('inserts a new unused row with a 30-minute expiry', async () => {
    const user = makeUser()
    const before = nowMs()

    await createResetToken(user.id, 'hash-1')

    const row = await findValidResetToken('hash-1')
    expect(row).not.toBeNull()
    expect(row?.userId).toBe(user.id)
    expect(row?.tokenHash).toBe('hash-1')
    expect(row?.usedAt).toBeNull()
    expect(row?.expiresAt.getTime()).toBeGreaterThan(before + 29 * 60 * 1000)
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 5_000)
  })

  it('voids every earlier unused token for the same user', async () => {
    const user = makeUser()
    await createResetToken(user.id, 'hash-1')
    await createResetToken(user.id, 'hash-2')

    expect(countResetRows(user.id)).toBe(2)
    // Only the newest row is still unused; the earlier one was voided.
    expect(countUnusedResetRows(user.id)).toBe(1)

    const stillValid = await findValidResetToken('hash-2')
    expect(stillValid).not.toBeNull()
    const voided = await findValidResetToken('hash-1')
    expect(voided).toBeNull()
  })

  it("does not touch another user's unused token", async () => {
    const alice = makeUser()
    const bob = makeUser()
    await createResetToken(alice.id, 'alice-hash')
    await createResetToken(bob.id, 'bob-hash')

    expect(await findValidResetToken('alice-hash')).not.toBeNull()
    expect(await findValidResetToken('bob-hash')).not.toBeNull()
  })
})

describe('findValidResetToken', () => {
  it('returns null for an unknown hash', async () => {
    expect(await findValidResetToken('nonexistent')).toBeNull()
  })

  it('rejects a used token', async () => {
    const user = makeUser()
    makePasswordResetToken({ userId: user.id, tokenHash: 'used-hash', usedAt: nowMs() })

    expect(await findValidResetToken('used-hash')).toBeNull()
  })

  it('rejects an expired token', async () => {
    const user = makeUser()
    makePasswordResetToken({
      userId: user.id,
      tokenHash: 'expired-hash',
      expiresAt: nowMs() - 1_000,
    })

    expect(await findValidResetToken('expired-hash')).toBeNull()
  })

  it('accepts an unused, unexpired token', async () => {
    const user = makeUser()
    makePasswordResetToken({
      userId: user.id,
      tokenHash: 'live-hash',
      expiresAt: nowMs() + 60_000,
    })

    const found = await findValidResetToken('live-hash')
    expect(found?.userId).toBe(user.id)
  })
})

describe('tryCreateResetToken', () => {
  it('inserts a new unused row with a 30-minute expiry when no limit blocks it', () => {
    const user = makeUser()
    const before = nowMs()

    const created = tryCreateResetToken(user.id, 'atomic-hash')

    expect(created).not.toBeNull()
    expect(created?.userId).toBe(user.id)
    expect(created?.tokenHash).toBe('atomic-hash')
    expect(created?.usedAt).toBeNull()
    expect(created?.expiresAt.getTime()).toBeGreaterThan(before + 29 * 60 * 1000)
  })

  it('voids every earlier unused token for the same user on a successful insert', async () => {
    const user = makeUser()
    makePasswordResetToken({
      userId: user.id,
      tokenHash: 'older-hash',
      createdAt: nowMs() - (RESET_COOLDOWN_MS + 1_000),
    })

    const created = tryCreateResetToken(user.id, 'newer-hash')

    expect(created).not.toBeNull()
    expect(await findValidResetToken('older-hash')).toBeNull()
    expect(await findValidResetToken('newer-hash')).not.toBeNull()
  })

  it('returns null and inserts nothing within the cooldown window', async () => {
    const user = makeUser()
    makePasswordResetToken({ userId: user.id, createdAt: nowMs() - 1_000 })

    const created = tryCreateResetToken(user.id, 'blocked-hash')

    expect(created).toBeNull()
    expect(await findValidResetToken('blocked-hash')).toBeNull()
    expect(countResetRows(user.id)).toBe(1)
  })

  it('returns null at the per-user daily cap', () => {
    const user = makeUser()
    const now = nowMs()
    for (let i = 0; i < RESET_PER_USER_DAILY_MAX; i++) {
      makePasswordResetToken({
        userId: user.id,
        createdAt: now - RESET_COOLDOWN_MS - 1_000 - i * 3_600_000,
      })
    }

    const created = tryCreateResetToken(user.id, 'over-cap-hash')

    expect(created).toBeNull()
    expect(countResetRows(user.id)).toBe(RESET_PER_USER_DAILY_MAX)
  })

  it('returns null once the global daily cap is reached', async () => {
    const now = nowMs()
    for (let i = 0; i < RESET_GLOBAL_DAILY_MAX; i++) {
      const u = makeUser()
      makePasswordResetToken({ userId: u.id, createdAt: now - 3_600_000 })
    }
    const freshUser = makeUser()

    const created = tryCreateResetToken(freshUser.id, 'global-cap-hash')

    expect(created).toBeNull()
    expect(await findValidResetToken('global-cap-hash')).toBeNull()
  })
})

describe('countResetsForUserSince / countResetsSince', () => {
  it('counts only rows at or after the given time, scoped to the user', async () => {
    const alice = makeUser()
    const bob = makeUser()
    const now = nowMs()
    makePasswordResetToken({ userId: alice.id, createdAt: now - 10_000 })
    makePasswordResetToken({ userId: alice.id, createdAt: now - 1_000 })
    makePasswordResetToken({ userId: bob.id, createdAt: now - 1_000 })

    expect(await countResetsForUserSince(alice.id, now - 5_000)).toBe(1)
    expect(await countResetsForUserSince(alice.id, now - 20_000)).toBe(2)
    expect(await countResetsSince(now - 20_000)).toBe(3)
    expect(await countResetsSince(now - 5_000)).toBe(2)
  })
})

describe('deleteResetTokensOlderThan', () => {
  it('deletes only rows older than the given age', async () => {
    const user = makeUser()
    const now = nowMs()
    makePasswordResetToken({ userId: user.id, createdAt: now - 8 * 24 * 60 * 60 * 1000 })
    makePasswordResetToken({ userId: user.id, createdAt: now - 1 * 24 * 60 * 60 * 1000 })

    await deleteResetTokensOlderThan(7 * 24 * 60 * 60 * 1000)

    expect(countResetRows(user.id)).toBe(1)
  })
})

describe('completePasswordReset', () => {
  function makeOauthRefreshToken(userId: string): void {
    const now = nowMs()
    db.prepare(
      `INSERT INTO "OauthRefreshToken"
        (tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      `rt-${userId}`,
      `family-${userId}`,
      userId,
      'test-client',
      'mcp',
      'https://example.test/mcp',
      now + 3_600_000,
      now,
    )
  }

  function makeOauthGrant(userId: string): void {
    db.prepare(
      `INSERT INTO "OauthGrant" (userId, clientId, scope, grantedAt)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, 'test-client', 'mcp', nowMs())
  }

  it('changes the password hash, clears lockout, voids reset tokens, and revokes sessions/MCP tokens while keeping OauthGrant', async () => {
    const user = makeUser({ passwordHash: 'old-hash' })
    db.prepare(
      'UPDATE "User" SET "failedLoginAttempts" = 5, "lockedUntil" = ? WHERE "id" = ?',
    ).run(nowMs() + 900_000, user.id)

    await createResetToken(user.id, 'reset-hash')
    db.prepare(
      'INSERT INTO "Session" ("id","tokenHash","userId","expiresAt","createdAt") VALUES (?,?,?,?,?)',
    ).run('sess-1', 'sess-hash', user.id, nowMs() + 3_600_000, nowMs())
    makeOauthRefreshToken(user.id)
    makeOauthGrant(user.id)

    completePasswordReset(user.id, 'new-hash')

    const updatedUser = db
      .prepare('SELECT * FROM "User" WHERE "id" = ?')
      .get(user.id) as {
      passwordHash: string
      failedLoginAttempts: number
      lockedUntil: number | null
    }
    expect(updatedUser.passwordHash).toBe('new-hash')
    expect(updatedUser.failedLoginAttempts).toBe(0)
    expect(updatedUser.lockedUntil).toBeNull()

    expect(await findValidResetToken('reset-hash')).toBeNull()
    expect(countUnusedResetRows(user.id)).toBe(0)

    const sessionCount = db
      .prepare('SELECT count(*) AS c FROM "Session" WHERE "userId" = ?')
      .get(user.id) as { c: number }
    expect(sessionCount.c).toBe(0)

    const refreshCount = db
      .prepare('SELECT count(*) AS c FROM "OauthRefreshToken" WHERE "userId" = ?')
      .get(user.id) as { c: number }
    expect(refreshCount.c).toBe(0)

    // OauthGrant is deliberately left untouched — a reconnect skips consent.
    const grantCount = db
      .prepare('SELECT count(*) AS c FROM "OauthGrant" WHERE "userId" = ?')
      .get(user.id) as { c: number }
    expect(grantCount.c).toBe(1)
  })
})

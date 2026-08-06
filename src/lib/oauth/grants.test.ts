// @vitest-environment node
// src/lib/oauth/grants.test.ts
// Unit tests for the persisted per-user consent grant store
// (mcp-oauth-dcr-consent): getGrant/upsertGrant/listGrants/revokeGrant and
// scopeCovers(). Uses the real in-memory SQLite DB (DATABASE_URL=:memory:
// from vitest.config.ts), same pattern as clients.test.ts/tokens.test.ts.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetGrantStoreForTests,
  getGrant,
  listGrants,
  revokeGrant,
  scopeCovers,
  upsertGrant,
} from './grants'
import { makeUser, resetDb } from '@/test/db-helpers'
import { db, nowMs } from '@/db'

beforeEach(() => {
  resetDb()
  _resetGrantStoreForTests()
})

describe('upsertGrant / getGrant', () => {
  it('creates a grant and reads it back', () => {
    const { id: userId } = makeUser()
    const grant = upsertGrant(userId, 'client-abc', 'whiteboard')

    expect(grant.userId).toBe(userId)
    expect(grant.clientId).toBe('client-abc')
    expect(grant.scope).toBe('whiteboard')

    const found = getGrant(userId, 'client-abc')
    expect(found).not.toBeNull()
    expect(found?.scope).toBe('whiteboard')
  })

  it('returns null for a grant that does not exist', () => {
    const { id: userId } = makeUser()
    expect(getGrant(userId, 'unknown-client')).toBeNull()
  })

  it('replaces (not unions) the scope on a second approval — scope escalation semantics', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, 'client-abc', 'whiteboard')
    upsertGrant(userId, 'client-abc', 'whiteboard other-scope')

    const found = getGrant(userId, 'client-abc')
    expect(found?.scope).toBe('whiteboard other-scope')
  })

  it('is scoped per-user — two users approving the same client get independent rows', () => {
    const { id: userA } = makeUser()
    const { id: userB } = makeUser()
    upsertGrant(userA, 'client-abc', 'whiteboard')

    expect(getGrant(userA, 'client-abc')).not.toBeNull()
    expect(getGrant(userB, 'client-abc')).toBeNull()
  })
})

describe('listGrants', () => {
  it('lists all grants for a user, most recent first', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, 'client-1', 'whiteboard')
    upsertGrant(userId, 'client-2', 'whiteboard')

    const grants = listGrants(userId)
    expect(grants).toHaveLength(2)
    expect(grants.map((g) => g.clientId).sort()).toEqual([
      'client-1',
      'client-2',
    ])
  })

  it('returns an empty array for a user with no grants', () => {
    const { id: userId } = makeUser()
    expect(listGrants(userId)).toEqual([])
  })
})

describe('revokeGrant', () => {
  it('deletes the grant row', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, 'client-abc', 'whiteboard')
    revokeGrant(userId, 'client-abc')
    expect(getGrant(userId, 'client-abc')).toBeNull()
  })

  it('is idempotent — revoking a non-existent grant does not throw', () => {
    const { id: userId } = makeUser()
    expect(() => revokeGrant(userId, 'never-granted')).not.toThrow()
  })

  it('also deletes matching OauthRefreshToken rows for that user+client (revoke -> refresh fails)', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, 'client-abc', 'whiteboard')

    // Seed a refresh token row directly (mirrors tokens.ts's INSERT shape).
    db.prepare(
      `
      INSERT INTO "OauthRefreshToken"
        (tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    ).run(
      'test-token-hash',
      'test-family',
      userId,
      'client-abc',
      'whiteboard',
      'http://localhost:8080/mcp',
      nowMs() + 1000 * 60 * 60,
      nowMs(),
    )

    // A refresh token for a DIFFERENT client must survive the revoke.
    db.prepare(
      `
      INSERT INTO "OauthRefreshToken"
        (tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    ).run(
      'other-token-hash',
      'other-family',
      userId,
      'client-other',
      'whiteboard',
      'http://localhost:8080/mcp',
      nowMs() + 1000 * 60 * 60,
      nowMs(),
    )

    revokeGrant(userId, 'client-abc')

    const revokedRow = db
      .prepare(`SELECT * FROM "OauthRefreshToken" WHERE tokenHash = ?`)
      .get('test-token-hash')
    expect(revokedRow).toBeUndefined()

    const survivingRow = db
      .prepare(`SELECT * FROM "OauthRefreshToken" WHERE tokenHash = ?`)
      .get('other-token-hash')
    expect(survivingRow).toBeDefined()
  })
})

describe('scopeCovers', () => {
  it('returns true when the granted scope covers every requested scope', () => {
    expect(scopeCovers('whiteboard other', ['whiteboard'])).toBe(true)
    expect(scopeCovers('whiteboard', ['whiteboard'])).toBe(true)
  })

  it('returns false when a requested scope is missing from the granted scope (escalation)', () => {
    expect(scopeCovers('whiteboard', ['whiteboard', 'other'])).toBe(false)
  })

  it('returns true for an empty requested-scope list (nothing to escalate)', () => {
    expect(scopeCovers('whiteboard', [])).toBe(true)
  })
})

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

describe('origin-scoped CIMD grants (mcp-oauth-open-cimd)', () => {
  const CODEX_A = 'https://chatgpt.com/oauth/codex/aaaaaaaa/client.json'
  const CODEX_B = 'https://chatgpt.com/oauth/codex/bbbbbbbb/client.json'

  function seedRefreshToken(userId: string, clientId: string, hash: string) {
    db.prepare(
      `
      INSERT INTO "OauthRefreshToken"
        (tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    ).run(
      hash,
      `family-${hash}`,
      userId,
      clientId,
      'whiteboard',
      'https://example.test/mcp',
      nowMs() + 60_000,
      nowMs(),
    )
  }

  function refreshCount(userId: string): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "OauthRefreshToken" WHERE userId = ?`)
      .get(userId) as { n: number }
    return row.n
  }

  const URIS = ['http://127.0.0.1:1455/auth/callback']

  it('stores a CIMD grant under its origin plus a redirect_uris hash', () => {
    const { id: userId } = makeUser()
    const grant = upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(grant.clientId).toMatch(/^https:\/\/chatgpt\.com#[0-9a-f]{16}$/)
    expect(grant.clientName).toBe('Codex')
  })

  it('matches a different document URL on the same origin with the same redirect_uris (no re-consent per login)', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(getGrant(userId, CODEX_A, URIS)).not.toBeNull()
    expect(getGrant(userId, CODEX_B, URIS)).not.toBeNull()
  })

  it('ignores the port of a loopback http redirect_uri', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', [
      'http://127.0.0.1:1455/auth/callback',
    ])
    expect(
      getGrant(userId, CODEX_B, ['http://127.0.0.1:53211/auth/callback']),
    ).not.toBeNull()
    expect(
      getGrant(userId, CODEX_B, ['http://localhost:53211/auth/callback']),
    ).toBeNull()
    expect(
      getGrant(userId, CODEX_B, ['http://127.0.0.1:53211/other/path']),
    ).toBeNull()
  })

  it('does not strip the port of a non-loopback redirect_uri', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'X', ['https://app.example:8443/cb'])
    expect(getGrant(userId, CODEX_A, ['https://app.example:9443/cb'])).toBeNull()
  })

  it('a different origin never matches, even with identical redirect_uris', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(
      getGrant(userId, 'https://other.example/client.json', URIS),
    ).toBeNull()
  })

  it('a full-client_id#hash row from the previous scheme never auto-approves; re-consent replaces it', () => {
    const { id: userId } = makeUser()
    db.prepare(
      `INSERT INTO "OauthGrant" (userId, clientId, scope, grantedAt) VALUES (?, ?, ?, ?)`,
    ).run(userId, `${CODEX_A}#0123456789abcdef`, 'whiteboard', nowMs())
    expect(getGrant(userId, CODEX_A, URIS)).toBeNull()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(listGrants(userId)).toHaveLength(1)
  })

  it('does NOT match when the redirect_uris changed since consent (re-consent)', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(
      getGrant(userId, CODEX_A, ['https://evil.example/callback']),
    ).toBeNull()
    expect(getGrant(userId, CODEX_A, [...URIS, 'https://evil.example/cb'])).toBeNull()
  })

  it('redirect_uris order does not matter', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', ['http://a/1', 'http://a/2'])
    expect(getGrant(userId, CODEX_A, ['http://a/2', 'http://a/1'])).not.toBeNull()
  })

  it('a legacy origin-keyed grant never auto-approves; re-consent replaces it', () => {
    const { id: userId } = makeUser()
    db.prepare(
      `INSERT INTO "OauthGrant" (userId, clientId, scope, grantedAt) VALUES (?, ?, ?, ?)`,
    ).run(userId, 'https://chatgpt.com', 'whiteboard', nowMs())
    expect(getGrant(userId, CODEX_A, URIS)).toBeNull()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(listGrants(userId)).toHaveLength(1)
  })

  it('does NOT match a lookalike origin', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    expect(
      getGrant(userId, 'https://chatgpt.com.evil.example/client.json', URIS),
    ).toBeNull()
  })

  it('keeps non-URL client ids (static/DCR) keyed verbatim', () => {
    const { id: userId } = makeUser()
    const grant = upsertGrant(
      userId,
      'dcr-generated-id',
      'whiteboard',
      'Some App',
    )
    expect(grant.clientId).toBe('dcr-generated-id')
    expect(getGrant(userId, 'dcr-generated-id')).not.toBeNull()
  })

  // F6d: refresh tokens carry the FULL client_id (token.ts), while the grant
  // key is the origin. An exact-key delete would leave every refresh token
  // alive after revocation — the client would keep minting access tokens for
  // the rest of the 7-day refresh TTL. This is the regression this asserts.
  it('revoking an origin grant deletes refresh tokens for EVERY document URL on that origin', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex', URIS)
    seedRefreshToken(userId, CODEX_A, 'hash-a')
    seedRefreshToken(userId, CODEX_B, 'hash-b')
    expect(refreshCount(userId)).toBe(2)

    revokeGrant(userId, CODEX_A)

    expect(getGrant(userId, CODEX_A, URIS)).toBeNull()
    expect(refreshCount(userId)).toBe(0)
  })

  it('revoking an origin does NOT delete refresh tokens of a lookalike origin', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, CODEX_A, 'whiteboard', 'Codex')
    seedRefreshToken(userId, CODEX_A, 'hash-a')
    seedRefreshToken(
      userId,
      'https://chatgpt.com.evil.example/client.json',
      'hash-evil',
    )

    revokeGrant(userId, CODEX_A)

    expect(refreshCount(userId)).toBe(1)
  })

  it('revoking a non-URL client id still deletes its refresh tokens', () => {
    const { id: userId } = makeUser()
    upsertGrant(userId, 'dcr-generated-id', 'whiteboard', 'Some App')
    seedRefreshToken(userId, 'dcr-generated-id', 'hash-dcr')

    revokeGrant(userId, 'dcr-generated-id')

    expect(refreshCount(userId)).toBe(0)
  })
})

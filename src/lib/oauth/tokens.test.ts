// @vitest-environment node
// src/lib/oauth/tokens.test.ts
// Unit tests for issueTokens, rotateRefreshToken, revokeRefreshToken.
//
// Uses a real SQLite in-memory database (DATABASE_URL=:memory: from vitest.config.ts)
// and real RS256 keys (same as production) — same pattern as collab-verify.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db'
import { _resetKeyPairForTests } from './keys'
import { _resetTokenStoresForTests, issueTokens, rotateRefreshToken, revokeRefreshToken } from './tokens'
import type { OAuthConfig } from './config'

// Minimal OAuthConfig sufficient for token tests.
const TEST_ISSUER = 'http://localhost:3000'
const TEST_RESOURCE = 'http://localhost:3011/mcp'

vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
vi.stubEnv('MCP_RESOURCE_URI', TEST_RESOURCE)

const config: OAuthConfig = {
  issuer: TEST_ISSUER,
  mcpResourceUri: TEST_RESOURCE,
  collabResourceUri: 'http://localhost:3010',
  mcpClientId: 'mcp-server',
  mcpClientSecret: 'secret',
  collabTokenTtl: 120,
  scopes: ['whiteboard'],
  accessTokenTtl: 60,       // 1 min in tests (faster expiry checks)
  refreshTokenTtl: 300,     // 5 min in tests
  authCodeTtl: 120,
  clients: [],
}

const testParams = {
  userId: 'user-1',
  clientId: 'mcp-claude',
  scope: 'whiteboard',
  resource: TEST_RESOURCE,
}

beforeEach(() => {
  _resetKeyPairForTests()
  _resetTokenStoresForTests()
})

// ---------------------------------------------------------------------------
// TC-RT-01: Issue tokens returns expected shape
// ---------------------------------------------------------------------------
describe('TC-RT-01: issueTokens returns expected shape', () => {
  it('returns access token, refresh token, expiresIn, scope', async () => {
    const result = await issueTokens(testParams, config)
    expect(result.tokenType).toBe('Bearer')
    expect(result.expiresIn).toBe(60)
    expect(result.scope).toBe('whiteboard')
    expect(typeof result.accessToken).toBe('string')
    expect(result.accessToken.split('.').length).toBe(3) // JWT format
    expect(typeof result.refreshToken).toBe('string')
    expect(result.refreshToken.length).toBeGreaterThan(10)
  })

  it('persists refresh token row in OauthRefreshToken', async () => {
    const result = await issueTokens(testParams, config)
    const count = db.prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`).get() as { n: number }
    expect(count.n).toBe(1)
    // The raw token is never stored — only the hash
    const row = db.prepare(`SELECT * FROM "OauthRefreshToken"`).get() as Record<string, unknown>
    expect(row.rotated).toBe(0)
    expect(row.userId).toBe('user-1')
    expect(row.clientId).toBe('mcp-claude')
    expect(row.scope).toBe('whiteboard')
    expect(row.tokenHash).not.toBe(result.refreshToken) // hash, not raw
  })
})

// ---------------------------------------------------------------------------
// TC-RT-02: Rotate token — new tokens returned, old hash invalid
// ---------------------------------------------------------------------------
describe('TC-RT-02: rotate refresh token', () => {
  it('returns new tokens and marks old token as rotated', async () => {
    const first = await issueTokens(testParams, config)
    const second = await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)

    expect(second).not.toBeNull()
    expect(second!.tokenType).toBe('Bearer')
    expect(second!.refreshToken).not.toBe(first.refreshToken)
    expect(second!.scope).toBe('whiteboard')

    // Old token row should be marked rotated=1, new row rotated=0
    const rows = db.prepare(`SELECT tokenHash, rotated, familyId FROM "OauthRefreshToken" ORDER BY createdAt ASC`).all() as Array<{ tokenHash: string; rotated: number; familyId: string }>
    expect(rows.length).toBe(2)
    expect(rows[0].rotated).toBe(1)  // old token marked stale
    expect(rows[1].rotated).toBe(0)  // new token is live
    // Both in same family
    expect(rows[0].familyId).toBe(rows[1].familyId)
  })

  it('second rotation with new token succeeds', async () => {
    const first = await issueTokens(testParams, config)
    const second = await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)
    const third = await rotateRefreshToken(second!.refreshToken, 'mcp-claude', config)
    expect(third).not.toBeNull()
    expect(third!.refreshToken).not.toBe(second!.refreshToken)
  })
})

// ---------------------------------------------------------------------------
// TC-RT-03: Reuse detection — stale token revokes entire family
// ---------------------------------------------------------------------------
describe('TC-RT-03: reuse detection revokes family', () => {
  it('returns null and deletes all family rows when stale token is replayed', async () => {
    const first = await issueTokens(testParams, config)
    // Rotate once (first → second)
    await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)
    // Now replay the stale first token → REUSE DETECTED
    const result = await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)
    expect(result).toBeNull()

    // Entire family should be deleted
    const count = db.prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`).get() as { n: number }
    expect(count.n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-RT-04: Expiry — expired token returns null
// ---------------------------------------------------------------------------
describe('TC-RT-04: expired refresh token returns null', () => {
  it('returns null when the stored token is already expired', async () => {
    const expiredConfig: OAuthConfig = { ...config, refreshTokenTtl: -1 } // already expired
    const result = await issueTokens(testParams, expiredConfig)

    // Token should be in DB with expiresAt in the past
    const rotation = await rotateRefreshToken(result.refreshToken, 'mcp-claude', config)
    expect(rotation).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-RT-05: client_id mismatch returns null
// ---------------------------------------------------------------------------
describe('TC-RT-05: client_id mismatch returns null', () => {
  it('returns null when client_id does not match the stored clientId', async () => {
    const result = await issueTokens(testParams, config)
    const rotation = await rotateRefreshToken(result.refreshToken, 'evil-client', config)
    expect(rotation).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-RT-06: Unknown token returns null
// ---------------------------------------------------------------------------
describe('TC-RT-06: unknown token returns null', () => {
  it('returns null for a token that was never issued', async () => {
    const result = await rotateRefreshToken('not-a-real-token', 'mcp-claude', config)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-RT-07: familyId passed to issueTokens is preserved through rotation
// ---------------------------------------------------------------------------
describe('TC-RT-07: familyId propagation', () => {
  it('rotated token inherits the original familyId', async () => {
    const first = await issueTokens(testParams, config)
    const firstRow = db.prepare(`SELECT familyId FROM "OauthRefreshToken" WHERE rotated = 0`).get() as { familyId: string }
    const originalFamily = firstRow.familyId

    await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)

    const newRow = db.prepare(`SELECT familyId FROM "OauthRefreshToken" WHERE rotated = 0`).get() as { familyId: string }
    expect(newRow.familyId).toBe(originalFamily)
  })
})

// ---------------------------------------------------------------------------
// TC-RT-08: revokeRefreshToken revokes entire family
// ---------------------------------------------------------------------------
describe('TC-RT-08: revokeRefreshToken family revocation', () => {
  it('deletes all tokens in the same family', async () => {
    const first = await issueTokens(testParams, config)
    const second = await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)

    // Issue a fresh grant (different family)
    const other = await issueTokens({ ...testParams, userId: 'user-2' }, config)

    // Revoke using the current live token (second)
    const revoked = revokeRefreshToken(second!.refreshToken, 'mcp-claude')
    expect(revoked).toBe(true)

    // Only first family rows should be gone; other family stays
    const remaining = db.prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`).get() as { n: number }
    expect(remaining.n).toBe(1) // only the 'other' family's row

    // The other token is still rotatable
    const otherResult = await rotateRefreshToken(other.refreshToken, 'mcp-claude', config)
    expect(otherResult).not.toBeNull()
  })

  it('returns false for unknown token', () => {
    const result = revokeRefreshToken('ghost-token', 'mcp-claude')
    expect(result).toBe(false)
  })

  it('returns false for client_id mismatch (no revocation)', async () => {
    const first = await issueTokens(testParams, config)
    const result = revokeRefreshToken(first.refreshToken, 'wrong-client')
    expect(result).toBe(false)
    // Row should still exist
    const count = db.prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`).get() as { n: number }
    expect(count.n).toBe(1)
  })
})

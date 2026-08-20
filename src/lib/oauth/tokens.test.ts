// @vitest-environment node
// src/lib/oauth/tokens.test.ts
// Unit tests for issueTokens, rotateRefreshToken, revokeRefreshToken.
//
// Uses a real SQLite in-memory database (DATABASE_URL=:memory: from vitest.config.ts)
// and real RS256 keys (same as production) — same pattern as collab-verify.test.ts.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetKeyPairForTests } from './keys'
import {
  MAX_REPLAY_CHAIN_DEPTH,
  ROTATION_GRACE_MS,
  _resetReplayCacheEntryForTests,
  _resetReplayCacheForTests,
  _resetTokenStoresForTests,
  issueTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from './tokens'
import type { OAuthConfig } from './config'
import { db } from '@/db'

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
  accessTokenTtl: 60, // 1 min in tests (faster expiry checks)
  refreshTokenTtl: 300, // 5 min in tests
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
    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(1)
    // The raw token is never stored — only the hash
    const row = db.prepare(`SELECT * FROM "OauthRefreshToken"`).get() as Record<
      string,
      unknown
    >
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
    const second = await rotateRefreshToken(
      first.refreshToken,
      'mcp-claude',
      config,
    )

    expect(second).not.toBeNull()
    expect(second!.tokenType).toBe('Bearer')
    expect(second!.refreshToken).not.toBe(first.refreshToken)
    expect(second!.scope).toBe('whiteboard')

    // Old token row should be marked rotated=1, new row rotated=0
    const rows = db
      .prepare(
        `SELECT tokenHash, rotated, familyId FROM "OauthRefreshToken" ORDER BY createdAt ASC`,
      )
      .all() as Array<{ tokenHash: string; rotated: number; familyId: string }>
    expect(rows.length).toBe(2)
    expect(rows[0].rotated).toBe(1) // old token marked stale
    expect(rows[1].rotated).toBe(0) // new token is live
    // Both in same family
    expect(rows[0].familyId).toBe(rows[1].familyId)
  })

  it('second rotation with new token succeeds', async () => {
    const first = await issueTokens(testParams, config)
    const second = await rotateRefreshToken(
      first.refreshToken,
      'mcp-claude',
      config,
    )
    const third = await rotateRefreshToken(
      second!.refreshToken,
      'mcp-claude',
      config,
    )
    expect(third).not.toBeNull()
    expect(third!.refreshToken).not.toBe(second!.refreshToken)
  })
})

// ---------------------------------------------------------------------------
// TC-RT-03: Reuse detection — stale token revokes entire family
//
// Since oauth-refresh-rotation-race, a replay WITHIN ROTATION_GRACE_MS of the
// rotation (with the replay cache still holding the successor) is treated as
// a benign concurrency race, not theft — see TC-RR-01 below. So this test
// now advances a fake clock PAST the grace window before replaying, to keep
// exercising genuine reuse detection (the property that must survive the fix
// unchanged, per the fix's own requirements).
// ---------------------------------------------------------------------------
describe('TC-RT-03: reuse detection revokes family', () => {
  it('returns null and deletes all family rows when stale token is replayed', async () => {
    vi.useFakeTimers()
    try {
      const first = await issueTokens(testParams, config)
      // Rotate once (first → second)
      await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)

      // Move past the idempotent-replay grace window.
      vi.advanceTimersByTime(ROTATION_GRACE_MS + 1000)

      // Now replay the stale first token → REUSE DETECTED
      const result = await rotateRefreshToken(
        first.refreshToken,
        'mcp-claude',
        config,
      )
      expect(result).toBeNull()

      // Entire family should be deleted
      const count = db
        .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
        .get() as { n: number }
      expect(count.n).toBe(0)
    } finally {
      vi.useRealTimers()
    }
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
    const rotation = await rotateRefreshToken(
      result.refreshToken,
      'mcp-claude',
      config,
    )
    expect(rotation).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-RT-05: client_id mismatch returns null
// ---------------------------------------------------------------------------
describe('TC-RT-05: client_id mismatch returns null', () => {
  it('returns null when client_id does not match the stored clientId', async () => {
    const result = await issueTokens(testParams, config)
    const rotation = await rotateRefreshToken(
      result.refreshToken,
      'evil-client',
      config,
    )
    expect(rotation).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-RT-06: Unknown token returns null
// ---------------------------------------------------------------------------
describe('TC-RT-06: unknown token returns null', () => {
  it('returns null for a token that was never issued', async () => {
    const result = await rotateRefreshToken(
      'not-a-real-token',
      'mcp-claude',
      config,
    )
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TC-RT-07: familyId passed to issueTokens is preserved through rotation
// ---------------------------------------------------------------------------
describe('TC-RT-07: familyId propagation', () => {
  it('rotated token inherits the original familyId', async () => {
    const first = await issueTokens(testParams, config)
    const firstRow = db
      .prepare(`SELECT familyId FROM "OauthRefreshToken" WHERE rotated = 0`)
      .get() as { familyId: string }
    const originalFamily = firstRow.familyId

    await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)

    const newRow = db
      .prepare(`SELECT familyId FROM "OauthRefreshToken" WHERE rotated = 0`)
      .get() as { familyId: string }
    expect(newRow.familyId).toBe(originalFamily)
  })
})

// ---------------------------------------------------------------------------
// TC-RT-08: revokeRefreshToken revokes entire family
// ---------------------------------------------------------------------------
describe('TC-RT-08: revokeRefreshToken family revocation', () => {
  it('deletes all tokens in the same family', async () => {
    const first = await issueTokens(testParams, config)
    const second = await rotateRefreshToken(
      first.refreshToken,
      'mcp-claude',
      config,
    )

    // Issue a fresh grant (different family)
    const other = await issueTokens({ ...testParams, userId: 'user-2' }, config)

    // Revoke using the current live token (second)
    const revoked = revokeRefreshToken(second!.refreshToken, 'mcp-claude')
    expect(revoked).toBe(true)

    // Only first family rows should be gone; other family stays
    const remaining = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(remaining.n).toBe(1) // only the 'other' family's row

    // The other token is still rotatable
    const otherResult = await rotateRefreshToken(
      other.refreshToken,
      'mcp-claude',
      config,
    )
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
    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// TC-RR-01..05: oauth-refresh-rotation-race — idempotent-replay grace window
//
// Root cause: rotateRefreshToken() treated ANY replay of an already-rotated
// token as theft. Legitimate clients (e.g. the Codex CLI, whose cross-process
// lock doesn't cover its OS-keyring backend — openai/codex#33540) can
// benignly replay a token a moment after a winning concurrent request already
// rotated it. These tests cover the fix: idempotent replay inside the grace
// window, and unchanged reuse-detection everywhere else.
// ---------------------------------------------------------------------------

describe('TC-RR-01: concurrent replay within the grace window', () => {
  it('returns the same token pair to both callers and leaves the family intact', async () => {
    const first = await issueTokens(testParams, config)

    // rotateRefreshToken's DB reads/writes are all synchronous; its only
    // `await` is the JWT-signing call at the end. So calling it twice with
    // the SAME token via Promise.all deterministically reproduces the real
    // race: the first invocation runs its full SELECT+UPDATE+INSERT to
    // completion (marking the token rotated) before the second invocation's
    // SELECT ever runs — so the second call sees rotated=1, exactly like the
    // losing process in the Codex CLI race.
    const [a, b] = await Promise.all([
      rotateRefreshToken(first.refreshToken, 'mcp-claude', config),
      rotateRefreshToken(first.refreshToken, 'mcp-claude', config),
    ])

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    // Both callers get the identical successor pair — the loser is re-served
    // the winner's tokens rather than being told the family was revoked.
    expect(a!.refreshToken).toBe(b!.refreshToken)
    expect(a!.accessToken).toBeTruthy()
    expect(b!.accessToken).toBeTruthy()
    expect(a!.scope).toBe('whiteboard')
    expect(b!.scope).toBe('whiteboard')

    // Family intact: exactly 2 rows (old rotated=1, new rotated=0) — NOT
    // deleted the way REUSE DETECTED would delete them.
    const rows = db
      .prepare(`SELECT rotated FROM "OauthRefreshToken"`)
      .all() as Array<{ rotated: number }>
    expect(rows.length).toBe(2)
    expect(rows.filter((r) => r.rotated === 1).length).toBe(1)
    expect(rows.filter((r) => r.rotated === 0).length).toBe(1)
  })
})

describe('TC-RR-02: replay after the grace window expires still revokes the family', () => {
  it('returns null and deletes all family rows', async () => {
    vi.useFakeTimers()
    try {
      const first = await issueTokens(testParams, config)
      const second = await rotateRefreshToken(
        first.refreshToken,
        'mcp-claude',
        config,
      )
      expect(second).not.toBeNull()

      // Advance past the grace window — a replay now is no longer eligible
      // for idempotent re-serve, even though the replay cache entry (TTL
      // also tied to ROTATION_GRACE_MS) would independently have expired too.
      vi.advanceTimersByTime(ROTATION_GRACE_MS + 1000)

      const replay = await rotateRefreshToken(
        first.refreshToken,
        'mcp-claude',
        config,
      )
      expect(replay).toBeNull()

      const count = db
        .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
        .get() as { n: number }
      expect(count.n).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TC-RR-03: replay within the window but with a cache miss still revokes the family', () => {
  it('returns null and deletes all family rows when the replay cache was cleared', async () => {
    const first = await issueTokens(testParams, config)
    await rotateRefreshToken(first.refreshToken, 'mcp-claude', config)

    // Simulate a cache miss (e.g. a process restart) that happens to occur
    // while still well inside the wall-clock grace window (rotatedAt is
    // real, unaffected by this). The rotatedAt-based grace check alone must
    // NOT be sufficient to re-serve — the in-memory cache entry is required.
    _resetReplayCacheForTests()

    const replay = await rotateRefreshToken(
      first.refreshToken,
      'mcp-claude',
      config,
    )
    expect(replay).toBeNull()

    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('TC-RR-04: client_id mismatch is enforced on the idempotent-replay (cached-hit) path', () => {
  it('rotate A→B, then replay stale A with a different client_id inside the grace window: returns null and revokes the family', async () => {
    const first = await issueTokens(testParams, config)
    const second = await rotateRefreshToken(
      first.refreshToken,
      'mcp-claude',
      config,
    )
    expect(second).not.toBeNull()

    // Still inside the grace window, replay stale A — but with a client_id
    // that does NOT match the row's clientId ('mcp-claude'). Without the
    // fix, the cached-hit branch returns B's pair before this check ever
    // runs (BLOCKER 2). With the fix, it must fall through to reuse
    // detection identically to the non-cached mismatch path (TC-RT-05).
    const replay = await rotateRefreshToken(
      first.refreshToken,
      'evil-client',
      config,
    )
    expect(replay).toBeNull()

    // Whole family revoked — including B, which was still live.
    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('TC-RR-05: expired-active-token cleanup path is unchanged by the rotation-race fix', () => {
  it('returns null and deletes the row when a live (never-rotated) token is already expired', async () => {
    const expiredConfig: OAuthConfig = { ...config, refreshTokenTtl: -1 }
    const result = await issueTokens(testParams, expiredConfig)

    const rotation = await rotateRefreshToken(
      result.refreshToken,
      'mcp-claude',
      config,
    )
    expect(rotation).toBeNull()

    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-RR-06..08: replay-cache chain walk (BLOCKER 1 — stale successor
// re-served as a live pair)
//
// Root cause: the cached-hit branch re-served whatever row the replay cache
// pointed at without checking `rotated`. If that successor was itself
// rotated forward inside the same grace window (A→B, then B→C), a straggler
// replaying stale A got B's pair back — already rotated=1, dead on next use.
// The fix walks replayCache forward from the cached successor until it
// finds the current LIVE (rotated=0) descendant, bounded by
// MAX_REPLAY_CHAIN_DEPTH.
// ---------------------------------------------------------------------------

describe('TC-RR-06: chain walk serves the current LIVE descendant, not a stale intermediate', () => {
  it('A→B, B→C, replay stale A within grace: straggler receives a genuinely live refresh token', async () => {
    const a = await issueTokens(testParams, config)
    const b = await rotateRefreshToken(a.refreshToken, 'mcp-claude', config)
    expect(b).not.toBeNull()
    const c = await rotateRefreshToken(b!.refreshToken, 'mcp-claude', config)
    expect(c).not.toBeNull()

    // Replay stale A, still inside the grace window for both rotations.
    const straggler = await rotateRefreshToken(
      a.refreshToken,
      'mcp-claude',
      config,
    )
    expect(straggler).not.toBeNull()

    // Without the chain walk, the straggler would receive B's refresh token
    // (dead, rotated=1). With the fix, it must receive C's — the row backing
    // whatever refresh token comes back must be rotated=0.
    const returnedHash = createHash('sha256')
      .update(straggler!.refreshToken)
      .digest('hex')
    const returnedRow = db
      .prepare(`SELECT rotated FROM "OauthRefreshToken" WHERE tokenHash = ?`)
      .get(returnedHash) as { rotated: number } | undefined
    expect(returnedRow).toBeDefined()
    expect(returnedRow!.rotated).toBe(0)
    expect(straggler!.refreshToken).toBe(c!.refreshToken)
  })
})

describe('TC-RR-07: chain walk falls through to reuse detection on a mid-chain cache miss', () => {
  it('A→B, B→C, but the cache entry for B is gone: replaying stale A revokes the family', async () => {
    const a = await issueTokens(testParams, config)
    const b = await rotateRefreshToken(a.refreshToken, 'mcp-claude', config)
    expect(b).not.toBeNull()
    const bHash = createHash('sha256').update(b!.refreshToken).digest('hex')

    const c = await rotateRefreshToken(b!.refreshToken, 'mcp-claude', config)
    expect(c).not.toBeNull()

    // Simulate the mid-chain cache entry (B -> C) having been evicted or
    // never populated, while A -> B is still cached. The walk reaches B,
    // finds it rotated=1, looks up replayCache.get(bHash), gets nothing, and
    // must fall through — not re-serve a dead token, not loop.
    _resetReplayCacheEntryForTests(bHash)

    const straggler = await rotateRefreshToken(
      a.refreshToken,
      'mcp-claude',
      config,
    )
    expect(straggler).toBeNull()

    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('TC-RR-08: chain walk is bounded by MAX_REPLAY_CHAIN_DEPTH', () => {
  it('a chain longer than the max depth falls through to reuse detection instead of looping', async () => {
    // Build a rotation chain longer than MAX_REPLAY_CHAIN_DEPTH (5) so the
    // walk starting from the oldest stale token cannot reach the live end.
    let current = await issueTokens(testParams, config)
    const stale = current // token 0 — the one we'll replay
    for (let i = 0; i < MAX_REPLAY_CHAIN_DEPTH + 2; i++) {
      const next = await rotateRefreshToken(
        current.refreshToken,
        'mcp-claude',
        config,
      )
      expect(next).not.toBeNull()
      current = { ...current, refreshToken: next!.refreshToken }
    }

    // Replay the oldest stale token, still within its own grace window.
    const straggler = await rotateRefreshToken(
      stale.refreshToken,
      'mcp-claude',
      config,
    )
    expect(straggler).toBeNull()

    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "OauthRefreshToken"`)
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})

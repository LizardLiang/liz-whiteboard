// @vitest-environment node
// src/lib/oauth/clients.test.ts
// Unit tests for the DCR client store (registerClient/getClient/markAuthorized/
// sweepOrphanClients). Uses the real in-memory SQLite DB (DATABASE_URL=:memory:
// from vitest.config.ts), same pattern as tokens.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetClientStoreForTests,
  getClient,
  markAuthorized,
  registerClient,
  sweepOrphanClients,
} from './clients'
import { db, nowMs } from '@/db'

beforeEach(() => {
  _resetClientStoreForTests()
})

describe('registerClient / getClient: JSON round-trip (AC4)', () => {
  it('registers a client and returns a public (no-secret) 7591-shaped result', () => {
    const client = registerClient({
      redirectUris: ['http://127.0.0.1:8080/callback'],
      clientName: 'Test MCP Client',
    })

    expect(client.clientId).toMatch(/^[0-9a-f]{32}$/)
    expect(client.redirectUris).toEqual(['http://127.0.0.1:8080/callback'])
    expect(client.name).toBe('Test MCP Client')
    // BLOCKER fix (2026-07-18): DCR rows are always untrusted — the
    // confused-deputy takeover relied on this being `true`.
    expect(client.trusted).toBe(false)
    expect(client.tokenEndpointAuthMethod).toBe('none')
    expect(client.grantTypes).toEqual(['authorization_code', 'refresh_token'])
    expect(client.responseTypes).toEqual(['code'])
    expect((client as unknown as { client_secret?: unknown }).client_secret).toBeUndefined()
  })

  it('persists the client and getClient() round-trips it (JSON columns parsed back to arrays)', () => {
    const registered = registerClient({
      redirectUris: [
        'http://127.0.0.1:8080/callback',
        'https://example.com/callback',
      ],
      clientName: 'Round Trip Client',
      scope: 'whiteboard',
      softwareId: 'my-cli-tool',
    })

    const fetched = getClient(registered.clientId)
    expect(fetched).not.toBeNull()
    expect(fetched?.clientId).toBe(registered.clientId)
    expect(fetched?.redirectUris).toEqual([
      'http://127.0.0.1:8080/callback',
      'https://example.com/callback',
    ])
    expect(fetched?.name).toBe('Round Trip Client')
    expect(fetched?.firstParty).toBe(false)
    // BLOCKER fix (2026-07-18): persisted row is untrusted.
    expect(fetched?.trusted).toBe(false)
  })

  it('returns null from getClient() for an unknown clientId', () => {
    expect(getClient('does-not-exist')).toBeNull()
  })

  it('survives a simulated restart (row is a real DB row, not in-memory state)', () => {
    const registered = registerClient({
      redirectUris: ['http://127.0.0.1:8080/callback'],
    })
    // Read directly via a fresh query (proxy for "after restart" since the
    // module doesn't cache in-memory — getClient() always hits the DB).
    const row = db
      .prepare('SELECT * FROM "OauthClient" WHERE clientId = ?')
      .get(registered.clientId)
    expect(row).toBeDefined()
  })
})

describe('markAuthorized', () => {
  it('sets lastAuthorizedAt on the matching row', () => {
    const registered = registerClient({
      redirectUris: ['http://127.0.0.1:8080/callback'],
    })
    const before = db
      .prepare('SELECT lastAuthorizedAt FROM "OauthClient" WHERE clientId = ?')
      .get(registered.clientId) as { lastAuthorizedAt: number | null }
    expect(before.lastAuthorizedAt).toBeNull()

    markAuthorized(registered.clientId)

    const after = db
      .prepare('SELECT lastAuthorizedAt FROM "OauthClient" WHERE clientId = ?')
      .get(registered.clientId) as { lastAuthorizedAt: number | null }
    expect(after.lastAuthorizedAt).not.toBeNull()
  })

  it('is a safe no-op for a clientId with no OauthClient row (CIMD/static clients)', () => {
    expect(() => markAuthorized('mcp-claude')).not.toThrow()
  })
})

describe('sweepOrphanClients: orphan GC', () => {
  it('deletes never-authorized rows older than the TTL and keeps recent/authorized ones', () => {
    vi.useFakeTimers()
    try {
      // Row 1: registered "now", never authorized -> should survive (too young).
      const recentOrphan = registerClient({
        redirectUris: ['http://127.0.0.1:8080/callback'],
      })

      // Row 2: registered "now" but will be authorized -> should always survive.
      const authorizedClient = registerClient({
        redirectUris: ['http://127.0.0.1:8081/callback'],
      })
      markAuthorized(authorizedClient.clientId)

      // Advance the clock 25 hours (past the 24h orphan TTL) and register a
      // third client whose createdAt reflects the advanced clock, then rewind
      // the never-authorized row 1's createdAt directly to simulate age.
      db.prepare('UPDATE "OauthClient" SET createdAt = ? WHERE clientId = ?').run(
        nowMs() - 25 * 60 * 60 * 1000,
        recentOrphan.clientId,
      )

      sweepOrphanClients()

      expect(getClient(recentOrphan.clientId)).toBeNull()
      expect(getClient(authorizedClient.clientId)).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a never-authorized row that is younger than the TTL', () => {
    const freshOrphan = registerClient({
      redirectUris: ['http://127.0.0.1:8080/callback'],
    })
    sweepOrphanClients()
    expect(getClient(freshOrphan.clientId)).not.toBeNull()
  })

  it('deletes authorized rows whose lastAuthorizedAt is older than the stale TTL (W6 fix)', () => {
    const staleAuthorized = registerClient({
      redirectUris: ['http://127.0.0.1:8082/callback'],
    })
    markAuthorized(staleAuthorized.clientId)
    // Push lastAuthorizedAt back past the 90-day stale-authorized TTL —
    // simulates a client that was used once, then abandoned. The original
    // GC only ever looked at lastAuthorizedAt IS NULL, so this row would
    // have survived forever before the fix.
    db.prepare(
      'UPDATE "OauthClient" SET lastAuthorizedAt = ? WHERE clientId = ?',
    ).run(nowMs() - 91 * 24 * 60 * 60 * 1000, staleAuthorized.clientId)

    sweepOrphanClients()

    expect(getClient(staleAuthorized.clientId)).toBeNull()
  })

  it('keeps an authorized row whose lastAuthorizedAt is within the stale TTL', () => {
    const recentAuthorized = registerClient({
      redirectUris: ['http://127.0.0.1:8083/callback'],
    })
    markAuthorized(recentAuthorized.clientId)

    sweepOrphanClients()

    expect(getClient(recentAuthorized.clientId)).not.toBeNull()
  })
})

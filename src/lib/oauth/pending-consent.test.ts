// @vitest-environment node
// src/lib/oauth/pending-consent.test.ts
// Unit tests for the in-memory pending-consent store (mcp-oauth-dcr-consent):
// creation, non-destructive peek, single-use consume, and TTL expiry. Mirrors
// src/lib/oauth/codes.test.ts's style (there isn't one — this mirrors the
// authorize.test.ts convention of testing real store behavior, not mocks).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPendingConsentForTests,
  consumePendingConsent,
  createPendingConsent,
  peekPendingConsent,
} from './pending-consent'

const baseParams = {
  clientId: 'client-abc',
  clientName: 'Test Client',
  redirectUri: 'http://127.0.0.1:8080/callback',
  scope: 'whiteboard',
  codeChallenge: 'test-challenge',
  codeChallengeMethod: 'S256' as const,
  resource: 'http://localhost:8080/mcp',
  state: 'xyz',
  userId: 'user-1',
}

beforeEach(() => {
  _resetPendingConsentForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createPendingConsent / peekPendingConsent', () => {
  it('creates a request and peek returns it without consuming it', () => {
    const requestId = createPendingConsent(baseParams)
    expect(requestId).toMatch(/^[0-9a-f]{64}$/)

    const first = peekPendingConsent(requestId)
    expect(first).not.toBeNull()
    expect(first?.clientId).toBe('client-abc')
    expect(first?.scope).toBe('whiteboard')

    // Peek again — still there (non-destructive).
    const second = peekPendingConsent(requestId)
    expect(second).not.toBeNull()
    expect(second?.clientId).toBe('client-abc')
  })

  it('returns null for an unknown request_id', () => {
    expect(peekPendingConsent('never-issued')).toBeNull()
  })

  it('mints distinct opaque ids across calls', () => {
    const a = createPendingConsent(baseParams)
    const b = createPendingConsent(baseParams)
    expect(a).not.toBe(b)
  })
})

describe('consumePendingConsent (single-use, delete-on-read)', () => {
  it('returns the request on first consume and null on a replay', () => {
    const requestId = createPendingConsent(baseParams)

    const first = consumePendingConsent(requestId)
    expect(first).not.toBeNull()
    expect(first?.userId).toBe('user-1')

    const replay = consumePendingConsent(requestId)
    expect(replay).toBeNull()
  })

  it('consuming also makes a subsequent peek return null (deleted, not just marked used)', () => {
    const requestId = createPendingConsent(baseParams)
    consumePendingConsent(requestId)
    expect(peekPendingConsent(requestId)).toBeNull()
  })

  it('returns null for an unknown request_id', () => {
    expect(consumePendingConsent('never-issued')).toBeNull()
  })
})

describe('TTL expiry', () => {
  it('peek and consume both return null once the TTL has elapsed', () => {
    vi.useFakeTimers()
    const requestId = createPendingConsent(baseParams, 1000) // 1s TTL
    vi.advanceTimersByTime(1001)

    expect(peekPendingConsent(requestId)).toBeNull()
    expect(consumePendingConsent(requestId)).toBeNull()
  })

  it('is still valid just before the TTL elapses', () => {
    vi.useFakeTimers()
    const requestId = createPendingConsent(baseParams, 5000)
    vi.advanceTimersByTime(4000)

    expect(peekPendingConsent(requestId)).not.toBeNull()
  })
})

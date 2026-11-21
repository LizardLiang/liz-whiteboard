// src/lib/oauth/codes.ts
// In-memory authorization code store
//
// STORAGE DECISION (first increment):
//   Auth codes are stored in a module-level Map with TTL-based expiry.
//   Each code is single-use and short-lived (default 120 seconds).
//   Tradeoffs:
//   - PRO: No schema change required for this increment
//   - CON: Lost on server restart; not suitable for multi-instance deployments
//   - Follow-up slice: persist codes in an oauth_codes DB table
//
// The cleanup is lazy (on lookup) plus a periodic sweep.

import { randomBytes } from 'node:crypto'
import type { OAuthConfig } from './config'

export interface AuthCode {
  code: string
  clientId: string
  redirectUri: string
  userId: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  resource: string
  scope: string
  expiresAt: number // unix ms
  used: boolean
  /** Refresh-token family the code produced; set once tokens are issued. */
  familyId?: string
}

// In-memory store: code → AuthCode
const codeStore = new Map<string, AuthCode>()

/** Periodically sweep expired/used codes every 5 minutes */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let sweepTimer: ReturnType<typeof setInterval> | null = null

function startSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [code, entry] of codeStore) {
      // Used codes stay until expiry so a replay can still find its family.
      if (entry.expiresAt < now) {
        codeStore.delete(code)
      }
    }
  }, SWEEP_INTERVAL_MS)
  // Don't keep Node.js alive just for cleanup
  sweepTimer.unref()
}

/**
 * Issue a new authorization code bound to the given parameters.
 * Returns the raw code string.
 */
export function issueAuthCode(
  params: Omit<AuthCode, 'code' | 'expiresAt' | 'used'>,
  config: Pick<OAuthConfig, 'authCodeTtl'>,
): string {
  startSweep()
  const code = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + config.authCodeTtl * 1000
  codeStore.set(code, { ...params, code, expiresAt, used: false })
  return code
}

/**
 * Look up and consume an authorization code.
 * Returns the AuthCode if valid and unused; null if invalid/expired/already used.
 * The code is marked used on successful retrieval (single-use guarantee).
 */
export function consumeAuthCode(code: string): AuthCode | null {
  const entry = codeStore.get(code)
  if (!entry) return null
  if (entry.used) return null
  if (entry.expiresAt < Date.now()) {
    codeStore.delete(code)
    return null
  }
  // Mark as used (prevent replay)
  entry.used = true
  return entry
}

/**
 * Look up an authorization code WITHOUT consuming it. Returns the AuthCode if
 * it exists, is unused and unexpired; otherwise null. Used by /token to prove a
 * client is known before any network work; consumeAuthCode stays the only
 * mutation and remains atomic.
 */
export function peekAuthCode(code: string): AuthCode | null {
  const entry = codeStore.get(code)
  if (!entry || entry.used || entry.expiresAt < Date.now()) return null
  return entry
}

/** Record the refresh-token family that a consumed code produced. */
export function setAuthCodeFamily(code: string, familyId: string): void {
  const entry = codeStore.get(code)
  if (entry?.used) entry.familyId = familyId
}

/**
 * Family of tokens issued from a code that was already used, or null when the
 * code is unknown, still unused, expired, or produced no tokens (RFC 6749
 * §4.1.2: a replayed code must revoke the tokens it already produced).
 */
export function findReplayedCodeFamily(code: string): string | null {
  const entry = codeStore.get(code)
  if (!entry || !entry.used || entry.expiresAt < Date.now()) return null
  return entry.familyId ?? null
}

/** Reset the store (for testing only) */
export function _resetCodesForTests(): void {
  codeStore.clear()
}

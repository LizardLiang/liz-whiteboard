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
      if (entry.used || entry.expiresAt < now) {
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

/** Reset the store (for testing only) */
export function _resetCodesForTests(): void {
  codeStore.clear()
}

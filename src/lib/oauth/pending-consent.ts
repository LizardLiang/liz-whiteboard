// src/lib/oauth/pending-consent.ts
// In-memory pending-consent-request store (mcp-oauth-dcr-consent).
//
// TRANSPORT DECISION (tactical plan "Consent transport" facet): the browser
// never carries redirect_uri/PKCE/state across the hop to /oauth/consent and
// back — only an opaque `request_id`. /authorize fully validates and resolves
// the authorize request BEFORE creating a pending record, so post-consent
// tampering with the underlying grant params is structurally impossible (the
// browser has nothing to tamper with). This mirrors the auth-code store
// (src/lib/oauth/codes.ts) almost exactly: same in-memory Map + TTL + lazy +
// periodic sweep + single-use shape, same test-reset export.
//
// STORAGE DECISION: in-memory, so pending requests die on server restart and
// don't survive multi-instance deploys — same tradeoff as codes.ts. TTL is
// short (~5 min) so a user mid-consent during a deploy simply retries.
//
// Single-use: consumePendingConsent() deletes the entry outright (unlike
// codes.ts, which marks `used` and lets the sweep reclaim it later) — a
// consent decision, unlike an auth code, is never looked up again after
// consumption, so there is no reason to keep the row around at all.

import { randomBytes } from 'node:crypto'

export interface PendingConsentRequest {
  requestId: string
  clientId: string
  /** Display name resolved once at /authorize time (client.name). */
  clientName: string
  redirectUri: string
  /** Space-delimited, already intersected with config.scopes — see authorize.ts. */
  scope: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  resource: string
  state: string
  /** The user who was authenticated at /authorize when this was created. */
  userId: string
  expiresAt: number // unix ms
}

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

// In-memory store: requestId → PendingConsentRequest
const pendingStore = new Map<string, PendingConsentRequest>()

/** Periodically sweep expired requests every 5 minutes (mirrors codes.ts). */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let sweepTimer: ReturnType<typeof setInterval> | null = null

function startSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [requestId, entry] of pendingStore) {
      if (entry.expiresAt < now) {
        pendingStore.delete(requestId)
      }
    }
  }, SWEEP_INTERVAL_MS)
  // Don't keep Node.js alive just for cleanup.
  sweepTimer.unref()
}

/**
 * Create a new pending consent request. Returns the opaque request_id used
 * in the /oauth/consent?request_id=<id> redirect.
 */
export function createPendingConsent(
  params: Omit<PendingConsentRequest, 'requestId' | 'expiresAt'>,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  startSweep()
  const requestId = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + ttlMs
  pendingStore.set(requestId, { ...params, requestId, expiresAt })
  return requestId
}

/**
 * Non-destructive read — used by the consent page's loader to render client
 * name / redirect URI / scopes without consuming the request (a reload of
 * the consent page must still show the same prompt). Returns null if
 * unknown or expired.
 */
export function peekPendingConsent(
  requestId: string,
): PendingConsentRequest | null {
  const entry = pendingStore.get(requestId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    pendingStore.delete(requestId)
    return null
  }
  return entry
}

/**
 * Look up and consume (delete) a pending consent request. Returns the
 * request if valid and unexpired; null otherwise. Called exactly once, by
 * the approve/deny server function — single-use guarantee.
 */
export function consumePendingConsent(
  requestId: string,
): PendingConsentRequest | null {
  const entry = pendingStore.get(requestId)
  if (!entry) return null
  pendingStore.delete(requestId)
  if (entry.expiresAt < Date.now()) return null
  return entry
}

/** Reset the store (for testing only). */
export function _resetPendingConsentForTests(): void {
  pendingStore.clear()
}

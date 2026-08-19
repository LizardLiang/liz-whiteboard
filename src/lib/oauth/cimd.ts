// src/lib/oauth/cimd.ts
// Client ID Metadata Document (CIMD) resolution.
//
// CIMD lets a client present an absolute https URL as its OAuth `client_id`.
// The authorization server fetches that URL, validates the JSON document
// found there as RFC 7591 client metadata, and treats it as the client's
// registration — no open /register endpoint needed for this path.
//
// TRUST MODEL (mcp-oauth-open-cimd, 2026-08-19 — supersedes the closed
// allowlist shipped 2026-07-18): resolution is now OPEN. Any valid https CIMD
// document resolves; the origin list in src/lib/oauth/cimd-origins.ts decides
// only whether the resulting client is VERIFIED (`trusted: true` →
// auto-approve) or UNVERIFIED (`trusted: false` → routed through the consent
// screen by src/routes/authorize.ts, exactly like a DCR client). MCP spec
// 2026-07-28 deprecates RFC 7591 DCR and makes CIMD the preferred path, which
// is why this had to open up: VS Code's CIMD origin is not publishable, so an
// allowlist could never have covered it.
//
// SECURITY MODEL (SSRF + spoofing mitigations):
//   - https-only (the one exception is a named CIMD_TEST_ORIGINS entry, which
//     is ignored entirely when NODE_ENV=production — see cimd-origins.ts).
//   - SSRF: the target host is vetted by src/lib/oauth/ssrf-guard.ts (IP
//     literals, internal suffixes, and any host resolving into a private /
//     loopback / link-local / ULA / CGNAT / multicast range are refused). This
//     replaces the origin allowlist's former role as the SSRF control.
//   - No anonymous egress: /authorize defers resolution of an untrusted origin
//     until the user is authenticated (see isUntrustedCimdCandidate in
//     src/lib/oauth/resolve-client.ts).
//   - Fetch is capped at 5s (AbortSignal.timeout) and the response body is
//     capped at ~32KB, enforced while streaming (not just after buffering).
//   - Redirects are NOT followed (`redirect: 'manual'`) — a redirect response
//     is treated as a failed fetch, so one origin can't bounce the AS into
//     fetching an arbitrary internal/external URL.
//   - Self-reference check: the document's `client_id` field MUST equal the
//     URL it was fetched from (RFC 7591 self-asserted CIMD convention) —
//     otherwise one origin could vouch for an arbitrary identity.
//   - Both caches are bounded (LRU + TTL). Before open resolution the key
//     space was limited to claude.ai URLs; now any caller can mint keys, so
//     unbounded Maps would be a memory-exhaustion vector.
//   - OAUTH_ALLOW_OPEN_CIMD=false restores the closed behaviour.

import {
  isCimdUrl,
  isOpenCimdEnabled,
  isTrustedCimdOrigin,
} from './cimd-origins'
import { checkPublicHost } from './ssrf-guard'
import type { OAuthClient } from './config'

const FETCH_TIMEOUT_MS = 5000
const MAX_BODY_BYTES = 32 * 1024 // ~32KB
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes
/** Last-known-good entries expire too — see lastKnownGoodCache below. */
const LAST_KNOWN_GOOD_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
/** Per-cache entry cap. Bounds memory against attacker-minted client_id URLs. */
const MAX_CACHE_ENTRIES = 500

interface CimdDocument {
  client_id: string
  redirect_uris?: Array<string>
  client_name?: string
}

interface CacheEntry {
  client: OAuthClient
  expiresAt: number
}

/**
 * Insertion-ordered Map used as a bounded LRU with per-entry TTL.
 *
 * `Map` iterates in insertion order, so the first key is the least recently
 * written; `get` re-inserts on hit so it becomes the most recent. Expired
 * entries are dropped lazily on read and opportunistically on write, which
 * mirrors the sweep style already used by codes.ts / pending-consent.ts
 * without needing a timer.
 */
class BoundedCache {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): OAuthClient | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return null
    }
    // Refresh recency so a hot key is not evicted ahead of a cold one.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.client
  }

  set(key: string, client: OAuthClient): void {
    const now = Date.now()
    // Opportunistic sweep: drop anything already expired before considering
    // eviction, so a full-but-stale cache never evicts a live entry.
    for (const [existingKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(existingKey)
    }

    this.entries.delete(key)
    this.entries.set(key, { client, expiresAt: now + this.ttlMs })

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  /** Entry count including not-yet-swept expired rows. Tests only. */
  get size(): number {
    return this.entries.size
  }
}

/** CIMD URL -> resolved client (short TTL). */
const cimdCache = new BoundedCache(MAX_CACHE_ENTRIES, CACHE_TTL_MS)

/**
 * CIMD URL -> most recently successfully-resolved client. ONLY consulted by
 * the refresh-token path (W4 fix) via `allowStaleOnFailure` — /authorize and
 * the authorization_code grant always require a fresh resolution (or a
 * still-live entry in `cimdCache`) and never fall back here, so a
 * compromised/renamed document is never trusted longer than CACHE_TTL_MS for
 * the paths that mint NEW grants.
 *
 * It used to have no TTL at all, which under open resolution would mean an
 * unbounded, permanently-growing map keyed by caller-supplied URLs.
 */
const lastKnownGoodCache = new BoundedCache(
  MAX_CACHE_ENTRIES,
  LAST_KNOWN_GOOD_TTL_MS,
)

/**
 * Origins already logged this process, so a busy untrusted client doesn't
 * flood the log. The point of the log line is discovery — an operator
 * connecting VS Code once needs to see which origin it presented so they can
 * promote it into CIMD_TRUSTED_ORIGINS.
 */
const loggedUntrustedOrigins = new Set<string>()

function logUntrustedCimdOrigin(origin: string, clientName: string): void {
  if (loggedUntrustedOrigins.has(origin)) return
  loggedUntrustedOrigins.add(origin)
  console.log(
    `[oauth/cimd] Resolved UNVERIFIED client from origin=${origin} name=${JSON.stringify(clientName)} — ` +
      `add this origin to CIMD_TRUSTED_ORIGINS to skip the consent screen for it`,
  )
}

/**
 * Read a fetch Response body as text, aborting once more than `maxBytes` have
 * been read. Streams the body instead of buffering-then-checking so an
 * oversized/slow response can't exhaust memory before the cap is enforced.
 * Returns null if the cap is exceeded, the body isn't streamable, or the
 * stream errors.
 */
async function readCappedBody(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  if (!response.body) {
    // W3 fix: previously fell back to `await response.text()`, which
    // buffers the ENTIRE body into memory before the size check runs —
    // directly contradicting the "streaming cap" guarantee this function
    // promises. Fail closed instead.
    return null
  }

  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')
}

/**
 * Resolve a CIMD client from its https client_id URL.
 *
 * Returns null on any validation/fetch failure — callers treat null the same
 * as "unknown client_id". A successful resolution carries `trusted` reflecting
 * whether the origin is in CIMD_TRUSTED_ORIGINS; an untrusted client is a
 * real, usable client that must clear the consent screen first.
 *
 * @param opts.allowStaleOnFailure - W4 fix: when true, a TRANSIENT failure
 *   (fetch throws/times out, non-2xx/redirect response, unreadable/oversized
 *   body, or unparsable JSON) falls back to the last successfully-resolved
 *   client for this URL, if any, instead of returning null. This exists so a
 *   brief origin outage doesn't invalidate an otherwise-valid refresh token
 *   for a previously-verified client.
 *
 *   Failures that indicate the document is invalid or spoofed — self-reference
 *   mismatch, missing redirect_uris — are NEVER given the stale fallback.
 *   Neither are structural refusals (non-https, SSRF-blocked host, open
 *   resolution disabled): those mean the URL was never eligible, not that it
 *   is briefly unreachable.
 *
 *   NOTE (mcp-oauth-open-cimd): "origin is not trusted" is no longer a
 *   fallback-suppressing signal. It used to imply spoofing because untrusted
 *   origins could not resolve at all; now it merely means the client needs
 *   consent, and the user's persisted OauthGrant — not the document — is the
 *   authority for an already-approved untrusted client. Revocation deletes
 *   that grant and its refresh tokens directly (src/lib/oauth/grants.ts), so
 *   a stale document cannot keep a revoked client alive.
 *
 *   Only set this for the refresh_token grant (src/routes/token.ts); never
 *   for /authorize or the authorization_code grant.
 */
export async function resolveCimdClient(
  url: string,
  opts: { allowStaleOnFailure?: boolean } = {},
): Promise<OAuthClient | null> {
  const cached = cimdCache.get(url)
  if (cached) return cached

  const staleFallback = (): OAuthClient | null =>
    opts.allowStaleOnFailure ? lastKnownGoodCache.get(url) : null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }
  // https, or a named CIMD_TEST_ORIGINS entry outside production.
  if (!isCimdUrl(url)) return null

  const origin = parsedUrl.origin
  const trusted = isTrustedCimdOrigin(origin)

  // Kill switch: with open resolution disabled, only trusted origins resolve —
  // the pre-2026-08-19 behaviour. Not a transient failure, so no stale
  // fallback.
  if (!trusted && !isOpenCimdEnabled()) return null

  // SSRF guard. Structural refusal — never eligible, so no stale fallback.
  const hostCheck = await checkPublicHost(parsedUrl.hostname, origin)
  if (!hostCheck.allowed) {
    console.warn(
      `[oauth/cimd] Refused client_id=${url} — ${hostCheck.reason ?? 'blocked host'}`,
    )
    return null
  }

  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual', // never follow redirects off the requested origin
      headers: { Accept: 'application/json' },
    })
  } catch {
    // Network error / timeout — the archetypal transient outage.
    return staleFallback()
  }

  // redirect: 'manual' surfaces 3xx responses with their real status instead
  // of following them — treat any redirect as a failed fetch.
  if (response.status >= 300 && response.status < 400) return staleFallback()
  if (!response.ok) return staleFallback()

  const text = await readCappedBody(response, MAX_BODY_BYTES)
  if (text === null) return staleFallback()

  let doc: CimdDocument
  try {
    doc = JSON.parse(text) as CimdDocument
  } catch {
    return staleFallback()
  }

  // Self-reference check (RFC 7591 CIMD convention): the document must vouch
  // for exactly the URL it was fetched from. A mismatch here is a spoofing
  // signal, not an outage — never fall back to stale trust.
  if (doc.client_id !== url) return null

  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) {
    return null
  }
  if (!doc.redirect_uris.every((u) => typeof u === 'string')) return null

  const client: OAuthClient = {
    clientId: url,
    redirectUris: doc.redirect_uris,
    name: typeof doc.client_name === 'string' ? doc.client_name : url,
    firstParty: false,
    trusted,
  }

  if (!trusted) logUntrustedCimdOrigin(origin, client.name)

  cimdCache.set(url, client)
  lastKnownGoodCache.set(url, client)
  return client
}

/** Reset the CIMD resolution caches. For tests only. */
export function _resetCimdCacheForTests(): void {
  cimdCache.clear()
  lastKnownGoodCache.clear()
  loggedUntrustedOrigins.clear()
}

/** Live entry counts, for cache-bound tests only. */
export function _cimdCacheSizesForTests(): {
  resolved: number
  lastKnownGood: number
} {
  return { resolved: cimdCache.size, lastKnownGood: lastKnownGoodCache.size }
}

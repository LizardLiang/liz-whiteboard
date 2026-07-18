// src/lib/oauth/cimd.ts
// Client ID Metadata Document (CIMD) resolution.
//
// CIMD lets a client present an absolute https URL as its OAuth `client_id`.
// The authorization server fetches that URL, validates the JSON document
// found there as RFC 7591 client metadata, and treats it as the client's
// registration — no open /register endpoint needed for this path. Claude Code
// uses CIMD (client_id_metadata_document_supported: true, advertised in
// as-metadata.ts).
//
// SECURITY MODEL (SSRF + spoofing mitigations):
//   - https-only; the URL's origin MUST be in CIMD_ALLOWED_ORIGINS (default
//     claude.ai / claude.com — the only clients we intend to trust this way).
//   - Fetch is capped at 5s (AbortSignal.timeout) and the response body is
//     capped at ~32KB, enforced while streaming (not just after buffering).
//   - Redirects are NOT followed (`redirect: 'manual'`) — a redirect response
//     is treated as a failed fetch, so an allowlisted origin can't be used to
//     bounce the AS into fetching an arbitrary internal/external URL.
//   - Self-reference check: the document's `client_id` field MUST equal the
//     URL it was fetched from (RFC 7591 self-asserted CIMD convention) —
//     otherwise one allowlisted origin could vouch for an arbitrary identity.
//   - Resolved clients are cached by URL with a short TTL (mirrors the sweep
//     pattern in codes.ts) so a compromised/renamed document is re-fetched
//     periodically rather than trusted forever.

import type { OAuthClient } from './config'

const DEFAULT_ALLOWED_ORIGINS = ['https://claude.ai', 'https://claude.com']
const FETCH_TIMEOUT_MS = 5000
const MAX_BODY_BYTES = 32 * 1024 // ~32KB
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

interface CimdDocument {
  client_id: string
  redirect_uris?: Array<string>
  client_name?: string
}

interface CimdCacheEntry {
  client: OAuthClient
  expiresAt: number
}

// Module-level cache: CIMD URL -> resolved client (short TTL).
const cimdCache = new Map<string, CimdCacheEntry>()

function getAllowedOrigins(): Array<string> {
  const raw = process.env.CIMD_ALLOWED_ORIGINS
  if (!raw) return DEFAULT_ALLOWED_ORIGINS
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((o) => typeof o === 'string')) {
      return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS
    }
    return DEFAULT_ALLOWED_ORIGINS
  } catch {
    console.warn(
      '[oauth/cimd] CIMD_ALLOWED_ORIGINS is not valid JSON; using default allowlist',
    )
    return DEFAULT_ALLOWED_ORIGINS
  }
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
    // promises (an unbounded response could exhaust memory before ever
    // reaching the byte-length check). Fail closed instead: if the runtime
    // doesn't give us a readable stream to bound as we go, refuse the
    // document rather than buffer unboundedly. In practice fetch()
    // responses backed by a real network body always expose `.body`.
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

// Last-known-good cache: CIMD URL -> most recently successfully-resolved
// client, kept indefinitely (no TTL). Updated on every successful resolution.
// ONLY consulted by the refresh-token path (W4 fix) via `allowStaleOnFailure`
// — /authorize and the authorization_code grant always require a fresh
// resolution (or a still-live entry in the short-TTL `cimdCache` above) and
// never fall back to this cache, so a compromised/renamed CIMD document is
// never trusted longer than CACHE_TTL_MS for the paths that mint NEW grants.
const lastKnownGoodCache = new Map<string, OAuthClient>()

/**
 * Resolve a CIMD client from its https client_id URL.
 * Returns null on any validation/fetch failure (origin not allowlisted,
 * fetch error, non-JSON body, size overrun, self-reference mismatch, etc.) —
 * callers treat null the same as "unknown client_id".
 *
 * @param opts.allowStaleOnFailure - W4 fix: when true, a TRANSIENT failure
 *   (fetch throws/times out, non-2xx/redirect response, unreadable/oversized
 *   body, or unparsable JSON) falls back to the last successfully-resolved
 *   client for this URL, if any, instead of returning null. This exists so a
 *   brief claude.ai outage doesn't invalidate an otherwise-valid refresh
 *   token for a previously-verified client. Failures that indicate the
 *   document itself is invalid or spoofed (origin not allowlisted,
 *   self-reference mismatch, missing redirect_uris) are NEVER given the
 *   stale fallback, regardless of this option — those aren't "transient".
 *   Only set this for the refresh_token grant (src/routes/token.ts); never
 *   for /authorize or the authorization_code grant.
 */
export async function resolveCimdClient(
  url: string,
  opts: { allowStaleOnFailure?: boolean } = {},
): Promise<OAuthClient | null> {
  const cached = cimdCache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client
  }

  const staleFallback = (): OAuthClient | null =>
    opts.allowStaleOnFailure ? (lastKnownGoodCache.get(url) ?? null) : null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }
  if (parsedUrl.protocol !== 'https:') return null

  const allowedOrigins = getAllowedOrigins()
  // Not a transient failure — the URL was never eligible to be trusted, so
  // no stale fallback even for the refresh path.
  if (!allowedOrigins.includes(parsedUrl.origin)) return null

  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual', // never follow redirects off the allowlisted origin
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
    trusted: true,
  }

  cimdCache.set(url, { client, expiresAt: Date.now() + CACHE_TTL_MS })
  lastKnownGoodCache.set(url, client)
  return client
}

/** Reset the CIMD resolution cache. For tests only. */
export function _resetCimdCacheForTests(): void {
  cimdCache.clear()
  lastKnownGoodCache.clear()
}

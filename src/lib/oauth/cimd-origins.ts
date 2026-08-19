// src/lib/oauth/cimd-origins.ts
// Trust policy for Client ID Metadata Document (CIMD) resolution.
//
// POLICY CHANGE (mcp-oauth-open-cimd, 2026-08-19 — supersedes the
// closed-allowlist policy shipped 2026-07-18): the origin list no longer
// decides whether a CIMD document may be resolved AT ALL. Every valid https
// CIMD document now resolves; the origin list decides only whether the
// resolved client is VERIFIED (auto-approve, no consent screen) or UNVERIFIED
// (routed through /oauth/consent like a DCR client — see
// src/routes/authorize.ts). That is why the variable was renamed:
// CIMD_ALLOWED_ORIGINS said "allowed at all", which is no longer what it
// means. The old name is still read as a deprecated alias so a deployed
// stack keeps working across the upgrade.
//
// MCP spec 2026-07-28 leaves this policy to the AS ("MAY implement
// domain-based trust policies ... or accept any HTTPS client_id"); this
// module is where that choice lives.

/**
 * Origins whose CIMD documents skip the consent screen.
 *
 * - claude.ai / claude.com — Claude Code, live-verified
 *   (https://claude.ai/oauth/claude-code-client-metadata).
 * - chatgpt.com — Codex CLI + IDE extension. CIMD is wired up in Codex's
 *   production path (openai/codex `codex-rs/rmcp-client/src/
 *   oauth_client_registration.rs`); the document path carries a per-login
 *   callback id, which is why trust is evaluated per-ORIGIN, never per-URL.
 * - zed.dev — Zed. Secondary-source only; see the tactical plan's
 *   Assumptions. Inert if wrong (nothing resolves at an origin that serves
 *   no document).
 *
 * Not listed: VS Code. It implements CIMD, but its client-metadata URL lives
 * only in Microsoft's proprietary product.json and is absent from the OSS
 * repo, so there is no origin to trust. VS Code still works — it takes the
 * one-time consent path like any unverified CIMD client, and an operator who
 * wants it silent can read the origin out of the resolution log (see
 * logUntrustedCimdOrigin in src/lib/oauth/cimd.ts) and add it here via env.
 */
const DEFAULT_TRUSTED_ORIGINS = [
  'https://claude.ai',
  'https://claude.com',
  'https://chatgpt.com',
  'https://zed.dev',
]

/**
 * Parse a JSON array-of-strings env var. Returns null when unset, malformed,
 * or not an array of strings, so callers can fall back deliberately rather
 * than silently treating a typo as an empty list.
 */
function parseOriginList(
  raw: string | undefined,
  varName: string,
): Array<string> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((o) => typeof o === 'string')) {
      return parsed.length > 0 ? parsed : null
    }
    console.warn(
      `[oauth/cimd] ${varName} is not a JSON array of strings; ignoring`,
    )
    return null
  } catch {
    console.warn(`[oauth/cimd] ${varName} is not valid JSON; ignoring`)
    return null
  }
}

/**
 * The configured trusted-origin list.
 *
 * CIMD_TRUSTED_ORIGINS is the current name. CIMD_ALLOWED_ORIGINS is honoured
 * as a deprecated alias (it meant "allowed at all" before open resolution
 * existed) so an already-deployed stack does not silently lose its trusted
 * origins on upgrade. The new name wins when both are set.
 */
export function getTrustedCimdOrigins(): Array<string> {
  const current = parseOriginList(
    process.env.CIMD_TRUSTED_ORIGINS,
    'CIMD_TRUSTED_ORIGINS',
  )
  if (current) return current

  const legacy = parseOriginList(
    process.env.CIMD_ALLOWED_ORIGINS,
    'CIMD_ALLOWED_ORIGINS',
  )
  if (legacy) return legacy

  return DEFAULT_TRUSTED_ORIGINS
}

/** Whether a CIMD document from this origin skips the consent screen. */
export function isTrustedCimdOrigin(origin: string): boolean {
  return getTrustedCimdOrigins().includes(origin)
}

/**
 * Kill switch. When OAUTH_ALLOW_OPEN_CIMD is explicitly 'false', resolution
 * reverts to the pre-2026-08-19 behaviour: only trusted origins resolve and
 * every other https client_id is rejected as an unknown client. Mirrors
 * OAUTH_ALLOW_DCR (src/routes/oauth/register.ts) — the operator's lever if
 * open resolution is ever abused.
 */
export function isOpenCimdEnabled(): boolean {
  return process.env.OAUTH_ALLOW_OPEN_CIMD !== 'false'
}

/**
 * Origins exempted from the private-address check in
 * src/lib/oauth/ssrf-guard.ts, so the e2e suite can serve a CIMD document
 * from a local test server.
 *
 * Deliberately a LIST, not a boolean: a boolean would open the entire private
 * range whenever it was truthy, which is the shape of DEBUG_SUPER_PASSWORD —
 * flagged as a real finding in an earlier review of this project. Only hosts
 * someone explicitly named are ever exempt.
 *
 * Hard-refused in production regardless of value: a leaked or copy-pasted
 * .env line cannot open an SSRF path on a live deployment.
 */
export function getCimdTestOrigins(): Array<string> {
  const raw = process.env.CIMD_TEST_ORIGINS
  if (!raw) return []

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[oauth/cimd] CIMD_TEST_ORIGINS is set but ignored in production',
    )
    return []
  }

  return parseOriginList(raw, 'CIMD_TEST_ORIGINS') ?? []
}

/**
 * Whether a client_id string should be resolved as a CIMD document URL.
 *
 * Normally that means https. A named CIMD_TEST_ORIGINS entry may also be
 * plain http, because the e2e suite has to serve a document from a local
 * server and the AS fetches it server-side — there is no way to intercept
 * that from the browser, and minting real TLS for a loopback origin would add
 * an openssl dependency to the test run.
 *
 * Same blast radius as the address exemption above: only origins someone
 * explicitly named, and never in production.
 */
export function isCimdUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return getCimdTestOrigins().includes(url.origin)
}

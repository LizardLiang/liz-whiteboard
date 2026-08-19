// src/lib/oauth/resolve-client.ts
// Client resolution seam used by /authorize and /token.
//
// Resolution order (see decision tree in the tactical plan):
//   1. clientId is an absolute https URL  -> CIMD (src/lib/oauth/cimd.ts)
//   2. clientId matches the static allowlist (OAUTH_ALLOWED_CLIENTS /
//      DEFAULT_MCP_CLIENT)                 -> findClient() (unchanged)
//   3. clientId matches an OauthClient DB row (DCR)
//                                           -> getClient() (src/lib/oauth/clients.ts)
//   4. none of the above                   -> null (unauthorized_client / invalid_client)
//
// CIMD resolution returns `trusted: true` ONLY for origins in
// CIMD_TRUSTED_ORIGINS (src/lib/oauth/cimd-origins.ts); since
// mcp-oauth-open-cimd (2026-08-19) any other https origin still resolves, but
// with `trusted: false`. DCR rows are always persisted `trusted: false` (see
// src/lib/oauth/clients.ts). /authorize never auto-approves a client where
// `firstParty || trusted` is false; it routes it through the consent screen
// instead (src/routes/oauth/consent.tsx, mcp-oauth-dcr-consent, 2026-08-06).

import { findClient, getOAuthConfig } from './config'
import {
  isCimdUrl,
  isOpenCimdEnabled,
  isTrustedCimdOrigin,
} from './cimd-origins'
import type { OAuthClient } from './config'

// Resolves as CIMD when the client_id is an https URL — or a named
// CIMD_TEST_ORIGINS entry, which the e2e suite serves over plain http and
// which is ignored in production (src/lib/oauth/cimd-origins.ts).

/**
 * Whether this client_id would trigger an outbound fetch to an origin we do
 * NOT trust. Pure — parses the string and consults config, never touches the
 * network.
 *
 * /authorize uses this to decide ordering (mcp-oauth-open-cimd): resolving an
 * untrusted origin means fetching a URL an anonymous caller chose, so that
 * fetch must not happen until the session cookie has been validated.
 * Everything else (static allowlist, DCR rows, trusted CIMD origins) keeps
 * resolving in its original position, which is what leaves the existing
 * error-response shapes in src/routes/authorize.test.ts untouched.
 */
export function isUntrustedCimdCandidate(clientId: string): boolean {
  if (!clientId || !isCimdUrl(clientId)) return false
  if (!isOpenCimdEnabled()) return false
  return !isTrustedCimdOrigin(new URL(clientId).origin)
}

export interface ResolveClientOptions {
  /**
   * W4 fix: pass true ONLY from the refresh_token grant handler
   * (src/routes/token.ts). Lets CIMD resolution fall back to a
   * last-known-good cached client on a transient claude.ai outage, so a
   * valid, previously-issued refresh token isn't rejected just because the
   * CIMD document couldn't be re-fetched right now. /authorize and the
   * authorization_code grant must NEVER set this — they always require a
   * fresh (or still-live short-TTL-cached) CIMD resolution.
   */
  forRefresh?: boolean
}

export async function resolveClient(
  clientId: string,
  opts: ResolveClientOptions = {},
): Promise<OAuthClient | null> {
  if (!clientId) return null

  if (isCimdUrl(clientId)) {
    const { resolveCimdClient } = await import('./cimd')
    return resolveCimdClient(clientId, {
      allowStaleOnFailure: opts.forRefresh === true,
    })
  }

  const config = getOAuthConfig()
  const staticClient = findClient(clientId, config)
  if (staticClient) return staticClient

  const { getClient } = await import('./clients')
  return getClient(clientId)
}

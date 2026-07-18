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
// CIMD resolution returns `trusted: true`; DCR rows are always persisted
// `trusted: false` (see src/lib/oauth/clients.ts) — /authorize refuses any
// client where `firstParty || trusted` is false rather than downgrading it
// (BLOCKER fix, 2026-07-18).

import { findClient, getOAuthConfig } from './config'
import type { OAuthClient } from './config'

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
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

  if (isAbsoluteHttpsUrl(clientId)) {
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

// src/lib/oauth/handlers/as-metadata.ts
// Nitro/H3 event handler for GET /.well-known/oauth-authorization-server
// RFC 8414 Authorization Server Metadata
//
// This file is registered as a Nitro handler in vite.config.ts (not a
// TanStack Router file route) because TanStack Router's file scanner
// explicitly excludes files/directories starting with "." (dotfiles).
// Nitro's router handles the /.well-known/* paths before TanStack Start.

import { defineEventHandler, setHeader } from 'h3'
import { getOAuthConfig } from '../config'

/**
 * Builds the AS metadata body. Extracted from the h3 handler below (pure,
 * no H3Event dependency) so src/lib/oauth/handlers/as-metadata.test.ts can
 * exercise the registration_endpoint pairing directly without faking an h3
 * request/response.
 */
export async function buildAsMetadata(): Promise<Record<string, unknown>> {
  const config = getOAuthConfig()
  const issuer = config.issuer

  // registration_endpoint (mcp-oauth-dcr-consent, 2026-08-06 — supersedes the
  // 2026-07-18 BLOCKER-fix "deliberately NOT advertised" policy): now
  // advertised whenever DCR itself is enabled (src/routes/oauth/register.ts's
  // isDcrEnabled(), on by default) — the two are kept in lockstep so the kill
  // switch (OAUTH_ALLOW_DCR=false) removes both the endpoint and its
  // discovery together. Safe to advertise now that DCR-registered clients
  // must clear a real consent screen (src/routes/oauth/consent.tsx) and a
  // persisted per-user grant (src/lib/oauth/grants.ts) before ever receiving
  // a code — see the header comment in src/routes/authorize.ts.
  const { isDcrEnabled } = await import('@/routes/oauth/register')
  const dcrEnabled = isDcrEnabled()

  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/revoke`,
    ...(dcrEnabled
      ? { registration_endpoint: `${issuer}/oauth/register` }
      : {}),
    scopes_supported: config.scopes,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // RFC 8707 resource indicators
    resource_indicators_supported: true,
    // CIMD (Client ID Metadata Document) — the primary trust path for Claude
    // Code: an https URL as client_id, self-asserted RFC 7591 metadata.
    // See src/lib/oauth/cimd.ts.
    client_id_metadata_document_supported: true,
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return buildAsMetadata()
})

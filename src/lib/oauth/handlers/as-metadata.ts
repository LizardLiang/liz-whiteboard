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

export default defineEventHandler((event) => {
  const config = getOAuthConfig()
  const issuer = config.issuer

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  const metadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/revoke`,
    // registration_endpoint is deliberately NOT advertised (security review
    // BLOCKER fix, 2026-07-18): open, unauthenticated DCR combined with no
    // consent UI at /authorize allowed a confused-deputy attack — any
    // attacker-registered client could get an auth code phished from a
    // logged-in user via an attacker-controlled redirect_uri. The DCR
    // endpoint (src/routes/oauth/register.ts) still exists and is dormant
    // behind OAUTH_ALLOW_DCR, and DCR-registered clients are always
    // untrusted (see src/lib/oauth/clients.ts) and refused at /authorize
    // (see src/routes/authorize.ts) — but we also stop advertising it so
    // clients don't discover and depend on a path we intend to keep closed.
    // Re-enabling requires shipping a real consent screen first.
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

  return metadata
})

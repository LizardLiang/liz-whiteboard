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
    // DCR is deferred to a later slice
    // registration_endpoint: `${issuer}/register`,
    scopes_supported: config.scopes,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // RFC 8707 resource indicators
    resource_indicators_supported: true,
  }

  return metadata
})

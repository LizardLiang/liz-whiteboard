// src/lib/oauth/resource.ts
// RFC 8707 resource-indicator allowlist for the OAuth flow.
//
// The only audience the authorization server mints OAuth-flow access tokens
// for is the MCP resource. The collab audience is reserved for the
// /api/collab-token endpoint, so a client may never request it (or any other
// audience) through /authorize or /token.

import type { OAuthConfig } from './config'

/** True when `resource` is exactly the configured MCP resource URI. */
export function isAllowedResource(
  resource: string,
  config: Pick<OAuthConfig, 'mcpResourceUri'>,
): boolean {
  return resource === config.mcpResourceUri
}

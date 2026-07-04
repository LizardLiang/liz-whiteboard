// src/lib/oauth/config.ts
// OAuth 2.1 Authorization Server configuration
//
// STORAGE DECISION (first increment):
//   - Signing keys: loaded from env vars OAUTH_SIGNING_KEY_PRIVATE (PEM),
//     OAUTH_SIGNING_KEY_KID; if absent an ephemeral RS256 keypair is generated
//     at startup. Ephemeral keys do NOT survive server restarts — all issued
//     tokens become invalid on restart. Add a persistent key strategy (file or
//     DB) before production.
//   - Client allowlist: OAUTH_ALLOWED_CLIENTS env var (JSON array of
//     OAuthClient objects) or the built-in first-party MCP client.
//   - Auth codes: in-memory Map with TTL cleanup (acceptable for single-instance
//     dev; replace with DB table before multi-instance production).

export interface OAuthClient {
  clientId: string
  /** Exact allowed redirect URIs */
  redirectUris: Array<string>
  /** Display name for consent page */
  name: string
  /** If true, auto-approve without showing consent UI (first-party clients) */
  firstParty: boolean
}

export interface OAuthConfig {
  issuer: string
  /** Canonical resource URI of the MCP server (aud claim in access tokens) */
  mcpResourceUri: string
  /**
   * Canonical resource URI of the collab server (aud claim in collab-audience JWTs
   * issued by /api/collab-token). Must match COLLAB_RESOURCE_URI on the collab server.
   */
  collabResourceUri: string
  /**
   * Confidential client ID for the MCP backend (used by /api/collab-token).
   * Must match MCP_CLIENT_ID on the MCP server.
   */
  mcpClientId: string
  /**
   * Confidential client secret for the MCP backend (used by /api/collab-token).
   * Must match MCP_CLIENT_SECRET on the MCP server.
   */
  mcpClientSecret: string
  /** Collab-audience JWT TTL in seconds (default 120 = 2 min) */
  collabTokenTtl: number
  /** Supported scopes */
  scopes: Array<string>
  /** Access token TTL in seconds (default 600 = 10 min) */
  accessTokenTtl: number
  /** Refresh token TTL in seconds (default 604800 = 7 days) */
  refreshTokenTtl: number
  /** Authorization code TTL in seconds (default 120 = 2 min) */
  authCodeTtl: number
  clients: Array<OAuthClient>
}

/** First-party MCP client (Claude.ai / Claude Code) — registered by allowlist */
const DEFAULT_MCP_CLIENT: OAuthClient = {
  clientId: 'mcp-claude',
  redirectUris: [
    // Claude.ai web OAuth redirect
    'https://claude.ai/api/auth/oauth2/callback',
    // Claude Code CLI (loopback — spec requires exact match per RFC 8252 §8.3)
    'http://localhost:10000/callback',
    'http://127.0.0.1:10000/callback',
    // Development / testing
    'http://localhost:3000/oauth/callback',
  ],
  name: 'Claude MCP Client',
  firstParty: true,
}

function loadClients(): Array<OAuthClient> {
  const raw = process.env.OAUTH_ALLOWED_CLIENTS
  if (!raw) return [DEFAULT_MCP_CLIENT]
  try {
    const parsed = JSON.parse(raw) as Array<OAuthClient>
    return parsed
  } catch {
    console.warn(
      '[oauth] OAUTH_ALLOWED_CLIENTS is not valid JSON; using default client list',
    )
    return [DEFAULT_MCP_CLIENT]
  }
}

export function getOAuthConfig(): OAuthConfig {
  const issuer = process.env.OAUTH_ISSUER ?? 'http://localhost:3000'
  const mcpResourceUri =
    process.env.MCP_RESOURCE_URI ?? 'http://localhost:8080/mcp'
  const collabResourceUri =
    process.env.COLLAB_RESOURCE_URI ?? 'http://localhost:3010'

  return {
    issuer,
    mcpResourceUri,
    collabResourceUri,
    // MCP server's confidential client credentials for /api/collab-token.
    // These MUST be set in production; empty defaults are safe only in dev because
    // the endpoint rejects empty secrets.
    mcpClientId: process.env.MCP_CLIENT_ID ?? 'mcp-server',
    mcpClientSecret: process.env.MCP_CLIENT_SECRET ?? '',
    collabTokenTtl: 120, // 2 min — deliberately short, cached in MCP server
    scopes: ['whiteboard'],
    // Env-configurable TTLs (seconds). Defaults:
    //   access token  — 3600 (1 hr); operators wanting 10-min set OAUTH_ACCESS_TOKEN_TTL=600
    //   refresh token — 604800 (7 days)
    accessTokenTtl: Number(process.env.OAUTH_ACCESS_TOKEN_TTL ?? '3600'),
    refreshTokenTtl: Number(process.env.OAUTH_REFRESH_TOKEN_TTL ?? '604800'),
    authCodeTtl: 120, // 2 min
    clients: loadClients(),
  }
}

export function findClient(
  clientId: string,
  config: OAuthConfig,
): OAuthClient | undefined {
  return config.clients.find((c) => c.clientId === clientId)
}

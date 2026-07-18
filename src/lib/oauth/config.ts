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
  /**
   * If true, this client was resolved via a trusted mechanism (CIMD
   * self-asserted https document, or a DB-registered DCR client) — auto-approve
   * and grant full scope the same way firstParty clients do. Set by
   * resolveClient()'s CIMD/DCR paths; absent (undefined/false) for the static
   * allowlist unless explicitly marked.
   */
  trusted?: boolean
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
    // Claude Code CLI (loopback — redirectUriAllowed() matches scheme+host+path
    // and ignores port per RFC 8252 §7.3, so the CLI's dynamic ephemeral
    // callback port always matches this fixed-port entry).
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

/** Loopback hostnames per RFC 8252 §7.3 ("Loopback Interface Redirection"). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Check whether a presented redirect_uri is allowed against a client's
 * registered redirect URIs.
 *
 * RFC 8252 §7.3: native-app clients (e.g. Claude Code CLI) bind an
 * `http://127.0.0.1:<ephemeral-port>/...` loopback redirect at request time,
 * where the port is chosen dynamically per-run. A strict `.includes()` exact
 * match (RFC 6749 §3.1.2.3) breaks these clients because the registered URI
 * can only encode one fixed port. Per RFC 8252, the authorization server MUST
 * allow the loopback redirect to match on scheme + host + path while ignoring
 * the port.
 *
 * Non-loopback `http://` redirect URIs are always rejected — only https or
 * loopback-http is permitted (OAuth 2.1 §4.1.1).
 */
export function redirectUriAllowed(
  registered: Array<string>,
  presented: string,
): boolean {
  let presentedUrl: URL
  try {
    presentedUrl = new URL(presented)
  } catch {
    return false
  }

  const isPresentedLoopbackHttp =
    presentedUrl.protocol === 'http:' && LOOPBACK_HOSTS.has(presentedUrl.hostname)

  if (isPresentedLoopbackHttp) {
    return registered.some((reg) => {
      let regUrl: URL
      try {
        regUrl = new URL(reg)
      } catch {
        return false
      }
      return (
        regUrl.protocol === presentedUrl.protocol &&
        LOOPBACK_HOSTS.has(regUrl.hostname) &&
        regUrl.hostname === presentedUrl.hostname &&
        regUrl.pathname === presentedUrl.pathname
      )
    })
  }

  // Reject any other non-loopback http:// redirect outright.
  if (presentedUrl.protocol === 'http:') return false

  // Non-loopback: https is the ONLY other permitted scheme (OAuth 2.1
  // §4.1.1 / W1 fix). Any other scheme — javascript:, data:, vbscript:, a
  // custom app scheme, etc. — is rejected outright, even if it happens to
  // match an entry in `registered` verbatim, because a scheme-mismatched
  // redirect_uri can be used to smuggle script/markup into a context that
  // treats the redirect as trusted (e.g. rendering it in an auto-submitted
  // link or window.location assignment).
  if (presentedUrl.protocol !== 'https:') return false

  // https: exact string match (RFC 6749 §3.1.2.3).
  return registered.includes(presented)
}

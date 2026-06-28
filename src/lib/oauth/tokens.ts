// src/lib/oauth/tokens.ts
// JWT access token and refresh token issuance
//
// ACCESS TOKEN:  RS256-signed JWT
//   iss = AS issuer URL
//   aud = MCP resource URI (RFC 8707 audience binding)
//   sub = User.id (liz-whiteboard user ID)
//   scope = granted scopes
//   exp = now + accessTokenTtl (default 10 min)
//   iat, nbf = now
//   kid (in JWK header) = signing key ID
//
// REFRESH TOKEN: opaque random string stored in memory (first increment)
//   Follow-up: persist refresh tokens + rotation in oauth_tokens table

import { SignJWT } from 'jose'
import { randomBytes } from 'node:crypto'
import { getSigningKeyPair } from './keys'
import type { OAuthConfig } from './config'

export interface AccessTokenResult {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  refreshToken: string
  scope: string
}

// In-memory refresh token store: refreshToken → { userId, clientId, scope, resource, expiresAt }
export interface RefreshTokenEntry {
  refreshToken: string
  userId: string
  clientId: string
  scope: string
  resource: string
  expiresAt: number  // unix ms
}

const refreshTokenStore = new Map<string, RefreshTokenEntry>()

// Sweep every 15 minutes
let refreshSweepTimer: ReturnType<typeof setInterval> | null = null
function startRefreshSweep(): void {
  if (refreshSweepTimer) return
  refreshSweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [tok, entry] of refreshTokenStore) {
      if (entry.expiresAt < now) refreshTokenStore.delete(tok)
    }
  }, 15 * 60 * 1000)
  if (refreshSweepTimer.unref) refreshSweepTimer.unref()
}

/**
 * Issue an RS256 access token + refresh token for the given user/grant.
 */
export async function issueTokens(
  params: {
    userId: string
    clientId: string
    scope: string
    resource: string
  },
  config: OAuthConfig,
): Promise<AccessTokenResult> {
  startRefreshSweep()

  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + config.accessTokenTtl

  const accessToken = await new SignJWT({
    sub: params.userId,
    scope: params.scope,
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(config.issuer)
    .setAudience(params.resource)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  // Issue refresh token
  const refreshToken = randomBytes(32).toString('base64url')
  refreshTokenStore.set(refreshToken, {
    refreshToken,
    userId: params.userId,
    clientId: params.clientId,
    scope: params.scope,
    resource: params.resource,
    expiresAt: Date.now() + config.refreshTokenTtl * 1000,
  })

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtl,
    refreshToken,
    scope: params.scope,
  }
}

/**
 * Consume a refresh token (rotation: old token is deleted, new one is issued).
 * Returns null if the token is invalid/expired.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  config: OAuthConfig,
): Promise<AccessTokenResult | null> {
  const entry = refreshTokenStore.get(refreshToken)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    refreshTokenStore.delete(refreshToken)
    return null
  }
  // Delete old token (rotation)
  refreshTokenStore.delete(refreshToken)

  return issueTokens(
    {
      userId: entry.userId,
      clientId: entry.clientId,
      scope: entry.scope,
      resource: entry.resource,
    },
    config,
  )
}

/** Reset stores (for testing only) */
export function _resetTokenStoresForTests(): void {
  refreshTokenStore.clear()
}

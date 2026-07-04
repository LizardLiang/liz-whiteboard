// src/lib/oauth/tokens.ts
// JWT access token and refresh token issuance
//
// ACCESS TOKEN:  RS256-signed JWT
//   iss = AS issuer URL
//   aud = MCP resource URI (RFC 8707 audience binding)
//   sub = User.id (liz-whiteboard user ID)
//   scope = granted scopes
//   exp = now + accessTokenTtl (default 1 hr)
//   iat, nbf = now
//   kid (in JWK header) = signing key ID
//
// REFRESH TOKEN: opaque random string persisted in OauthRefreshToken (SQLite).
//   Rotation uses a "mark rotated" approach rather than deletion:
//     rotated=0  → live token
//     rotated=1  → already rotated (stale)
//   Replaying a stale token signals theft → entire grant family is revoked.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { getSigningKeyPair } from './keys'
import type { OAuthConfig } from './config'
import { db, nowMs, transaction } from '@/db'

export interface AccessTokenResult {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  refreshToken: string
  scope: string
}

// Internal row type for OauthRefreshToken SELECT results.
interface RefreshTokenRow {
  tokenHash: string
  familyId: string
  userId: string
  clientId: string
  scope: string
  resource: string
  rotated: number
  expiresAt: number
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issue an RS256 access token + refresh token for the given user/grant.
 * Persists the refresh token to OauthRefreshToken.
 *
 * @param familyId - If provided, the new token shares the same grant family
 *   (used by rotateRefreshToken to continue lineage). Omit for fresh grants.
 */
export async function issueTokens(
  params: {
    userId: string
    clientId: string
    scope: string
    resource: string
  },
  config: OAuthConfig,
  familyId?: string,
): Promise<AccessTokenResult> {
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

  // Issue refresh token — opaque, stored by hash.
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(rawToken)
  const effectiveFamilyId = familyId ?? randomUUID()
  const expiresAt = nowMs() + config.refreshTokenTtl * 1000
  const createdAt = nowMs()

  db.prepare(
    `
    INSERT INTO "OauthRefreshToken"
      (tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `,
  ).run(
    tokenHash,
    effectiveFamilyId,
    params.userId,
    params.clientId,
    params.scope,
    params.resource,
    expiresAt,
    createdAt,
  )

  // Opportunistic sweep of expired rows (runs at write time, no background timer).
  db.prepare(`DELETE FROM "OauthRefreshToken" WHERE expiresAt < ?`).run(nowMs())

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtl,
    refreshToken: rawToken,
    scope: params.scope,
  }
}

/**
 * Consume a refresh token (rotation):
 *   - Marks the old token as rotated (rotated=1) — NOT deleted.
 *   - Issues new access + refresh token with the same familyId.
 *   - If a stale (already-rotated) token is presented → REUSE DETECTED →
 *     entire grant family is revoked and null is returned.
 *
 * @param refreshToken  Raw opaque token string (as returned to the client).
 * @param clientId      client_id from the token request (RFC 6749 §10.4 binding).
 * @param config        OAuth config.
 * @returns New AccessTokenResult, or null if the token is invalid/expired/stolen.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
  config: OAuthConfig,
): Promise<AccessTokenResult | null> {
  const tokenHash = hashToken(refreshToken)

  const row = db
    .prepare(
      `
    SELECT tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt
    FROM "OauthRefreshToken"
    WHERE tokenHash = ?
  `,
    )
    .get(tokenHash) as RefreshTokenRow | undefined

  if (!row) {
    // Token unknown — truly invalid (never issued or already swept after expiry).
    return null
  }

  if (row.rotated === 1) {
    // REUSE DETECTED: stale token was replayed → compromise signal.
    // Revoke the entire grant family so neither the attacker nor the legitimate
    // client can use any token in this lineage.
    console.warn(
      `[oauth] REUSE DETECTED family=${row.familyId} userId=${row.userId} clientId=${clientId}`,
    )
    db.prepare(`DELETE FROM "OauthRefreshToken" WHERE familyId = ?`).run(
      row.familyId,
    )
    return null
  }

  if (row.expiresAt < nowMs()) {
    // Expired active token — clean it up.
    db.prepare(`DELETE FROM "OauthRefreshToken" WHERE tokenHash = ?`).run(
      tokenHash,
    )
    return null
  }

  if (row.clientId !== clientId) {
    // client_id mismatch — prevents cross-client token theft (RFC 6749 §10.4).
    return null
  }

  // Pre-generate the new refresh token (all values needed for DB insert).
  const newRawToken = randomBytes(32).toString('base64url')
  const newHash = hashToken(newRawToken)
  const newExpiresAt = nowMs() + config.refreshTokenTtl * 1000
  const newCreatedAt = nowMs()

  // Atomically mark old token as rotated AND insert new token.
  // JWT signing happens after the transaction (it's async; the DB ops are sync).
  transaction(() => {
    db.prepare(
      `UPDATE "OauthRefreshToken" SET rotated = 1 WHERE tokenHash = ?`,
    ).run(tokenHash)
    db.prepare(
      `
      INSERT INTO "OauthRefreshToken"
        (tokenHash, familyId, userId, clientId, scope, resource, rotated, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    ).run(
      newHash,
      row.familyId,
      row.userId,
      row.clientId,
      row.scope,
      row.resource,
      newExpiresAt,
      newCreatedAt,
    )
    // Sweep expired rows opportunistically.
    db.prepare(`DELETE FROM "OauthRefreshToken" WHERE expiresAt < ?`).run(
      nowMs(),
    )
  })

  // Sign the new JWT (async — outside the synchronous DB transaction).
  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + config.accessTokenTtl

  const accessToken = await new SignJWT({
    sub: row.userId,
    scope: row.scope,
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(config.issuer)
    .setAudience(row.resource)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtl,
    refreshToken: newRawToken,
    scope: row.scope,
  }
}

/**
 * Revoke all tokens in a refresh token's family (RFC 7009).
 * No-op if the token is unknown. Validates client_id binding.
 * Returns true if a family was found and revoked; false otherwise.
 * Callers MUST return HTTP 200 regardless (RFC 7009 §2.2 — no oracle).
 */
export function revokeRefreshToken(token: string, clientId: string): boolean {
  const tokenHash = hashToken(token)
  const row = db
    .prepare(
      `
    SELECT familyId, clientId FROM "OauthRefreshToken" WHERE tokenHash = ?
  `,
    )
    .get(tokenHash) as
    | Pick<RefreshTokenRow, 'familyId' | 'clientId'>
    | undefined

  if (!row) return false
  if (row.clientId !== clientId) return false

  db.prepare(`DELETE FROM "OauthRefreshToken" WHERE familyId = ?`).run(
    row.familyId,
  )
  return true
}

/** Reset refresh token store (for testing only). */
export function _resetTokenStoresForTests(): void {
  db.prepare(`DELETE FROM "OauthRefreshToken"`).run()
}

// src/lib/oauth/grants.ts
// Persisted per-user consent grant store (mcp-oauth-dcr-consent) — the
// "remember until explicitly revoked" half of the untrusted-client consent
// flow. Persisted in SQLite (OauthGrant table, additive
// CREATE TABLE IF NOT EXISTS in src/data/schema-sql.ts, next to OauthClient).
//
// A row here means the user approved a given (untrusted, DCR-registered)
// client for `scope` on the consent screen (src/routes/oauth/consent.tsx).
// /authorize (src/routes/authorize.ts) consults getGrant()/scopeCovers()
// before showing consent again: same-or-narrower scope skips the prompt,
// scope escalation re-prompts (a fresh upsertGrant() call replaces the row).
//
// revokeGrant() MUST also delete the matching OauthRefreshToken rows (that
// table already carries both userId and clientId — src/lib/oauth/tokens.ts)
// so a revoked client's access stops at the next refresh instead of
// surviving it for the remainder of the refresh token's 7-day TTL. Access
// tokens themselves (1h TTL, in-memory JWTs) are not individually revocable
// — this is a documented, accepted tradeoff (tactical plan Assumptions).
//
// Trusted/first-party and CIMD clients never get a row here — they hit the
// unconditional auto-approve branch in authorize.ts and never reach the
// consent/grant path.

import { db, nowMs, transaction } from '@/db'

export interface OauthGrant {
  userId: string
  clientId: string
  /** Space-delimited scope string, same shape as AuthCode.scope. */
  scope: string
  grantedAt: number
}

interface OauthGrantRow {
  userId: string
  clientId: string
  scope: string
  grantedAt: number
}

function mapRow(row: OauthGrantRow): OauthGrant {
  return {
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    grantedAt: row.grantedAt,
  }
}

/** Look up a user's existing grant for a client. Returns null if none exists. */
export function getGrant(userId: string, clientId: string): OauthGrant | null {
  const row = db
    .prepare(
      `SELECT * FROM "OauthGrant" WHERE userId = ? AND clientId = ?`,
    )
    .get(userId, clientId) as OauthGrantRow | undefined
  if (!row) return null
  return mapRow(row)
}

/**
 * Create or replace a user's grant for a client with the given scope.
 * Called on consent approval — replaces (rather than unions with) any prior
 * scope, so a fresh approval always reflects exactly what was just shown on
 * the consent screen and approved.
 */
export function upsertGrant(
  userId: string,
  clientId: string,
  scope: string,
): OauthGrant {
  const grantedAt = nowMs()
  db.prepare(
    `
    INSERT INTO "OauthGrant" (userId, clientId, scope, grantedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(userId, clientId) DO UPDATE SET
      scope = excluded.scope,
      grantedAt = excluded.grantedAt
  `,
  ).run(userId, clientId, scope, grantedAt)
  return { userId, clientId, scope, grantedAt }
}

/** List all grants for a user (for the /settings/connections page). */
export function listGrants(userId: string): Array<OauthGrant> {
  const rows = db
    .prepare(
      `SELECT * FROM "OauthGrant" WHERE userId = ? ORDER BY grantedAt DESC`,
    )
    .all(userId) as unknown as Array<OauthGrantRow>
  return rows.map(mapRow)
}

/**
 * Revoke a user's grant for a client. Also deletes any OauthRefreshToken
 * rows for that user+client (that table carries both columns — see
 * src/lib/oauth/tokens.ts) so a revoked client stops working at the next
 * refresh rather than surviving on its existing refresh token. Idempotent —
 * revoking a non-existent grant is a no-op success.
 */
export function revokeGrant(userId: string, clientId: string): void {
  transaction(() => {
    db.prepare(
      `DELETE FROM "OauthRefreshToken" WHERE userId = ? AND clientId = ?`,
    ).run(userId, clientId)
    db.prepare(
      `DELETE FROM "OauthGrant" WHERE userId = ? AND clientId = ?`,
    ).run(userId, clientId)
  })
}

/**
 * Whether an existing grant's scope covers every scope in `requested`.
 * Used by /authorize to decide whether a previously-approved client can skip
 * the consent prompt: same-or-narrower scope skips it, escalation
 * (requesting a scope not already granted) does not.
 */
export function scopeCovers(
  grantedScope: string,
  requested: Array<string>,
): boolean {
  const grantedSet = new Set(grantedScope.split(' ').filter(Boolean))
  return requested.every((s) => grantedSet.has(s))
}

/** Reset the grant store. For tests only. */
export function _resetGrantStoreForTests(): void {
  db.prepare(`DELETE FROM "OauthGrant"`).run()
}

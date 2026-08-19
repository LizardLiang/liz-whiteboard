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
// Trusted/first-party clients never get a row here — they hit the
// unconditional auto-approve branch in authorize.ts and never reach the
// consent/grant path. UNTRUSTED CIMD clients DO get rows since
// mcp-oauth-open-cimd (2026-08-19).
//
// GRANT KEY (mcp-oauth-open-cimd): a CIMD client is identified by its
// document ORIGIN, not the full document URL. Codex publishes its metadata at
// https://chatgpt.com/oauth/codex/{callback_id}/client.json — the path
// changes every login, so per-URL keying would re-prompt for consent on every
// single login and add a fresh row to /settings/connections each time.
// Whoever controls an origin controls every document served from it, so the
// origin already IS the trust boundary; per-path keying buys no isolation.
// Static and DCR client ids are not URLs and are keyed unchanged.
//
// The authorization CODE stays bound to the full client_id (token.ts requires
// an exact match) — only this grant store is origin-scoped.

import { isCimdUrl } from './cimd-origins'
import { db, nowMs, transaction } from '@/db'

export interface OauthGrant {
  userId: string
  /** Grant key — a CIMD origin, or a static/DCR client id verbatim. */
  clientId: string
  /** Space-delimited scope string, same shape as AuthCode.scope. */
  scope: string
  grantedAt: number
  /**
   * Display name captured at consent time. Lets /settings/connections render
   * without resolving anything over the network — see
   * src/lib/oauth/connections-handlers.ts. Null for rows written before this
   * column existed.
   */
  clientName: string | null
}

interface OauthGrantRow {
  userId: string
  clientId: string
  scope: string
  grantedAt: number
  clientName: string | null
}

function mapRow(row: OauthGrantRow): OauthGrant {
  return {
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    grantedAt: row.grantedAt,
    clientName: row.clientName ?? null,
  }
}

/**
 * Collapse a client id to the key this store uses: the ORIGIN for an absolute
 * https client_id (CIMD), the value verbatim otherwise (static allowlist ids
 * and DCR-issued ids are opaque strings, not URLs).
 */
export function grantKeyFor(clientId: string): string {
  // isCimdUrl(), not an inline https check — it is the single definition of
  // "this client_id is a CIMD document URL", shared with resolve-client.ts and
  // authorize.ts. Anything else (static allowlist ids, DCR-issued ids) is an
  // opaque string and is keyed verbatim.
  if (!isCimdUrl(clientId)) return clientId
  return new URL(clientId).origin
}

/** Escape LIKE metacharacters so an origin is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Look up a user's existing grant for a client. Returns null if none exists. */
export function getGrant(userId: string, clientId: string): OauthGrant | null {
  const row = db
    .prepare(`SELECT * FROM "OauthGrant" WHERE userId = ? AND clientId = ?`)
    .get(userId, grantKeyFor(clientId)) as OauthGrantRow | undefined
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
  clientName: string | null = null,
): OauthGrant {
  const grantedAt = nowMs()
  const key = grantKeyFor(clientId)
  db.prepare(
    `
    INSERT INTO "OauthGrant" (userId, clientId, scope, grantedAt, clientName)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(userId, clientId) DO UPDATE SET
      scope = excluded.scope,
      grantedAt = excluded.grantedAt,
      clientName = excluded.clientName
  `,
  ).run(userId, key, scope, grantedAt, clientName)
  return { userId, clientId: key, scope, grantedAt, clientName }
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
 *
 * ORIGIN SCOPE (mcp-oauth-open-cimd): grants are keyed by CIMD origin, but
 * refresh tokens are stored against the FULL client_id the token was issued
 * to (src/routes/token.ts). An exact-key delete would therefore leave every
 * refresh token alive after revoking a CIMD grant — the client would keep
 * minting access tokens until its 7-day refresh TTL ran out. So the delete
 * matches the key exactly OR any client_id under `<origin>/`. The trailing
 * slash matters: it stops `https://chatgpt.com` from also matching
 * `https://chatgpt.com.evil.example/...`.
 */
export function revokeGrant(userId: string, clientId: string): void {
  const key = grantKeyFor(clientId)
  const originPrefix = `${escapeLike(key)}/%`
  transaction(() => {
    db.prepare(
      `DELETE FROM "OauthRefreshToken"
        WHERE userId = ?
          AND (clientId = ? OR clientId LIKE ? ESCAPE '\\')`,
    ).run(userId, key, originPrefix)
    db.prepare(
      `DELETE FROM "OauthGrant" WHERE userId = ? AND clientId = ?`,
    ).run(userId, key)
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

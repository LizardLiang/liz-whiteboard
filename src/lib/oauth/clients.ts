// src/lib/oauth/clients.ts
// Dynamic Client Registration (RFC 7591) store — the hardened, currently-
// dormant DCR fallback for non-CIMD MCP clients (see the OAUTH_ALLOW_DCR
// kill switch in src/routes/oauth/register.ts). Persisted in SQLite
// (OauthClient table, additive CREATE TABLE IF NOT EXISTS in
// src/data/schema-sql.ts).
//
// TRUST MODEL (security review BLOCKER fix, 2026-07-18): DCR rows are ALWAYS
// persisted with `trusted: false`. Earlier this store marked every
// DCR-registered client `trusted: true` (auto-approve + full scope, same as
// CIMD/first-party) on the theory that the /authorize login step was the
// real gate — but /authorize has no consent UI, so any attacker who
// registered a client via the open /register endpoint could get an
// authorization code silently issued and redirected to an attacker
// redirect_uri for any logged-in user (confused-deputy account takeover).
// /authorize now refuses any client where `firstParty || trusted` is false
// (src/routes/authorize.ts) rather than auto-approving it — so an untrusted
// DCR row can reach /authorize but never receives a code. Only the static
// first-party allowlist and origin-verified CIMD clients are trusted.
// Orphan rows (registered but never actually used to complete an /authorize
// flow) are garbage-collected by sweepOrphanClients(), which also sweeps
// long-stale authorized rows (W6 fix) to bound table growth.

import { randomBytes } from 'node:crypto'
import type { OAuthClient } from './config'
import { db, nowMs } from '@/db'

/** Registered-but-never-authorized rows older than this are swept. */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Authorized DCR rows whose last /authorize completion is older than this
 * are swept too (W6 fix) — the original GC only ever deleted rows that were
 * NEVER authorized, so a client used once and then abandoned would live
 * forever. Lower priority now that DCR defaults to disabled, but kept as
 * defense in depth for whenever it's re-enabled.
 */
const AUTHORIZED_STALE_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

export interface RegisterClientInput {
  redirectUris: Array<string>
  clientName?: string
  grantTypes?: Array<string>
  responseTypes?: Array<string>
  scope?: string
  softwareId?: string
}

export interface RegisteredClient extends OAuthClient {
  clientIdIssuedAt: number
  grantTypes: Array<string>
  responseTypes: Array<string>
  scope?: string
  tokenEndpointAuthMethod: string
  softwareId?: string
}

interface OauthClientRow {
  clientId: string
  redirectUris: string
  clientName: string | null
  grantTypes: string
  responseTypes: string
  scope: string | null
  tokenEndpointAuthMethod: string
  softwareId: string | null
  trusted: number
  lastAuthorizedAt: number | null
  createdAt: number
}

function mapRow(row: OauthClientRow): RegisteredClient {
  return {
    clientId: row.clientId,
    redirectUris: JSON.parse(row.redirectUris) as Array<string>,
    name: row.clientName ?? row.clientId,
    firstParty: false,
    trusted: row.trusted === 1,
    clientIdIssuedAt: row.createdAt,
    grantTypes: JSON.parse(row.grantTypes) as Array<string>,
    responseTypes: JSON.parse(row.responseTypes) as Array<string>,
    scope: row.scope ?? undefined,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    softwareId: row.softwareId ?? undefined,
  }
}

/**
 * Register a new public (no client_secret), PKCE-only DCR client.
 * `redirectUris` must already be validated by the caller (see
 * src/routes/oauth/register.ts, which uses redirectUriAllowed()'s
 * non-loopback-http rejection before calling this).
 */
export function registerClient(input: RegisterClientInput): RegisteredClient {
  sweepOrphanClients()

  const clientId = randomBytes(16).toString('hex')
  const createdAt = nowMs()
  const grantTypes = input.grantTypes ?? [
    'authorization_code',
    'refresh_token',
  ]
  const responseTypes = input.responseTypes ?? ['code']

  db.prepare(
    `
    INSERT INTO "OauthClient"
      (clientId, redirectUris, clientName, grantTypes, responseTypes, scope, tokenEndpointAuthMethod, softwareId, trusted, lastAuthorizedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 'none', ?, 0, NULL, ?)
  `,
  ).run(
    clientId,
    JSON.stringify(input.redirectUris),
    input.clientName ?? null,
    JSON.stringify(grantTypes),
    JSON.stringify(responseTypes),
    input.scope ?? null,
    input.softwareId ?? null,
    createdAt,
  )

  return {
    clientId,
    redirectUris: input.redirectUris,
    name: input.clientName ?? clientId,
    firstParty: false,
    trusted: false,
    clientIdIssuedAt: createdAt,
    grantTypes,
    responseTypes,
    scope: input.scope,
    tokenEndpointAuthMethod: 'none',
    softwareId: input.softwareId,
  }
}

/** Look up a DCR-registered client by clientId. Returns null if not found. */
export function getClient(clientId: string): OAuthClient | null {
  const row = db
    .prepare(`SELECT * FROM "OauthClient" WHERE clientId = ?`)
    .get(clientId) as OauthClientRow | undefined
  if (!row) return null
  return mapRow(row)
}

/**
 * Mark a DCR client as having completed at least one /authorize flow.
 * No-op (0 rows affected) if clientId doesn't match any OauthClient row —
 * safe to call unconditionally from /authorize for every clientId, including
 * CIMD/static clients that never have a row.
 */
export function markAuthorized(clientId: string): void {
  db.prepare(
    `UPDATE "OauthClient" SET lastAuthorizedAt = ? WHERE clientId = ?`,
  ).run(nowMs(), clientId)
}

/**
 * Delete stale DCR client rows, in two categories (W6 fix):
 *   1. Never-authorized ("orphan") rows older than ORPHAN_TTL_MS.
 *   2. Authorized rows whose last /authorize completion is older than
 *      AUTHORIZED_STALE_TTL_MS — the original version of this function only
 *      swept category 1, so a client that was used once and then abandoned
 *      would occupy a row forever, letting the table grow unbounded.
 * Lazy-invoked on every register() call (mirrors the opportunistic sweep
 * pattern in tokens.ts).
 */
export function sweepOrphanClients(): void {
  const now = nowMs()
  db.prepare(
    `DELETE FROM "OauthClient" WHERE lastAuthorizedAt IS NULL AND createdAt < ?`,
  ).run(now - ORPHAN_TTL_MS)
  db.prepare(
    `DELETE FROM "OauthClient" WHERE lastAuthorizedAt IS NOT NULL AND lastAuthorizedAt < ?`,
  ).run(now - AUTHORIZED_STALE_TTL_MS)
}

/** Reset the DCR client store. For tests only. */
export function _resetClientStoreForTests(): void {
  db.prepare(`DELETE FROM "OauthClient"`).run()
}

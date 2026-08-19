// src/lib/oauth/connections-handlers.ts
// Connected-apps server-fn HANDLER LOGIC for /settings/connections —
// deliberately kept out of src/routes/api/oauth-connections.ts. Same split
// rationale as src/lib/oauth/consent-handlers.ts / src/lib/invite/handlers.ts.

import type { AuthContext } from '@/lib/auth/middleware'
import type { RevokeGrant } from '@/data/schema'

export interface ConnectedApp {
  clientId: string
  clientName: string
  scopes: Array<string>
  grantedAt: number
}

/**
 * List the current user's approved (unverified) OAuth clients — DCR-registered
 * ones and CIMD clients from origins outside CIMD_TRUSTED_ORIGINS.
 *
 * NO NETWORK (mcp-oauth-open-cimd, 2026-08-19): this used to call
 * resolveClient() per grant to get a display name. Two reasons that had to go.
 * First, grants are now keyed by CIMD ORIGIN (grants.ts grantKeyFor), and an
 * origin is itself an absolute https URL — so resolveClient() would try to
 * fetch a CIMD document from it, fail, and fall back to the raw string
 * anyway. Second, with open resolution those origins are caller-supplied, so
 * rendering this page would fire one outbound request per grant at whatever
 * hosts an attacker had talked the user into approving. The name is captured
 * at consent time instead (OauthGrant.clientName).
 */
export async function listConnectedAppsHandler(
  { user }: AuthContext,
  _data: undefined,
): Promise<{ apps: Array<ConnectedApp> }> {
  const { listGrants } = await import('./grants')

  const apps = listGrants(user.id).map((grant) => ({
    clientId: grant.clientId,
    // Pre-mcp-oauth-open-cimd rows have no captured name; the grant key is
    // the honest fallback and revoke still works from it.
    clientName: grant.clientName ?? grant.clientId,
    scopes: grant.scope.split(' ').filter(Boolean),
    grantedAt: grant.grantedAt,
  }))

  return { apps }
}

/**
 * Revoke a connected app: deletes the grant AND the matching
 * OauthRefreshToken rows (src/lib/oauth/grants.ts's revokeGrant), so access
 * stops at the next refresh. Idempotent.
 */
export async function revokeConnectedAppHandler(
  { user }: AuthContext,
  data: RevokeGrant,
): Promise<{ success: true }> {
  const { revokeGrant } = await import('./grants')
  revokeGrant(user.id, data.clientId)
  console.log(
    `[oauth/connections] Revoked client=${data.clientId} user=${user.id}`,
  )
  return { success: true }
}

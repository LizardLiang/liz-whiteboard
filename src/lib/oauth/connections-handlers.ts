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
 * List the current user's approved (untrusted, DCR-registered) OAuth
 * clients. Resolves each grant's clientId to its current display name via
 * resolveClient() (falls back to the raw clientId if the client row was
 * since swept/removed — a revoke button should still work even then).
 */
export async function listConnectedAppsHandler(
  { user }: AuthContext,
  _data: undefined,
): Promise<{ apps: Array<ConnectedApp> }> {
  const { listGrants } = await import('./grants')
  const { resolveClient } = await import('./resolve-client')

  const grants = listGrants(user.id)
  const apps = await Promise.all(
    grants.map(async (grant) => {
      const client = await resolveClient(grant.clientId)
      return {
        clientId: grant.clientId,
        clientName: client?.name ?? grant.clientId,
        scopes: grant.scope.split(' ').filter(Boolean),
        grantedAt: grant.grantedAt,
      }
    }),
  )

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

// src/routes/api/oauth-connections.ts
// Connected-apps server functions for src/routes/settings/connections.tsx.
// Same THIN createServerFn + requireAuth shape as src/routes/api/invites.ts —
// handler bodies live in src/lib/oauth/connections-handlers.ts.

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  listConnectedAppsHandler,
  revokeConnectedAppHandler,
} from '@/lib/oauth/connections-handlers'
import { revokeGrantSchema } from '@/data/schema'

/**
 * @requires authenticated
 */
export const listConnectedApps = createServerFn({ method: 'GET' }).handler(
  requireAuth(listConnectedAppsHandler),
)

/**
 * @requires authenticated
 */
export const revokeConnectedApp = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => revokeGrantSchema.parse(data))
  .handler(requireAuth(revokeConnectedAppHandler))

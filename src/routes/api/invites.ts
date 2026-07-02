// src/routes/api/invites.ts
// Invite-by-URL server functions: create/list/revoke (ADMIN+ gated) and
// redeem/preview (bearer-token gated). Follows src/routes/api/permissions.ts's
// exact shape (createServerFn + requireAuth + resolved-value
// { error, status, message } denial shape, not thrown errors).
//
// This file is deliberately THIN — it only wires up createServerFn +
// requireAuth around handler functions imported from src/lib/invite/
// handlers.ts. That module (and its `@/db`/data-layer imports) must never
// live in this file directly: src/routes/invite.$token.tsx and
// src/components/project/ProjectSharePanel.tsx (client components) import
// the createServerFn-wrapped consts below, and TanStack Start's
// client-bundle transform only strips the INLINE closure passed to
// `.handler(...)` — it cannot strip a plain top-level function this file
// merely references. Keeping the handler bodies (and their node:crypto/
// node:fs-touching imports) in a separate, never-client-imported module is
// what lets Rollup tree-shake them out of the browser bundle. (This split
// was made after a real `bun run build` failure — see git history — do not
// move the handler logic back into this file.)

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  createProjectInviteHandler,
  getInvitePreviewHandler,
  listProjectInvitesHandler,
  redeemInviteHandler,
  revokeInviteHandler,
} from '@/lib/invite/handlers'
import {
  createInviteSchema,
  redeemInviteSchema,
  revokeInviteSchema,
} from '@/data/schema'

/**
 * @requires admin
 */
export const createProjectInvite = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createInviteSchema.parse(data))
  .handler(requireAuth(createProjectInviteHandler))

/**
 * @requires admin
 */
export const listProjectInvites = createServerFn({ method: 'GET' })
  .inputValidator((projectId: unknown) => {
    if (typeof projectId !== 'string') throw new Error('Invalid projectId')
    return projectId
  })
  .handler(requireAuth(listProjectInvitesHandler))

/**
 * @requires admin
 */
export const revokeInvite = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => revokeInviteSchema.parse(data))
  .handler(requireAuth(revokeInviteHandler))

/**
 * @requires authenticated
 */
export const redeemInvite = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => redeemInviteSchema.parse(data))
  .handler(requireAuth(redeemInviteHandler))

/**
 * @requires unauthenticated
 */
export const getInvitePreview = createServerFn({ method: 'GET' })
  .inputValidator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => getInvitePreviewHandler(token))

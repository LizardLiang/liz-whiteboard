// src/routes/api/share.ts
// Whiteboard read-only share-link server functions: create/revoke/list
// (ADMIN+ gated, per-project) and the public diagram read (unauthenticated).
// Follows src/routes/api/invites.ts's exact shape (createServerFn +
// requireAuth + resolved-value { error, status, message } denial shape, not
// thrown errors).
//
// This file is deliberately THIN — it only wires up createServerFn +
// requireAuth around handler functions imported from src/lib/share/
// handlers.ts. That module (and its `@/db`/data-layer imports) must never
// live in this file directly: src/routes/share.$token.tsx and
// src/components/project/ProjectSharePanel.tsx (client components) import
// the createServerFn-wrapped consts below, and TanStack Start's
// client-bundle transform only strips the INLINE closure passed to
// `.handler(...)` — it cannot strip a plain top-level function this file
// merely references. Keeping the handler bodies (and their
// node:crypto-touching imports) in a separate, never-client-imported module
// is what lets Rollup tree-shake them out of the browser bundle. (Mirrors
// src/routes/api/invites.ts's identical split — see that file's header
// comment for the real `bun run build` failure this pattern avoids.)

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  createShareLinkHandler,
  getSharedWhiteboardHandler,
  listShareLinksHandler,
  revokeShareLinkHandler,
} from '@/lib/share/handlers'
import { createShareLinkSchema, revokeShareLinkSchema } from '@/data/schema'

/**
 * @requires admin
 */
export const createShareLink = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createShareLinkSchema.parse(data))
  .handler(requireAuth(createShareLinkHandler))

/**
 * @requires admin
 */
export const revokeShareLink = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => revokeShareLinkSchema.parse(data))
  .handler(requireAuth(revokeShareLinkHandler))

/**
 * List every read-only share link across a project's whiteboards.
 * @requires admin
 */
export const listShareLinks = createServerFn({ method: 'GET' })
  .inputValidator((projectId: unknown) => {
    if (typeof projectId !== 'string') {
      throw new Error('Invalid projectId')
    }
    return projectId
  })
  .handler(requireAuth(listShareLinksHandler))

/**
 * @requires unauthenticated
 */
export const getSharedWhiteboard = createServerFn({ method: 'GET' })
  .inputValidator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => getSharedWhiteboardHandler(token))

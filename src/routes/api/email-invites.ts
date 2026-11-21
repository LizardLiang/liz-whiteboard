// src/routes/api/email-invites.ts
// Grant-by-email server functions: list/revoke pending invites (ADMIN+ gated)
// and preview/accept (session gated). THIN on purpose — the handlers live in
// src/lib/invite/email-invite-handlers.ts, which no client file imports, for
// the same bundling reason as src/routes/api/invites.ts (see its header).

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  acceptEmailInviteHandler,
  listEmailInvitesHandler,
  previewEmailInviteHandler,
  revokeEmailInviteHandler,
} from '@/lib/invite/email-invite-handlers'
import { acceptEmailInviteSchema, revokeInviteSchema } from '@/data/schema'

/**
 * @requires admin
 */
export const listPendingEmailInvites = createServerFn({ method: 'GET' })
  .validator((projectId: unknown) => {
    if (typeof projectId !== 'string') throw new Error('Invalid projectId')
    return projectId
  })
  .handler(requireAuth(listEmailInvitesHandler))

/**
 * @requires admin
 */
export const revokeEmailInvite = createServerFn({ method: 'POST' })
  .validator((data: unknown) => revokeInviteSchema.parse(data))
  .handler(requireAuth(revokeEmailInviteHandler))

/**
 * @requires authenticated
 */
export const previewEmailInvite = createServerFn({ method: 'POST' })
  .validator((data: unknown) => acceptEmailInviteSchema.parse(data))
  .handler(
    requireAuth(({ user, session }, data) =>
      previewEmailInviteHandler({ user, session }, data.token),
    ),
  )

/**
 * @requires authenticated
 */
export const acceptEmailInvite = createServerFn({ method: 'POST' })
  .validator((data: unknown) => acceptEmailInviteSchema.parse(data))
  .handler(requireAuth(acceptEmailInviteHandler))

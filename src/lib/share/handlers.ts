// src/lib/share/handlers.ts
// Whiteboard read-only share-link server-fn HANDLER LOGIC — deliberately
// kept out of src/routes/api/share.ts.
//
// src/routes/share.$token.tsx and src/components/project/ProjectSharePanel.tsx
// (client components) import the createServerFn-wrapped consts from
// src/routes/api/share.ts (createShareLink, revokeShareLink, etc.).
// TanStack Start's client-bundle transform strips the INLINE closure passed
// to `.handler(...)`, but it cannot strip a plain top-level function that's
// merely REFERENCED there — if these handler functions (and their
// data-layer/`@/db` imports) lived in share.ts itself, Rollup would still
// need to resolve those imports when bundling share.ts for the client (since
// the client imports OTHER exports from that same file), pulling
// node:crypto into the browser bundle and breaking `vite build` — exactly
// the failure mode documented in src/routes/api/invites.ts's header comment,
// which this module mirrors. Because this module has NO export that any
// client-importable file ever references, Rollup can tree-shake it out of
// the client bundle entirely.
//
// Each handler is a plain, directly-testable function — src/routes/api/
// share.ts's createServerFn wrappers just delegate to them
// (`.handler(requireAuth(createShareLinkHandler))`), and
// src/routes/api/share.test.ts calls them directly against the real test DB
// (no mirror-copy of this logic).

import type { AuthContext } from '@/lib/auth/middleware'
import type { WhiteboardShareLink } from '@/data/models'
import type { CreateShareLink, RevokeShareLink } from '@/data/schema'
import type { ShareDenialReason } from '@/lib/share/denial-reasons'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { findEffectiveRole } from '@/data/permission'
import { getWhiteboardProjectId } from '@/data/resolve-project'
import { findWhiteboardByIdWithDiagram } from '@/data/whiteboard'
import { findRelationshipsByWhiteboardIdWithDetails } from '@/data/relationship'
import {
  createWhiteboardShareLink,
  findShareLinkById,
  findShareLinkByTokenHash,
  findShareLinksByProjectId,
  revokeWhiteboardShareLinkById,
} from '@/data/whiteboard-share-link'
import { generateInviteToken, hashInviteToken } from '@/lib/auth/invite-token'

/**
 * Classify a mapped share-link row against the current time — shared by
 * `getSharedWhiteboardHandler`. Returns null if the link is currently valid
 * (not revoked, not expired).
 */
function classifyShareDenial(
  link: WhiteboardShareLink,
): ShareDenialReason | null {
  if (link.revokedAt !== null) return 'REVOKED'
  if (link.expiresAt !== null && link.expiresAt.getTime() < Date.now()) {
    return 'EXPIRED'
  }
  return null
}

/**
 * Shared ADMIN+ effective-role gate, scoped directly to a project id — mirrors
 * src/lib/invite/handlers.ts's helper of the same name and signature exactly
 * (hardcoded to ADMIN since this feature has no lower-privilege variant).
 * Named `requireMinimumRole` (not e.g. `requireAdminOnProject`) because the
 * SEC-RBAC-04 ESLint rule (tools/eslint-rules/require-server-fn-authz.cjs)
 * hardcodes that identifier as a trusted RBAC-gate call (the same way
 * `requireServerFnRole` is trusted), so every createServerFn handler that
 * calls a function named `requireMinimumRole` satisfies the rule regardless
 * of which module defines it. Duplicated here (rather than imported/
 * exported) because that helper is private to its module — matching this
 * codebase's existing per-feature duplication style.
 *
 * Whiteboard-scoped callers (create/revoke) resolve the project id via
 * `getWhiteboardProjectId` first — see its call sites below — so a
 * nonexistent whiteboard is indistinguishable from unauthorized (SEC-ERR-03).
 */
async function requireMinimumRole(
  userId: string,
  projectId: string,
  message: string,
): Promise<{ error: 'FORBIDDEN'; status: 403; message: string } | null> {
  const role = await findEffectiveRole(userId, projectId)
  if (!hasMinimumRole(role, 'ADMIN')) {
    return { error: 'FORBIDDEN' as const, status: 403, message }
  }
  return null
}

/**
 * Create a whiteboard read-only share link.
 * Requires ADMIN or OWNER effective role on the whiteboard's project.
 * A2: multiple independently-revocable links per whiteboard are allowed —
 * creating a new link never touches any existing link.
 * A3: `expiresInHours` is required — `expiresAt` is always populated.
 * The raw token is returned ONLY in this response — it is never persisted
 * (only its SHA-256 hash is stored) and never logged.
 */
export async function createShareLinkHandler(
  { user }: AuthContext,
  data: CreateShareLink,
) {
  const projectId = await getWhiteboardProjectId(data.whiteboardId)
  if (!projectId) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can create share links',
    }
  }
  const denial = await requireMinimumRole(
    user.id,
    projectId,
    'Only ADMIN or OWNER can create share links',
  )
  if (denial) return denial

  const rawToken = generateInviteToken()
  const tokenHash = hashInviteToken(rawToken)

  const link = await createWhiteboardShareLink({
    whiteboardId: data.whiteboardId,
    tokenHash,
    createdByUserId: user.id,
    expiresInHours: data.expiresInHours,
  })

  return {
    success: true as const,
    link: {
      id: link.id,
      whiteboardId: link.whiteboardId,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    },
    token: rawToken,
  }
}

/**
 * Revoke a single whiteboard share link by id.
 * Requires ADMIN or OWNER effective role on the link's whiteboard's project.
 * Idempotent — revoking an unknown or already-revoked link is a no-op
 * success (there is no project context to gate on when the link doesn't
 * exist, and nothing is disclosed either way).
 */
export async function revokeShareLinkHandler(
  { user }: AuthContext,
  data: RevokeShareLink,
) {
  const link = await findShareLinkById(data.linkId)
  if (!link) {
    return { success: true as const }
  }

  const projectId = await getWhiteboardProjectId(link.whiteboardId)
  if (!projectId) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can revoke share links',
    }
  }
  const denial = await requireMinimumRole(
    user.id,
    projectId,
    'Only ADMIN or OWNER can revoke share links',
  )
  if (denial) return denial

  await revokeWhiteboardShareLinkById(data.linkId)
  return { success: true as const }
}

/**
 * List every read-only share link across every whiteboard in a project, most
 * recent first — used by ProjectSharePanel's "Outstanding read-only links"
 * section. Requires ADMIN or OWNER effective role on the project. Never
 * returns the token or its hash.
 */
export async function listShareLinksHandler(
  { user }: AuthContext,
  projectId: string,
) {
  const denial = await requireMinimumRole(
    user.id,
    projectId,
    'Only ADMIN or OWNER can view share links',
  )
  if (denial) return denial

  const links = await findShareLinksByProjectId(projectId)

  return {
    links: links.map((link) => ({
      id: link.id,
      whiteboardId: link.whiteboardId,
      whiteboardName: link.whiteboardName,
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt,
      createdAt: link.createdAt,
    })),
  }
}

/**
 * Public, unauthenticated read of a shared whiteboard's diagram — used by
 * the logged-out /share/$token route. Performs no writes.
 *
 * R3/IDOR: whiteboardId is resolved from the token row EXCLUSIVELY — this
 * handler never accepts a client-supplied whiteboardId, so a token for
 * whiteboard A can never be used to read whiteboard B.
 *
 * Never returns projectId, createdByUserId, tokenHash, or any sibling
 * whiteboard's data — only the fields needed to render the diagram
 * read-only (AC3 of the spec delta).
 */
export async function getSharedWhiteboardHandler(token: string) {
  const tokenHash = hashInviteToken(token)
  const link = await findShareLinkByTokenHash(tokenHash)

  if (!link) {
    return { valid: false as const, reason: 'INVALID' as const }
  }

  const denial = classifyShareDenial(link)
  if (denial) {
    return { valid: false as const, reason: denial }
  }

  const whiteboard = await findWhiteboardByIdWithDiagram(link.whiteboardId)
  if (!whiteboard) {
    return { valid: false as const, reason: 'INVALID' as const }
  }

  const relationships = await findRelationshipsByWhiteboardIdWithDetails(
    link.whiteboardId,
  )

  return {
    valid: true as const,
    whiteboardId: whiteboard.id,
    whiteboardName: whiteboard.name,
    canvasState: whiteboard.canvasState,
    tables: whiteboard.tables,
    relationships,
  }
}

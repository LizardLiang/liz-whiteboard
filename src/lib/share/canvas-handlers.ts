// src/lib/share/canvas-handlers.ts
// Canvas-board read-only share-link server-fn HANDLER LOGIC. The canvas
// counterpart of src/lib/share/handlers.ts, and kept out of
// src/routes/api/canvas-share.ts for exactly the reason documented in that
// module's header: TanStack Start's client-bundle transform strips the
// inline closure passed to `.handler(...)`, but it cannot strip a plain
// top-level function merely REFERENCED there. If these handlers lived in the
// api file, Rollup would still resolve their `@/db` and node:crypto imports
// when bundling it for the client (the client imports other exports from it)
// and `vite build` would break. Nothing client-importable references this
// module, so it tree-shakes out of the client bundle entirely.
//
// Each handler is a plain, directly-testable function; the createServerFn
// wrappers just delegate.

import type { AuthContext } from '@/lib/auth/middleware'
import type { CanvasBoardShareLink } from '@/data/models'
import type {
  CreateCanvasShareLink,
  RevokeCanvasShareLink,
} from '@/data/schema'
import type { ShareDenialReason } from '@/lib/share/denial-reasons'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { findEffectiveRole } from '@/data/permission'
import { getCanvasBoardProjectId } from '@/data/resolve-project'
import { findCanvasBoardById } from '@/data/canvas-board'
import { findCanvasElementsByBoard } from '@/data/canvas-element'
import {
  createCanvasBoardShareLink,
  findCanvasShareLinkById,
  findCanvasShareLinkByTokenHash,
  findCanvasShareLinksByBoardId,
  revokeCanvasBoardShareLinkById,
} from '@/data/canvas-board-share-link'
import { generateInviteToken, hashInviteToken } from '@/lib/auth/invite-token'

/**
 * Classify a mapped link row against the current time. Returns null when the
 * link is currently valid. Same three-state vocabulary as the whiteboard
 * version so `ShareLinkInvalid` renders both without branching.
 */
function classifyShareDenial(
  link: CanvasBoardShareLink,
): ShareDenialReason | null {
  if (link.revokedAt !== null) return 'REVOKED'
  if (link.expiresAt !== null && link.expiresAt.getTime() < Date.now()) {
    return 'EXPIRED'
  }
  return null
}

/**
 * Shared ADMIN+ effective-role gate scoped to a project id.
 *
 * The name matters: the SEC-RBAC-04 ESLint rule
 * (tools/eslint-rules/require-server-fn-authz.cjs) hardcodes
 * `requireMinimumRole` as a trusted RBAC-gate identifier, so every
 * createServerFn handler that calls a function of this name satisfies the
 * rule regardless of which module defines it. Duplicated rather than
 * imported because the original is private to its module — matching this
 * codebase's existing per-feature duplication style.
 *
 * Board-scoped callers resolve the project id via `getCanvasBoardProjectId`
 * FIRST, so a nonexistent board is indistinguishable from unauthorised
 * (SEC-ERR-03).
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
 * Create a canvas board read-only share link. Requires ADMIN or OWNER on the
 * board's project. Multiple independently-revocable links per board are
 * allowed — creating one never touches any existing link.
 *
 * The raw token is returned ONLY here. It is never persisted (only its
 * SHA-256 hash is) and never logged.
 */
export async function createCanvasShareLinkHandler(
  { user }: AuthContext,
  data: CreateCanvasShareLink,
) {
  const projectId = await getCanvasBoardProjectId(data.canvasBoardId)
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

  const link = await createCanvasBoardShareLink({
    canvasBoardId: data.canvasBoardId,
    tokenHash,
    createdByUserId: user.id,
    expiresInHours: data.expiresInHours,
  })

  return {
    success: true as const,
    link: {
      id: link.id,
      canvasBoardId: link.canvasBoardId,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    },
    token: rawToken,
  }
}

/**
 * Revoke a single canvas share link by id. Requires ADMIN or OWNER on the
 * link's board's project. Idempotent — revoking an unknown or already-revoked
 * link is a no-op success, since there is no project context to gate on when
 * the link does not exist and nothing is disclosed either way.
 */
export async function revokeCanvasShareLinkHandler(
  { user }: AuthContext,
  data: RevokeCanvasShareLink,
) {
  const link = await findCanvasShareLinkById(data.linkId)
  if (!link) {
    return { success: true as const }
  }

  const projectId = await getCanvasBoardProjectId(link.canvasBoardId)
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

  await revokeCanvasBoardShareLinkById(data.linkId)
  return { success: true as const }
}

/**
 * List every share link on one canvas board, most recent first. Requires
 * ADMIN or OWNER on the board's project. Never returns the token or its hash.
 */
export async function listCanvasShareLinksHandler(
  { user }: AuthContext,
  canvasBoardId: string,
) {
  const projectId = await getCanvasBoardProjectId(canvasBoardId)
  if (!projectId) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only ADMIN or OWNER can view share links',
    }
  }
  const denial = await requireMinimumRole(
    user.id,
    projectId,
    'Only ADMIN or OWNER can view share links',
  )
  if (denial) return denial

  const links = await findCanvasShareLinksByBoardId(canvasBoardId)

  return {
    links: links.map((link) => ({
      id: link.id,
      canvasBoardId: link.canvasBoardId,
      canvasBoardName: link.canvasBoardName,
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt,
      createdAt: link.createdAt,
    })),
  }
}

/**
 * Public, unauthenticated read of a shared canvas board — used by the
 * logged-out /canvas-share/$token route. Performs no writes.
 *
 * IDOR: `canvasBoardId` is resolved from the token row EXCLUSIVELY. This
 * handler never accepts a client-supplied board id, so a token for board A
 * can never be used to read board B.
 *
 * Never returns projectId, folderId, createdByUserId or tokenHash — only
 * what is needed to render the board read-only.
 */
export async function getSharedCanvasBoardHandler(token: string) {
  const tokenHash = hashInviteToken(token)
  const link = await findCanvasShareLinkByTokenHash(tokenHash)

  if (!link) {
    return { valid: false as const, reason: 'INVALID' as const }
  }

  const denial = classifyShareDenial(link)
  if (denial) {
    return { valid: false as const, reason: denial }
  }

  const board = await findCanvasBoardById(link.canvasBoardId)
  if (!board) {
    return { valid: false as const, reason: 'INVALID' as const }
  }

  const elements = await findCanvasElementsByBoard(link.canvasBoardId)

  return {
    valid: true as const,
    canvasBoardId: board.id,
    canvasBoardName: board.name,
    elements,
  }
}

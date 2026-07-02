// src/lib/invite/handlers.ts
// Invite-by-URL server-fn HANDLER LOGIC — deliberately kept out of
// src/routes/api/invites.ts.
//
// src/routes/invite.$token.tsx and src/components/project/ProjectSharePanel.tsx
// (client components) import the createServerFn-wrapped consts from
// src/routes/api/invites.ts (createProjectInvite, listProjectInvites, etc.).
// TanStack Start's client-bundle transform strips the INLINE closure passed
// to `.handler(...)`, but it cannot strip a plain top-level function that's
// merely REFERENCED there — if these handler functions (and their
// data-layer/`@/db` imports) lived in invites.ts itself, Rollup would still
// need to resolve those imports when bundling invites.ts for the client
// (since the client imports OTHER exports from that same file), pulling
// node:crypto/node:fs/node:module into the browser bundle and breaking
// `vite build` (confirmed by an actual build failure — see the tactical
// fix that moved this code here). Because this module has NO export that
// any client-importable file ever references, Rollup can tree-shake it out
// of the client bundle entirely.
//
// Each handler is a plain, directly-testable function — src/routes/api/
// invites.ts's createServerFn wrappers just delegate to them
// (`.handler(requireAuth(createProjectInviteHandler))`), and
// src/routes/api/invites.test.ts calls them directly against the real test
// DB (no mirror-copy of this logic).

import type { AuthContext } from '@/lib/auth/middleware'
import type { EffectiveRole } from '@/data/permission'
import type {
  CreateInvite,
  ProjectRoleValue,
  RedeemInvite,
  RevokeInvite,
} from '@/data/schema'
import type { InviteDenialReason } from '@/lib/invite/denial-reasons'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { findEffectiveRole } from '@/data/permission'
import { findProjectById } from '@/data/project'
import {
  createProjectInvite as createProjectInviteRow,
  findActiveInviteByTokenHash,
  findProjectInvites,
  revokeProjectInvite,
} from '@/data/project-invite'
import { generateInviteToken, hashInviteToken } from '@/lib/auth/invite-token'
import { INVITE_DENIAL_MESSAGES } from '@/lib/invite/denial-reasons'
import { db, genId, nowMs, transaction } from '@/db'

/** Raw ProjectInvite row shape as returned by db.prepare(...).get(). */
interface InviteRow {
  id: string
  projectId: string
  role: string
  tokenHash: string
  createdByUserId: string
  maxUses: number | null
  usedCount: number
  expiresAt: number
  revokedAt: number | null
  createdAt: number
}

/**
 * Classify a raw invite row against the current time — shared by
 * `redeemInviteHandler` (via a fresh in-transaction read) and
 * `getInvitePreviewHandler`. Returns null if the row is currently redeemable.
 */
function classifyInviteDenial(row: InviteRow): InviteDenialReason | null {
  if (row.revokedAt !== null) return 'REVOKED'
  if (row.expiresAt < nowMs()) return 'EXPIRED'
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return 'EXHAUSTED'
  return null
}

/**
 * Shared ADMIN+ effective-role gate (dedup of the 3x-repeated
 * findEffectiveRole+hasMinimumRole boilerplate in create/list/revoke).
 * Returns the resolved-value FORBIDDEN payload if the caller doesn't meet
 * `minRole`, or null if the gate passes.
 *
 * Recognized directly by the sec-authz/require-server-fn-authz ESLint rule
 * (SEC-RBAC-04) as a trusted RBAC-gate call, the same way
 * requireServerFnRole is trusted — see tools/eslint-rules/
 * require-server-fn-authz.cjs's bodyCallsRequireServerFnRole. That rule also
 * resolves `.handler(requireAuth(createProjectInviteHandler))` in
 * src/routes/api/invites.ts across this file boundary (cross-file
 * resolution), so moving these handlers here does not weaken SEC-RBAC-04.
 */
async function requireMinimumRole(
  userId: string,
  projectId: string,
  minRole: EffectiveRole,
  message: string,
): Promise<{ error: 'FORBIDDEN'; status: 403; message: string } | null> {
  const role = await findEffectiveRole(userId, projectId)
  if (!hasMinimumRole(role, minRole)) {
    return { error: 'FORBIDDEN' as const, status: 403, message }
  }
  return null
}

/**
 * Create an invite link for a project.
 * Requires ADMIN or OWNER effective role. The raw token is returned ONLY in
 * this response — it is never persisted (only its SHA-256 hash is stored)
 * and never logged.
 */
export async function createProjectInviteHandler(
  { user }: AuthContext,
  data: CreateInvite,
) {
  const denial = await requireMinimumRole(
    user.id,
    data.projectId,
    'ADMIN',
    'Only ADMIN or OWNER can create invite links',
  )
  if (denial) return denial

  const rawToken = generateInviteToken()
  const tokenHash = hashInviteToken(rawToken)

  const invite = await createProjectInviteRow({
    projectId: data.projectId,
    role: data.role,
    tokenHash,
    createdByUserId: user.id,
    expiresInHours: data.expiresInHours,
  })

  return {
    success: true as const,
    invite: {
      id: invite.id,
      role: invite.role,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    },
    token: rawToken,
  }
}

/**
 * List all invite links for a project.
 * Requires ADMIN or OWNER effective role. Never returns `tokenHash` or the
 * raw token — there is no "reveal token" endpoint.
 */
export async function listProjectInvitesHandler(
  { user }: AuthContext,
  projectId: string,
) {
  const denial = await requireMinimumRole(
    user.id,
    projectId,
    'ADMIN',
    'Only ADMIN or OWNER can view invite links',
  )
  if (denial) return denial

  const invites = await findProjectInvites(projectId)

  return {
    invites: invites.map((invite) => ({
      id: invite.id,
      role: invite.role,
      maxUses: invite.maxUses,
      usedCount: invite.usedCount,
      expiresAt: invite.expiresAt,
      revokedAt: invite.revokedAt,
      createdAt: invite.createdAt,
      createdByUserId: invite.createdByUserId,
      createdByUsername: invite.createdByUsername,
    })),
  }
}

/**
 * Revoke an outstanding invite link.
 * Requires ADMIN or OWNER effective role. Idempotent — revoking an
 * already-revoked link is a no-op success.
 */
export async function revokeInviteHandler(
  { user }: AuthContext,
  data: RevokeInvite,
) {
  const denial = await requireMinimumRole(
    user.id,
    data.projectId,
    'ADMIN',
    'Only ADMIN or OWNER can revoke invite links',
  )
  if (denial) return denial

  await revokeProjectInvite(data.projectId, data.inviteId)
  return { success: true as const }
}

/**
 * Redeem an invite link, granting the authenticated caller the invite's role
 * on the target project. Never downgrades an existing higher role (including
 * OWNER) — a redemption by an already-sufficiently-privileged member is a
 * no-op write that still consumes a "use".
 *
 * Unlike requireServerFnRole's SEC-ERR-03 not-found/unauthorized masking
 * (which exists because project IDs are enumerable resource identifiers),
 * the four distinct denial reasons here (INVALID/REVOKED/EXPIRED/EXHAUSTED)
 * are safe to differentiate: the token itself is an unguessable 256-bit
 * bearer secret already held only by whoever has the link, so telling that
 * holder *why* their own link no longer works discloses nothing to a third
 * party who doesn't already possess it. Do not apply SEC-ERR-03 masking here.
 *
 * The entire read-decide-write sequence — including the usedCount increment
 * AND the ProjectMember upsert — runs as raw, synchronous `db.prepare().run()`
 * calls directly inside a single `transaction()` callback (src/db.ts).
 * `transaction()` only rolls back on a SYNCHRONOUS throw from its callback;
 * every function in the data layer (createProjectMember, upsertProjectMember,
 * incrementInviteUsedCount, ...) is declared `async` even though its body is
 * fully synchronous, which means a throw inside one of them (e.g. an FK
 * violation) is converted into a REJECTED PROMISE rather than propagating
 * synchronously — awaiting is impossible inside this callback (it isn't
 * `async`), and calling them unawaited (`void fn(...)`) would silently drop
 * that rejection: COMMIT would still run, "succeeding" with a half-applied
 * or entirely missing write. Raw SQL is the only way to keep this
 * transaction genuinely atomic. (Do not "fix" this back to void-async calls
 * — see src/routes/api/invites.test.ts's B1 regression test.)
 */
export async function redeemInviteHandler(
  { user }: AuthContext,
  data: RedeemInvite,
) {
  const tokenHash = hashInviteToken(data.token)

  return transaction(() => {
    const row = db
      .prepare('SELECT * FROM "ProjectInvite" WHERE "tokenHash" = ?')
      .get(tokenHash) as InviteRow | undefined

    if (!row) {
      return {
        success: false as const,
        error: 'INVALID' as const,
        message: INVITE_DENIAL_MESSAGES.INVALID,
      }
    }

    const denial = classifyInviteDenial(row)
    if (denial) {
      return {
        success: false as const,
        error: denial,
        message: INVITE_DENIAL_MESSAGES[denial],
      }
    }

    // Fresh, in-transaction read of the redeemer's current effective
    // role — mirrors findEffectiveRole's query. Must be raw/synchronous
    // (not the async wrapper) so it participates in this transaction.
    const project = db
      .prepare('SELECT "ownerId" FROM "Project" WHERE "id" = ?')
      .get(row.projectId) as { ownerId: string | null } | undefined
    let currentRole: EffectiveRole | null = null
    if (project?.ownerId === user.id) {
      currentRole = 'OWNER'
    } else {
      const member = db
        .prepare(
          'SELECT "role" FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
        )
        .get(row.projectId, user.id) as
        | { role: ProjectRoleValue }
        | undefined
      currentRole = member?.role ?? null
    }

    const inviteRole = row.role as ProjectRoleValue

    if (hasMinimumRole(currentRole, inviteRole)) {
      // Idempotent — never downgrade an existing higher (or equal) role.
      // Still consumes a "use" of a multi-use link. Raw SQL — see the
      // function-level doc comment for why this can't be the async
      // incrementInviteUsedCount wrapper.
      db.prepare(
        'UPDATE "ProjectInvite" SET "usedCount" = "usedCount" + 1 WHERE "id" = ?',
      ).run(row.id)
      return {
        success: true as const,
        projectId: row.projectId,
        role: currentRole,
      }
    }

    // Raw SQL — mirrors upsertProjectMember's (src/data/permission.ts)
    // exact INSERT ... ON CONFLICT statement. MUST be a synchronous
    // db.prepare().run() call, not the async wrapper — see the
    // function-level doc comment above.
    const memberId = genId()
    const ts = nowMs()
    db.prepare(
      'INSERT INTO "ProjectMember" ("id", "projectId", "userId", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT("projectId", "userId") DO UPDATE SET "role" = excluded."role", "updatedAt" = excluded."updatedAt"',
    ).run(memberId, row.projectId, user.id, inviteRole, ts, ts)
    db.prepare(
      'UPDATE "ProjectInvite" SET "usedCount" = "usedCount" + 1 WHERE "id" = ?',
    ).run(row.id)

    return {
      success: true as const,
      projectId: row.projectId,
      role: inviteRole,
    }
  })
}

/**
 * Public, unauthenticated invite preview — used by the logged-out landing
 * page to show "You've been invited to join {projectName} as {role}" before
 * requiring login. Performs no writes. Never returns `projectId`,
 * `createdByUserId`, `tokenHash`, or the raw token — the only information
 * disclosed pre-auth is the target project's display name and offered role.
 */
export async function getInvitePreviewHandler(token: string) {
  const tokenHash = hashInviteToken(token)
  const invite = await findActiveInviteByTokenHash(tokenHash)

  if (!invite) {
    return { valid: false as const, reason: 'INVALID' as const }
  }

  const row: InviteRow = {
    id: invite.id,
    projectId: invite.projectId,
    role: invite.role,
    tokenHash: invite.tokenHash,
    createdByUserId: invite.createdByUserId,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    expiresAt: invite.expiresAt.getTime(),
    revokedAt: invite.revokedAt ? invite.revokedAt.getTime() : null,
    createdAt: invite.createdAt.getTime(),
  }
  const denial = classifyInviteDenial(row)
  if (denial) {
    return { valid: false as const, reason: denial }
  }

  const project = await findProjectById(invite.projectId)
  if (!project) {
    return { valid: false as const, reason: 'INVALID' as const }
  }

  return {
    valid: true as const,
    projectName: project.name,
    role: invite.role,
  }
}

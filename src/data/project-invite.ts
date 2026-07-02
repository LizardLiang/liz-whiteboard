// src/data/project-invite.ts
// Data access layer for ProjectInvite (invite-by-URL) entity.
// Follows src/data/permission.ts's style: raw db.prepare calls, insert/genId/
// nowMs helpers from @/db.

import type { ProjectInvite } from '@/data/models'
import type { ProjectRoleValue as ProjectRole } from '@/data/schema'
import { db, genId, insert, mapProjectInvite, nowMs } from '@/db'

const MS_PER_HOUR = 3_600_000

/** ProjectInvite row plus the display-only creator username (never tokenHash). */
export type ProjectInviteWithCreator = ProjectInvite & {
  createdByUsername: string | null
}

/**
 * Create a project invite row. The caller (server-fn layer, src/routes/api/
 * invites.ts) is responsible for generating the raw token and hashing it —
 * this function only ever persists the hash, never the raw token.
 */
export async function createProjectInvite(data: {
  projectId: string
  role: ProjectRole
  tokenHash: string
  createdByUserId: string
  expiresInHours: number
}): Promise<ProjectInvite> {
  const id = genId()
  const ts = nowMs()
  const expiresAt = ts + data.expiresInHours * MS_PER_HOUR
  insert('ProjectInvite', {
    id,
    projectId: data.projectId,
    role: data.role,
    tokenHash: data.tokenHash,
    createdByUserId: data.createdByUserId,
    maxUses: null,
    usedCount: 0,
    expiresAt,
    revokedAt: null,
    createdAt: ts,
  })

  // Opportunistic sweep of expired invites (mirrors OauthRefreshToken's
  // `DELETE ... WHERE expiresAt < ?` pattern in src/lib/oauth/tokens.ts —
  // runs at write time, no background timer/cron needed). Excludes the row
  // just inserted above by id so a caller can still create an
  // already-past-expiry invite (e.g. for testing EXPIRED redemption/preview
  // behavior) without it vanishing before it can be read back.
  db.prepare('DELETE FROM "ProjectInvite" WHERE "expiresAt" < ? AND "id" != ?').run(
    ts,
    id,
  )

  return mapProjectInvite(
    db.prepare('SELECT * FROM "ProjectInvite" WHERE "id" = ?').get(id),
  )!
}

/**
 * Find an invite by its token hash (unique-index lookup, mirrors
 * findAuthSessionByTokenHash / OauthRefreshToken's tokenHash lookups).
 *
 * Deliberately does NOT filter on expiry/revocation/usage — returns the raw
 * row (or null) and lets the caller decide, so redemption can distinguish a
 * specific denial reason (expired vs revoked vs exhausted vs not-found).
 */
export async function findActiveInviteByTokenHash(
  tokenHash: string,
): Promise<ProjectInvite | null> {
  return mapProjectInvite(
    db
      .prepare('SELECT * FROM "ProjectInvite" WHERE "tokenHash" = ?')
      .get(tokenHash),
  )
}

/**
 * List all invites for a project, most recent first, joined with the
 * creator's username in a single query (batched — avoids an N+1 of
 * per-invite `findUserById` lookups at the route-handler level). Returns
 * full rows including tokenHash — redaction for the client happens at the
 * route-handler level (src/routes/api/invites.ts), keeping this layer
 * symmetric with findProjectMembers.
 */
export async function findProjectInvites(
  projectId: string,
): Promise<Array<ProjectInviteWithCreator>> {
  const rows = db
    .prepare(
      `SELECT "pi".*, "u"."username" AS "createdByUsername"
       FROM "ProjectInvite" "pi"
       LEFT JOIN "User" "u" ON "u"."id" = "pi"."createdByUserId"
       WHERE "pi"."projectId" = ?
       ORDER BY "pi"."createdAt" DESC`,
    )
    .all(projectId)

  return rows.map((r) => ({
    ...mapProjectInvite(r)!,
    createdByUsername: (r.createdByUsername as string | null) ?? null,
  }))
}

/**
 * Soft-revoke an invite (idempotent no-op if already revoked — no error on
 * double-revoke).
 */
export async function revokeProjectInvite(
  projectId: string,
  inviteId: string,
): Promise<void> {
  db.prepare(
    'UPDATE "ProjectInvite" SET "revokedAt" = ? WHERE "id" = ? AND "projectId" = ? AND "revokedAt" IS NULL',
  ).run(nowMs(), inviteId, projectId)
}

/**
 * Increment an invite's used-count by 1.
 *
 * NOTE: `redeemInvite` (src/routes/api/invites.ts) does NOT call this
 * function — its read-decide-write sequence runs raw `db.prepare().run()`
 * statements directly inside a synchronous `transaction()` callback, because
 * this function (like the rest of this data layer) is declared `async` and
 * therefore cannot be awaited from within that synchronous callback without
 * losing atomicity (an async function's throw becomes a rejected promise,
 * not a synchronous throw the transaction can roll back on). This function
 * remains available for any standalone (non-transactional) caller.
 */
export async function incrementInviteUsedCount(
  inviteId: string,
): Promise<void> {
  db.prepare(
    'UPDATE "ProjectInvite" SET "usedCount" = "usedCount" + 1 WHERE "id" = ?',
  ).run(inviteId)
}

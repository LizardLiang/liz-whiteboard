// src/data/whiteboard-share-link.ts
// Data access layer for WhiteboardShareLink (read-only public share links,
// GH #109). Follows src/data/project-invite.ts's style exactly: raw
// db.prepare calls, insert/genId/nowMs helpers from @/db.
//
// A2: multiple independently-revocable links are allowed per whiteboard —
// there is no "at most one active link" enforcement here or at the handler
// layer. Listing is PER-PROJECT (findShareLinksByProjectId), mirroring
// findProjectInvites' per-project listing.

import type { WhiteboardShareLink } from '@/data/models'
import { db, genId, insert, mapWhiteboardShareLink, nowMs } from '@/db'

const MS_PER_HOUR = 3_600_000

/** WhiteboardShareLink row plus the display-only whiteboard name (never tokenHash to the client — redaction happens at the handler layer). */
export type WhiteboardShareLinkWithWhiteboard = WhiteboardShareLink & {
  whiteboardName: string
}

/**
 * Create a whiteboard share link row. The caller (src/lib/share/handlers.ts)
 * is responsible for generating the raw token and hashing it — this function
 * only ever persists the hash, never the raw token.
 *
 * A3: `expiresInHours` is REQUIRED — every link has a populated `expiresAt`,
 * mirroring createProjectInvite. There is no never-expires option.
 */
export async function createWhiteboardShareLink(data: {
  whiteboardId: string
  tokenHash: string
  createdByUserId: string
  expiresInHours: number
}): Promise<WhiteboardShareLink> {
  const id = genId()
  const ts = nowMs()
  const expiresAt = ts + data.expiresInHours * MS_PER_HOUR
  insert('WhiteboardShareLink', {
    id,
    whiteboardId: data.whiteboardId,
    tokenHash: data.tokenHash,
    createdByUserId: data.createdByUserId,
    expiresAt,
    revokedAt: null,
    createdAt: ts,
  })

  // Opportunistic sweep of expired links (mirrors createProjectInvite's
  // sweep in src/data/project-invite.ts) — runs at write time, no background
  // timer/cron needed. Excludes the row just inserted by id so a caller can
  // still create an already-past-expiry link (e.g. for testing EXPIRED
  // redemption behavior) without it vanishing before it can be read back.
  db.prepare(
    'DELETE FROM "WhiteboardShareLink" WHERE "expiresAt" < ? AND "id" != ?',
  ).run(ts, id)

  return mapWhiteboardShareLink(
    db.prepare('SELECT * FROM "WhiteboardShareLink" WHERE "id" = ?').get(id),
  )!
}

/**
 * Find a share link by its token hash (unique-index lookup, mirrors
 * findActiveInviteByTokenHash).
 *
 * Deliberately does NOT filter on expiry/revocation — returns the raw row
 * (or null) and lets the caller (getSharedWhiteboardHandler) decide, so it
 * can distinguish a specific denial reason (expired vs revoked vs not-found).
 */
export async function findShareLinkByTokenHash(
  tokenHash: string,
): Promise<WhiteboardShareLink | null> {
  return mapWhiteboardShareLink(
    db
      .prepare('SELECT * FROM "WhiteboardShareLink" WHERE "tokenHash" = ?')
      .get(tokenHash),
  )
}

/**
 * Find a share link by its own id — used by revokeShareLinkHandler to
 * resolve which whiteboard (and therefore which project) a revoke request
 * scopes to, before running the ADMIN+ check.
 */
export async function findShareLinkById(
  linkId: string,
): Promise<WhiteboardShareLink | null> {
  return mapWhiteboardShareLink(
    db
      .prepare('SELECT * FROM "WhiteboardShareLink" WHERE "id" = ?')
      .get(linkId),
  )
}

/**
 * List all share links across every whiteboard in a project, most recent
 * first, joined with the whiteboard's name in a single query (batched —
 * avoids an N+1 of per-link whiteboard lookups at the handler level).
 * Mirrors findProjectInvites' shape/style.
 */
export async function findShareLinksByProjectId(
  projectId: string,
): Promise<Array<WhiteboardShareLinkWithWhiteboard>> {
  const rows = db
    .prepare(
      `SELECT "wsl".*, "w"."name" AS "whiteboardName"
       FROM "WhiteboardShareLink" "wsl"
       JOIN "Whiteboard" "w" ON "w"."id" = "wsl"."whiteboardId"
       WHERE "w"."projectId" = ?
       ORDER BY "wsl"."createdAt" DESC, "wsl"."rowid" DESC`,
    )
    .all(projectId)

  return rows.map((r) => ({
    ...mapWhiteboardShareLink(r)!,
    whiteboardName: r.whiteboardName as string,
  }))
}

/**
 * Soft-revoke a single share link by id (idempotent no-op if already
 * revoked, or if no row matches — no error on double-revoke). A2: links are
 * revoked individually by id, not by whiteboardId (a whiteboard may have
 * several outstanding links at once).
 */
export async function revokeWhiteboardShareLinkById(
  linkId: string,
): Promise<void> {
  db.prepare(
    'UPDATE "WhiteboardShareLink" SET "revokedAt" = ? WHERE "id" = ? AND "revokedAt" IS NULL',
  ).run(nowMs(), linkId)
}

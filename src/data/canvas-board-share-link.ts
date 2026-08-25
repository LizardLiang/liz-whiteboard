// src/data/canvas-board-share-link.ts
// Data access layer for CanvasBoardShareLink — public read-only share links
// for canvas boards. Mirrors src/data/whiteboard-share-link.ts exactly: raw
// db.prepare calls, insert/genId/nowMs from @/db, and the same expiry sweep.
//
// The two modules are kept side by side rather than merged because they
// reference different board kinds through different foreign keys. Anything
// that changes here almost certainly needs the same change there; the
// deliberate structural symmetry is what makes that easy to see.
//
// Only the SHA-256 token HASH is ever persisted. Generating and hashing the
// raw token is the handler layer's job (src/lib/share/canvas-handlers.ts).

import type { CanvasBoardShareLink } from '@/data/models'
import { db, genId, insert, mapCanvasBoardShareLink, nowMs } from '@/db'

const MS_PER_HOUR = 3_600_000

/** CanvasBoardShareLink row plus the display-only board name. Never carries tokenHash to a client — redaction happens at the handler layer. */
export type CanvasBoardShareLinkWithBoard = CanvasBoardShareLink & {
  canvasBoardName: string
}

/**
 * Create a canvas board share link row.
 *
 * `expiresInHours` is required, matching `createWhiteboardShareLink`: every
 * link has a populated `expiresAt` and there is no never-expires option.
 */
export async function createCanvasBoardShareLink(data: {
  canvasBoardId: string
  tokenHash: string
  createdByUserId: string
  expiresInHours: number
}): Promise<CanvasBoardShareLink> {
  const id = genId()
  const ts = nowMs()
  const expiresAt = ts + data.expiresInHours * MS_PER_HOUR
  insert('CanvasBoardShareLink', {
    id,
    canvasBoardId: data.canvasBoardId,
    tokenHash: data.tokenHash,
    createdByUserId: data.createdByUserId,
    expiresAt,
    revokedAt: null,
    createdAt: ts,
  })

  // Opportunistic sweep of expired links at write time — no cron, mirroring
  // createWhiteboardShareLink. The row just inserted is excluded by id so a
  // caller can still create an already-past-expiry link (tests do) without
  // it vanishing before it can be read back.
  db.prepare(
    'DELETE FROM "CanvasBoardShareLink" WHERE "expiresAt" < ? AND "id" != ?',
  ).run(ts, id)

  return mapCanvasBoardShareLink(
    db.prepare('SELECT * FROM "CanvasBoardShareLink" WHERE "id" = ?').get(id),
  )!
}

/**
 * Find a share link by its token hash (unique-index lookup).
 *
 * Deliberately does NOT filter on expiry or revocation — it returns the raw
 * row and lets the caller decide, so the public handler can distinguish
 * expired from revoked from never-existed.
 */
export async function findCanvasShareLinkByTokenHash(
  tokenHash: string,
): Promise<CanvasBoardShareLink | null> {
  return mapCanvasBoardShareLink(
    db
      .prepare('SELECT * FROM "CanvasBoardShareLink" WHERE "tokenHash" = ?')
      .get(tokenHash),
  )
}

/**
 * Find a share link by its own id — used by the revoke handler to resolve
 * which board (and therefore which project) a revoke request scopes to,
 * before running the ADMIN+ check.
 */
export async function findCanvasShareLinkById(
  linkId: string,
): Promise<CanvasBoardShareLink | null> {
  return mapCanvasBoardShareLink(
    db
      .prepare('SELECT * FROM "CanvasBoardShareLink" WHERE "id" = ?')
      .get(linkId),
  )
}

/**
 * Every share link on one canvas board, most recent first. Scoped per BOARD
 * rather than per project (unlike `findShareLinksByProjectId`) because the
 * canvas share UI lives on the board itself, not in the project panel.
 */
export async function findCanvasShareLinksByBoardId(
  canvasBoardId: string,
): Promise<Array<CanvasBoardShareLinkWithBoard>> {
  const rows = db
    .prepare(
      `SELECT "csl".*, "cb"."name" AS "canvasBoardName"
       FROM "CanvasBoardShareLink" "csl"
       JOIN "CanvasBoard" "cb" ON "cb"."id" = "csl"."canvasBoardId"
       WHERE "csl"."canvasBoardId" = ?
       ORDER BY "csl"."createdAt" DESC, "csl"."rowid" DESC`,
    )
    .all(canvasBoardId)

  return rows.map((r) => ({
    ...mapCanvasBoardShareLink(r)!,
    canvasBoardName: r.canvasBoardName as string,
  }))
}

/**
 * Soft-revoke one share link by id. Idempotent: a double revoke, or a revoke
 * of an id that matches nothing, is a silent no-op rather than an error.
 */
export async function revokeCanvasBoardShareLinkById(
  linkId: string,
): Promise<void> {
  db.prepare(
    'UPDATE "CanvasBoardShareLink" SET "revokedAt" = ? WHERE "id" = ? AND "revokedAt" IS NULL',
  ).run(nowMs(), linkId)
}

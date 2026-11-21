// src/data/project-email-invite.ts
// Data access layer for ProjectEmailInvite (grant-by-email). Raw SQL in the
// style of src/data/signup-token.ts. Only the token hash is stored.

import type { ProjectEmailInvite } from '@/data/models'
import type { ProjectRoleValue } from '@/data/schema'
import {
  db,
  genId,
  insert,
  mapProjectEmailInvite,
  nowMs,
  transaction,
} from '@/db'

/** An email invite is valid for 7 days from issuance. */
export const EMAIL_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Age past expiry after which the sweep deletes a row. */
export const EMAIL_INVITE_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Pending invites one project may hold; blocks an admin from filling the table. */
export const EMAIL_INVITE_PENDING_MAX = 200

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Send limits. Every number below is a guess, sized far above normal team use.
// Counts come from DB rows of ANY state (pending, voided, revoked, accepted),
// so a re-invite cannot dodge them and a restart does not reset them.
export const EMAIL_INVITE_INVITER_PER_HOUR = 20 // guess
export const EMAIL_INVITE_INVITER_PER_DAY = 100 // guess
/** Visible limit: one inviter's own sends to one address. */
export const EMAIL_INVITE_PAIR_PER_HOUR = 3 // guess
export const EMAIL_INVITE_PAIR_PER_DAY = 10 // guess
/**
 * Silent ceiling: all inviters together to one address in 24 h. At the
 * ceiling the row is stored and the reply is unchanged, but no email goes out,
 * so one tenant's volume never makes another tenant's invite fail.
 */
export const EMAIL_INVITE_RECIPIENT_CEILING_PER_DAY = 30 // guess
/** Silent ceiling, hourly: all inviters together to one address. */
export const EMAIL_INVITE_RECIPIENT_CEILING_PER_HOUR = 5 // guess
/** No new email to the same (project, recipient) inside this window. */
export const EMAIL_INVITE_COOLDOWN_MS = 10 * 60 * 1000 // guess

function countSince(
  column: 'invitedByUserId' | 'email',
  value: string,
  sinceMs: number,
): number {
  const row = db
    .prepare(
      `SELECT count(*) AS c FROM "ProjectEmailInvite" WHERE "${column}" = ? AND "createdAt" >= ?`,
    )
    .get(value, sinceMs) as { c: number }
  return Number(row.c)
}

function countPairSince(
  invitedByUserId: string,
  email: string,
  sinceMs: number,
): number {
  const row = db
    .prepare(
      `SELECT count(*) AS c FROM "ProjectEmailInvite"
       WHERE "invitedByUserId" = ? AND "email" = ? AND "createdAt" >= ?`,
    )
    .get(invitedByUserId, email, sinceMs) as { c: number }
  return Number(row.c)
}

export type TryCreateEmailInviteResult =
  | {
      status: 'created'
      invite: ProjectEmailInvite
      /** True when the silent per-recipient ceiling was hit: store, do not send. */
      suppressEmail: boolean
    }
  | { status: 'cooldown' }
  /** Silent ceiling hit and a sent pending row was kept (role updated if it differed). */
  | { status: 'suppressed' }
  | { status: 'inviter_limit' }
  | { status: 'recipient_limit' }

/**
 * Check the send limits and, if they pass, store one invite, in ONE
 * synchronous transaction. Order: the (project, email) cooldown first (the
 * caller replies as for a send, and sends nothing; a changed role updates
 * the pending row in place), then the per-inviter limits, then the visible
 * (inviter, address) limits, then the silent per-address ceiling.
 */
export function tryCreateEmailInvite(params: {
  projectId: string
  email: string
  role: ProjectRoleValue
  tokenHash: string
  invitedByUserId: string
}): TryCreateEmailInviteResult {
  return transaction(() => {
    const now = nowMs()
    const last = db
      .prepare(
        'SELECT max("createdAt") AS t FROM "ProjectEmailInvite" WHERE "projectId" = ? AND "email" = ?',
      )
      .get(params.projectId, params.email) as { t: number | null }
    if (last.t !== null && now - Number(last.t) < EMAIL_INVITE_COOLDOWN_MS) {
      // A new role inside the cooldown changes the pending row in place. Its
      // token stays, so the email already sent stays valid.
      db.prepare(
        `UPDATE "ProjectEmailInvite" SET "role" = ?
         WHERE "projectId" = ? AND "email" = ? AND "acceptedAt" IS NULL
           AND "revokedAt" IS NULL AND "expiresAt" > ? AND "role" != ?`,
      ).run(params.role, params.projectId, params.email, now, params.role)
      return { status: 'cooldown' as const }
    }
    const by = params.invitedByUserId
    if (
      countSince('invitedByUserId', by, now - HOUR_MS) >=
        EMAIL_INVITE_INVITER_PER_HOUR ||
      countSince('invitedByUserId', by, now - DAY_MS) >=
        EMAIL_INVITE_INVITER_PER_DAY
    ) {
      return { status: 'inviter_limit' as const }
    }
    if (
      countPairSince(by, params.email, now - HOUR_MS) >=
        EMAIL_INVITE_PAIR_PER_HOUR ||
      countPairSince(by, params.email, now - DAY_MS) >=
        EMAIL_INVITE_PAIR_PER_DAY
    ) {
      return { status: 'recipient_limit' as const }
    }
    const suppressEmail =
      countSince('email', params.email, now - DAY_MS) >=
        EMAIL_INVITE_RECIPIENT_CEILING_PER_DAY ||
      countSince('email', params.email, now - HOUR_MS) >=
        EMAIL_INVITE_RECIPIENT_CEILING_PER_HOUR
    if (suppressEmail) {
      // A token is revoked only when a replacement email is actually sent. A
      // pending row whose email went out stays as it is; only its role moves.
      const pending = db
        .prepare(
          `SELECT "id" FROM "ProjectEmailInvite"
           WHERE "projectId" = ? AND "email" = ? AND "acceptedAt" IS NULL
             AND "revokedAt" IS NULL AND "expiresAt" > ?`,
        )
        .get(params.projectId, params.email, now) as { id: string } | undefined
      if (pending) {
        db.prepare(
          'UPDATE "ProjectEmailInvite" SET "role" = ? WHERE "id" = ?',
        ).run(params.role, pending.id)
        return { status: 'suppressed' as const }
      }
    }
    return {
      status: 'created' as const,
      invite: insertEmailInvite(params),
      suppressEmail,
    }
  })
}

/**
 * Store one invite for (project, email). A still-pending older row of the same
 * pair is revoked in the same transaction, so only the newest link works.
 * `email` must already be lower-cased.
 */
function insertEmailInvite(params: {
  projectId: string
  email: string
  role: ProjectRoleValue
  tokenHash: string
  invitedByUserId: string
}): ProjectEmailInvite {
  const now = nowMs()
  db.prepare(
    `UPDATE "ProjectEmailInvite" SET "revokedAt" = ?
     WHERE "projectId" = ? AND "email" = ? AND "acceptedAt" IS NULL AND "revokedAt" IS NULL`,
  ).run(now, params.projectId, params.email)

  const id = genId()
  insert('ProjectEmailInvite', {
    id,
    projectId: params.projectId,
    email: params.email,
    role: params.role,
    tokenHash: params.tokenHash,
    invitedByUserId: params.invitedByUserId,
    expiresAt: now + EMAIL_INVITE_TTL_MS,
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
  })
  return mapProjectEmailInvite(
    db.prepare('SELECT * FROM "ProjectEmailInvite" WHERE "id" = ?').get(id),
  )!
}

/** Store one invite without the send limits. Used by tests; the handler calls tryCreateEmailInvite. */
export function createEmailInvite(params: {
  projectId: string
  email: string
  role: ProjectRoleValue
  tokenHash: string
  invitedByUserId: string
}): ProjectEmailInvite {
  return transaction(() => insertEmailInvite(params))
}

/** Count the pending (not accepted, revoked or expired) invites of a project. */
export function countPendingEmailInvites(projectId: string): number {
  const row = db
    .prepare(
      `SELECT count(*) AS c FROM "ProjectEmailInvite"
       WHERE "projectId" = ? AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > ?`,
    )
    .get(projectId, nowMs()) as { c: number }
  return Number(row.c)
}

/** Pending invites of a project, newest first. Never returns the token hash to callers that drop it. */
export function findPendingEmailInvites(
  projectId: string,
): Array<ProjectEmailInvite> {
  return db
    .prepare(
      `SELECT * FROM "ProjectEmailInvite"
       WHERE "projectId" = ? AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > ?
       ORDER BY "createdAt" DESC`,
    )
    .all(projectId, nowMs())
    .map((r) => mapProjectEmailInvite(r)!)
}

export function findEmailInviteByTokenHash(
  tokenHash: string,
): ProjectEmailInvite | null {
  return mapProjectEmailInvite(
    db
      .prepare('SELECT * FROM "ProjectEmailInvite" WHERE "tokenHash" = ?')
      .get(tokenHash),
  )
}

export type EmailInviteState = 'valid' | 'expired' | 'revoked' | 'used'

export function classifyEmailInvite(
  invite: ProjectEmailInvite,
): EmailInviteState {
  if (invite.acceptedAt) return 'used'
  if (invite.revokedAt) return 'revoked'
  if (invite.expiresAt.getTime() <= nowMs()) return 'expired'
  return 'valid'
}

/** Revoke a pending invite of the project. Returns true when a row changed. */
export function revokeEmailInvite(
  projectId: string,
  inviteId: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE "ProjectEmailInvite" SET "revokedAt" = ?
       WHERE "id" = ? AND "projectId" = ? AND "acceptedAt" IS NULL AND "revokedAt" IS NULL`,
    )
    .run(nowMs(), inviteId, projectId)
  return Number(result.changes) > 0
}

/**
 * Claim an invite: set acceptedAt only if it is still pending and unexpired.
 * Returns true for exactly one caller, so a replayed link cannot win twice.
 */
export function claimEmailInvite(inviteId: string): boolean {
  const now = nowMs()
  const result = db
    .prepare(
      `UPDATE "ProjectEmailInvite" SET "acceptedAt" = ?
       WHERE "id" = ? AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > ?`,
    )
    .run(now, inviteId, now)
  return Number(result.changes) > 0
}

/** Undo a claim when the role write that followed it failed. */
export function releaseEmailInvite(inviteId: string): void {
  db.prepare(
    'UPDATE "ProjectEmailInvite" SET "acceptedAt" = NULL WHERE "id" = ?',
  ).run(inviteId)
}

/** Delete rows that expired more than `ageMs` ago. Returns the number deleted. */
export function deleteEmailInvitesExpiredBefore(ageMs: number): number {
  const result = db
    .prepare('DELETE FROM "ProjectEmailInvite" WHERE "expiresAt" < ?')
    .run(nowMs() - ageMs)
  return Number(result.changes)
}

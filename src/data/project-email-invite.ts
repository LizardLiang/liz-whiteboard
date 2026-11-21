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

/**
 * Store one invite for (project, email). A still-pending older row of the same
 * pair is revoked in the same transaction, so only the newest link works.
 * `email` must already be lower-cased.
 */
export function createEmailInvite(params: {
  projectId: string
  email: string
  role: ProjectRoleValue
  tokenHash: string
  invitedByUserId: string
}): ProjectEmailInvite {
  return transaction(() => {
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
  })
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

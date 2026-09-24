// src/data/password-reset.ts
// Data access layer for the PasswordResetToken (forgot-password) entity.
// Raw SQL in the style of src/data/user.ts / src/data/project-invite.ts.

import type { PasswordResetToken } from '@/data/models'
import { db, genId, insert, mapPasswordResetToken, nowMs, transaction } from '@/db'
import { RESET_TOKEN_TTL_MS } from '@/lib/auth/reset-token'

/**
 * Create a reset-token row for a user. Voids (sets usedAt) every earlier
 * unused row of that user first, so at most one reset link is ever live at a
 * time — opening a new one invalidates any still-unused older link.
 *
 * @param userId - User UUID
 * @param tokenHash - SHA-256 hash of the raw token (caller generates/hashes it)
 */
export async function createResetToken(
  userId: string,
  tokenHash: string,
): Promise<PasswordResetToken> {
  const ts = nowMs()
  db.prepare(
    'UPDATE "PasswordResetToken" SET "usedAt" = ? WHERE "userId" = ? AND "usedAt" IS NULL',
  ).run(ts, userId)

  const id = genId()
  insert('PasswordResetToken', {
    id,
    userId,
    tokenHash,
    expiresAt: ts + RESET_TOKEN_TTL_MS,
    usedAt: null,
    createdAt: ts,
  })

  return mapPasswordResetToken(
    db.prepare('SELECT * FROM "PasswordResetToken" WHERE "id" = ?').get(id),
  )!
}

/**
 * Find a reset-token row by its hash, but only when it is still usable
 * (unused and unexpired). Returns null for a used, expired, or unknown hash —
 * the caller cannot distinguish which from the return value alone, which is
 * intentional (no oracle for which reason a token was rejected).
 *
 * @param tokenHash - SHA-256 hash of the raw token
 */
export async function findValidResetToken(
  tokenHash: string,
): Promise<PasswordResetToken | null> {
  const now = nowMs()
  return mapPasswordResetToken(
    db
      .prepare(
        'SELECT * FROM "PasswordResetToken" WHERE "tokenHash" = ? AND "usedAt" IS NULL AND "expiresAt" > ?',
      )
      .get(tokenHash, now),
  )
}

/**
 * Count reset-token rows created for a user since a given time. Used by the
 * per-user cooldown and per-user daily cap (src/lib/auth/reset-limits.ts).
 *
 * @param userId - User UUID
 * @param sinceMs - Unix-ms lower bound (inclusive)
 */
export async function countResetsForUserSince(
  userId: string,
  sinceMs: number,
): Promise<number> {
  const row = db
    .prepare(
      'SELECT count(*) AS c FROM "PasswordResetToken" WHERE "userId" = ? AND "createdAt" >= ?',
    )
    .get(userId, sinceMs) as { c: number }
  return Number(row.c)
}

/**
 * Count reset-token rows created (by any user) since a given time. Used by
 * the global daily cap (src/lib/auth/reset-limits.ts).
 *
 * @param sinceMs - Unix-ms lower bound (inclusive)
 */
export async function countResetsSince(sinceMs: number): Promise<number> {
  const row = db
    .prepare('SELECT count(*) AS c FROM "PasswordResetToken" WHERE "createdAt" >= ?')
    .get(sinceMs) as { c: number }
  return Number(row.c)
}

/**
 * Lazy cleanup: delete reset-token rows older than the given age. Runs at
 * request time (requestPasswordReset), not on a background timer — mirrors
 * the opportunistic sweeps already used elsewhere in this codebase (e.g.
 * src/lib/oauth/tokens.ts's expired-row deletes).
 *
 * @param ms - Age threshold in milliseconds
 */
export async function deleteResetTokensOlderThan(ms: number): Promise<void> {
  const cutoff = nowMs() - ms
  db.prepare('DELETE FROM "PasswordResetToken" WHERE "createdAt" < ?').run(cutoff)
}

/**
 * Complete a password reset in one transaction:
 *   - sets the new password hash and updatedAt
 *   - clears the account lockout (failedLoginAttempts=0, lockedUntil=NULL)
 *   - voids every unused reset token of the user
 *   - deletes every Session row (signs out every browser session)
 *   - deletes every OauthRefreshToken row (revokes every MCP client;
 *     OauthGrant rows are left untouched, so a reconnect skips consent)
 *
 * Deliberately NOT declared `async` (unlike the rest of this data layer) so
 * it can run its statements synchronously inside `transaction()` — the same
 * reasoning documented on src/data/project-invite.ts's
 * `incrementInviteUsedCount`: an async function's throw becomes a rejected
 * promise, not a synchronous throw the transaction can roll back on.
 *
 * @param userId - User UUID
 * @param newPasswordHash - New bcrypt password hash (caller hashes it)
 */
export function completePasswordReset(userId: string, newPasswordHash: string): void {
  transaction(() => {
    const ts = nowMs()
    db.prepare(
      'UPDATE "User" SET "passwordHash" = ?, "failedLoginAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = ? WHERE "id" = ?',
    ).run(newPasswordHash, ts, userId)
    db.prepare(
      'UPDATE "PasswordResetToken" SET "usedAt" = ? WHERE "userId" = ? AND "usedAt" IS NULL',
    ).run(ts, userId)
    db.prepare('DELETE FROM "Session" WHERE "userId" = ?').run(userId)
    db.prepare('DELETE FROM "OauthRefreshToken" WHERE "userId" = ?').run(userId)
  })
}

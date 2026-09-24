// src/data/password-reset.ts
// Data access layer for the PasswordResetToken (forgot-password) entity.
// Raw SQL in the style of src/data/user.ts / src/data/project-invite.ts.
//
// Owns the numeric abuse-limit constants (cooldown, per-user daily cap,
// global daily cap, and the rolling window they share) so both this file's
// own tryCreateResetToken and src/lib/auth/reset-limits.ts's canSendReset
// read the same values. src/lib/auth/reset-limits.ts imports them from here
// rather than the reverse, because it already imports countResetsForUserSince
// / countResetsSince from this file — keeping the dependency one-directional
// avoids a circular import between the two modules (see src/db.ts's
// owner-email-backfill comment for a real TDZ crash this codebase hit from a
// circular import elsewhere).

import type { PasswordResetToken } from '@/data/models'
import { db, genId, insert, mapPasswordResetToken, nowMs, transaction } from '@/db'
import { RESET_TOKEN_TTL_MS } from '@/lib/auth/reset-token'

/** Per-user cooldown: at most one reset row per user inside this window. */
export const RESET_COOLDOWN_MS = 2 * 60_000
/** Per-user daily cap: at most this many reset rows per user inside RESET_DAILY_WINDOW_MS. */
export const RESET_PER_USER_DAILY_MAX = 5
/** Global daily cap: at most this many reset rows across all users inside RESET_DAILY_WINDOW_MS. */
export const RESET_GLOBAL_DAILY_MAX = 80
/** Rolling window shared by the per-user and the global daily caps. */
export const RESET_DAILY_WINDOW_MS = 24 * 60 * 60_000
/** Age past which a reset-token row is no longer needed for redemption or
 * for either rolling abuse-limit window — see deleteResetTokensOlderThan. */
export const RESET_TOKEN_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Logged once per process the first time the global daily cap trips (from
// either canSendReset's own check or tryCreateResetToken's atomic one
// below), so an operator sees the signal without the log filling up on
// every subsequent blocked request.
let globalCapWarned = false

/** Resets the one-time global-cap warning flag. For tests only. */
export function _resetGlobalCapWarningForTests(): void {
  globalCapWarned = false
}

/** Logs the global-cap warning once per process, no matter which caller trips it. */
export function warnGlobalCapOnce(): void {
  if (!globalCapWarned) {
    globalCapWarned = true
    console.warn('[password-reset] Global daily Resend cap reached.')
  }
}

function countResetsForUserSinceSync(userId: string, sinceMs: number): number {
  const row = db
    .prepare(
      'SELECT count(*) AS c FROM "PasswordResetToken" WHERE "userId" = ? AND "createdAt" >= ?',
    )
    .get(userId, sinceMs) as { c: number }
  return Number(row.c)
}

function countResetsSinceSync(sinceMs: number): number {
  const row = db
    .prepare('SELECT count(*) AS c FROM "PasswordResetToken" WHERE "createdAt" >= ?')
    .get(sinceMs) as { c: number }
  return Number(row.c)
}

/**
 * Create a reset-token row for a user, unconditionally (no abuse-limit
 * check). Voids (sets usedAt) every earlier unused row of that user first,
 * so at most one reset link is ever live at a time — opening a new one
 * invalidates any still-unused older link.
 *
 * The caller discards the return value in production (requestPasswordReset
 * uses tryCreateResetToken below instead, which checks the abuse limits
 * atomically); this function stays for test setup and any other caller that
 * needs an unconditional insert.
 *
 * @param userId - User UUID
 * @param tokenHash - SHA-256 hash of the raw token (caller generates/hashes it)
 */
export async function createResetToken(
  userId: string,
  tokenHash: string,
): Promise<void> {
  const ts = nowMs()
  db.prepare(
    'UPDATE "PasswordResetToken" SET "usedAt" = ? WHERE "userId" = ? AND "usedAt" IS NULL',
  ).run(ts, userId)

  insert('PasswordResetToken', {
    id: genId(),
    userId,
    tokenHash,
    expiresAt: ts + RESET_TOKEN_TTL_MS,
    usedAt: null,
    createdAt: ts,
  })
}

/**
 * Atomically check the reset abuse limits (cooldown, per-user daily cap,
 * global daily cap — the same three checks, in the same order, against the
 * same constants as src/lib/auth/reset-limits.ts's canSendReset) and, if all
 * pass, void every earlier unused token for the user and insert the new one.
 *
 * Everything above runs inside ONE synchronous transaction with no `await`
 * between the check and the insert. The previous call site ran
 * `await canSendReset()` and `await createResetToken()` as two separate
 * awaited steps; each `await` yields to the microtask queue, leaving a
 * window where two concurrent requests for the same user can both read
 * "under the limit" before either has inserted its row (TOCTOU). Running the
 * checks and the write as raw synchronous queries inside transaction()
 * closes that window — whichever call reaches this function first finishes
 * its whole check-and-insert before the other gets to run.
 *
 * Does not touch the per-IP limiter — that is checked separately, before
 * this function is ever called (see requestPasswordReset).
 *
 * @param userId - User UUID
 * @param tokenHash - SHA-256 hash of the raw token (caller generates/hashes it)
 * @returns the new row, or null when a limit blocked the request
 */
export function tryCreateResetToken(
  userId: string,
  tokenHash: string,
): PasswordResetToken | null {
  return transaction(() => {
    const now = nowMs()

    const cooldownCount = countResetsForUserSinceSync(userId, now - RESET_COOLDOWN_MS)
    if (cooldownCount > 0) return null

    const dailyUserCount = countResetsForUserSinceSync(userId, now - RESET_DAILY_WINDOW_MS)
    if (dailyUserCount >= RESET_PER_USER_DAILY_MAX) return null

    const globalCount = countResetsSinceSync(now - RESET_DAILY_WINDOW_MS)
    if (globalCount >= RESET_GLOBAL_DAILY_MAX) {
      warnGlobalCapOnce()
      return null
    }

    db.prepare(
      'UPDATE "PasswordResetToken" SET "usedAt" = ? WHERE "userId" = ? AND "usedAt" IS NULL',
    ).run(now, userId)

    const id = genId()
    insert('PasswordResetToken', {
      id,
      userId,
      tokenHash,
      expiresAt: now + RESET_TOKEN_TTL_MS,
      usedAt: null,
      createdAt: now,
    })

    return mapPasswordResetToken(
      db.prepare('SELECT * FROM "PasswordResetToken" WHERE "id" = ?').get(id),
    )
  })
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
  return countResetsForUserSinceSync(userId, sinceMs)
}

/**
 * Count reset-token rows created (by any user) since a given time. Used by
 * the global daily cap (src/lib/auth/reset-limits.ts).
 *
 * @param sinceMs - Unix-ms lower bound (inclusive)
 */
export async function countResetsSince(sinceMs: number): Promise<number> {
  return countResetsSinceSync(sinceMs)
}

/**
 * Lazy cleanup: delete reset-token rows older than the given age (typically
 * RESET_TOKEN_CLEANUP_AGE_MS). Runs at request time (requestPasswordReset),
 * not on a background timer — mirrors the opportunistic sweeps already used
 * elsewhere in this codebase (e.g. src/lib/oauth/tokens.ts's expired-row
 * deletes).
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

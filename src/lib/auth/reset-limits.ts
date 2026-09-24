// src/lib/auth/reset-limits.ts
// Abuse limits for the forgot-password Resend flow. Four layers total, this module
// owns three of them (the fourth, Turnstile, lives in ./turnstile.ts):
//   - per IP:    5 requests / 15 min, in-memory (resets on restart)
//   - per email: 1 / 2 min (cooldown) and 5 / 24 h, counted from the DB
//   - global:    80 / 24 h, counted from the DB
// The DB-backed limits survive a process restart; the IP limit does not —
// see the tactical plan's Assumptions ("the email-based limits live in the
// DB, so a restart cannot reopen the Resend quota").
//
// The per-email/global numeric constants and the global-cap warn-once flag
// live in src/data/password-reset.ts (re-exported below) rather than here,
// because requestPasswordReset's actual abuse check now runs atomically in
// that file's tryCreateResetToken — canSendReset below stays as a read-only
// convenience check (used by its own tests) against the same values.

import { createFixedWindowRateLimiter } from '@/lib/rate-limit'
import {
  RESET_COOLDOWN_MS,
  RESET_DAILY_WINDOW_MS,
  RESET_GLOBAL_DAILY_MAX,
  RESET_PER_USER_DAILY_MAX,
  _resetGlobalCapWarningForTests,
  countResetsForUserSince,
  countResetsSince,
  warnGlobalCapOnce,
} from '@/data/password-reset'

export {
  RESET_COOLDOWN_MS,
  RESET_GLOBAL_DAILY_MAX,
  RESET_PER_USER_DAILY_MAX,
  _resetGlobalCapWarningForTests,
}

export const RESET_IP_LIMIT_MAX = 5
export const RESET_IP_LIMIT_WINDOW_MS = 15 * 60_000

const _ipRateLimiter = createFixedWindowRateLimiter({
  max: RESET_IP_LIMIT_MAX,
  windowMs: RESET_IP_LIMIT_WINDOW_MS,
})

/** Pre-work per-IP flood guard. Reveals nothing about whether the email is known. */
export function checkResetIpRateLimit(ip: string): boolean {
  return _ipRateLimiter.check(ip)
}

/** Clears the in-process IP rate-limit map. For tests only. */
export function _resetIpRateLimitForTests(): void {
  _ipRateLimiter.reset()
}

/**
 * Decide whether a reset email may be sent for this user, checking the
 * per-email cooldown, the per-email daily cap, and the global daily cap (in
 * that order). Does not touch the IP limiter — that is checked separately,
 * before this function is ever called (see requestPasswordReset).
 *
 * Read-only: unlike src/data/password-reset.ts's tryCreateResetToken, this
 * performs its checks as separate awaited queries, so it is NOT safe to pair
 * with a later, separately-awaited insert (that gap is exactly the TOCTOU
 * race tryCreateResetToken closes). Kept for its own test coverage.
 *
 * @param userId - User UUID
 */
export async function canSendReset(userId: string): Promise<boolean> {
  const now = Date.now()

  const cooldownCount = await countResetsForUserSince(userId, now - RESET_COOLDOWN_MS)
  if (cooldownCount > 0) return false

  const dailyUserCount = await countResetsForUserSince(userId, now - RESET_DAILY_WINDOW_MS)
  if (dailyUserCount >= RESET_PER_USER_DAILY_MAX) return false

  const globalCount = await countResetsSince(now - RESET_DAILY_WINDOW_MS)
  if (globalCount >= RESET_GLOBAL_DAILY_MAX) {
    warnGlobalCapOnce()
    return false
  }

  return true
}

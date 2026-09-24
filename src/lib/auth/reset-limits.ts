// src/lib/auth/reset-limits.ts
// Abuse limits for the forgot-password Resend flow. Four layers total, this module
// owns three of them (the fourth, Turnstile, lives in ./turnstile.ts):
//   - per IP:    5 requests / 15 min, in-memory (resets on restart)
//   - per email: 1 / 2 min (cooldown) and 5 / 24 h, counted from the DB
//   - global:    80 / 24 h, counted from the DB
// The DB-backed limits survive a process restart; the IP limit does not —
// see the tactical plan's Assumptions ("the email-based limits live in the
// DB, so a restart cannot reopen the Resend quota").

import { createFixedWindowRateLimiter } from '@/lib/rate-limit'
import { countResetsForUserSince, countResetsSince } from '@/data/password-reset'

export const RESET_IP_LIMIT_MAX = 5
export const RESET_IP_LIMIT_WINDOW_MS = 15 * 60_000
export const RESET_COOLDOWN_MS = 2 * 60_000
export const RESET_PER_USER_DAILY_MAX = 5
export const RESET_GLOBAL_DAILY_MAX = 80
const DAY_MS = 24 * 60 * 60_000

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

// Logged once per process the first time the global daily cap trips, so an
// operator sees the signal without the log filling up on every subsequent
// blocked request.
let globalCapWarned = false

/** Resets the one-time global-cap warning flag. For tests only. */
export function _resetGlobalCapWarningForTests(): void {
  globalCapWarned = false
}

/**
 * Decide whether a reset email may be sent for this user, checking the
 * per-email cooldown, the per-email daily cap, and the global daily cap (in
 * that order). Does not touch the IP limiter — that is checked separately,
 * before this function is ever called (see requestPasswordReset).
 *
 * @param userId - User UUID
 */
export async function canSendReset(userId: string): Promise<boolean> {
  const now = Date.now()

  const cooldownCount = await countResetsForUserSince(userId, now - RESET_COOLDOWN_MS)
  if (cooldownCount > 0) return false

  const dailyUserCount = await countResetsForUserSince(userId, now - DAY_MS)
  if (dailyUserCount >= RESET_PER_USER_DAILY_MAX) return false

  const globalCount = await countResetsSince(now - DAY_MS)
  if (globalCount >= RESET_GLOBAL_DAILY_MAX) {
    if (!globalCapWarned) {
      globalCapWarned = true
      console.warn('[password-reset] Global daily Resend cap reached.')
    }
    return false
  }

  return true
}

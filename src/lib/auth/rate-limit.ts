// src/lib/auth/rate-limit.ts
// Account lockout and rate limiting for login attempts
//
// Lockout fields (failedLoginAttempts, lockedUntil) live on the User model.
// Anti-enumeration: operations on non-existent emails are silently discarded.

import { findUserByEmail } from '@/data/user'
import { nowMs, toDbDate, update } from '@/db'

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Check whether an account is currently locked out.
 * Returns locked=false for unknown emails (anti-enumeration).
 *
 * @param email - Email address to check
 * @returns { locked, unlocksAt? }
 */
export async function checkLockout(
  email: string,
): Promise<{ locked: boolean; unlocksAt?: Date }> {
  const user = await findUserByEmail(email)

  if (!user) return { locked: false } // Unknown user: no lockout (anti-enumeration)

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { locked: true, unlocksAt: user.lockedUntil }
  }

  return { locked: false }
}

/**
 * Record a failed login attempt.
 * Increments counter and sets lockedUntil if threshold is reached.
 * Silently discards attempts for non-existent emails (anti-enumeration).
 *
 * @param email - Email address that failed login
 */
export async function recordFailedLogin(email: string): Promise<void> {
  const user = await findUserByEmail(email)

  if (!user) return // Unknown user: silently discard (anti-enumeration)

  // If previous lockout has expired, reset counter to 1
  const currentAttempts =
    user.lockedUntil && user.lockedUntil <= new Date()
      ? 1
      : user.failedLoginAttempts + 1

  const updates: Record<string, unknown> = {
    failedLoginAttempts: currentAttempts,
    updatedAt: nowMs(),
  }

  if (currentAttempts >= MAX_ATTEMPTS) {
    updates.lockedUntil = toDbDate(new Date(Date.now() + LOCKOUT_DURATION_MS))
  }

  update('User', user.id, updates)
}

/**
 * Clear lockout fields after a successful login.
 *
 * @param userId - User UUID (not email, as we have it after successful auth)
 */
export async function clearLockout(userId: string): Promise<void> {
  update('User', userId, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: nowMs(),
  })
}

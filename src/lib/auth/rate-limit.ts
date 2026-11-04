// src/lib/auth/rate-limit.ts
// Account lockout and rate limiting for login attempts
//
// Lockout fields (failedLoginAttempts, lockedUntil) live on the User model.
// Anti-enumeration: operations on non-existent emails are silently discarded.

import { findUserByEmail } from '@/data/user'
import { db, nowMs, toDbDate, update } from '@/db'

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
 *
 * The increment is ONE atomic UPDATE (not read-modify-write across an await):
 * parallel failures can no longer overwrite each other's counter. A counter
 * whose lockout already expired restarts at 1. Reaching MAX_ATTEMPTS sets
 * lockedUntil in the same statement. Silently discards attempts for
 * non-existent emails (anti-enumeration).
 *
 * @param email - Email address that failed login
 */
export async function recordFailedLogin(email: string): Promise<void> {
  const now = nowMs()
  const lockUntil = toDbDate(new Date(now + LOCKOUT_DURATION_MS))
  const next = `(CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= ? THEN 1 ELSE "failedLoginAttempts" + 1 END)`
  db.prepare(
      `UPDATE "User" SET
         "failedLoginAttempts" = ${next},
         "lockedUntil" = CASE WHEN ${next} >= ? THEN ?
                              WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= ? THEN NULL
                              ELSE "lockedUntil" END,
         "updatedAt" = ?
       WHERE lower("email") = lower(?)
       RETURNING "failedLoginAttempts" AS attempts`,
  ).get(now, now, MAX_ATTEMPTS, lockUntil, now, now, email)
}

const emailChains = new Map<string, Promise<unknown>>()

/**
 * Run `fn` serialized per email (single-process server). The lock state must
 * be re-read after the previous attempt's bcrypt+record finished; otherwise N
 * parallel guesses all pass checkLockout before any failure is recorded.
 */
export function withEmailLock<T>(
  email: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = email.trim().toLowerCase()
  const prev = emailChains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  emailChains.set(key, tail)
  void tail.then(() => {
    if (emailChains.get(key) === tail) emailChains.delete(key)
  })
  return run
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

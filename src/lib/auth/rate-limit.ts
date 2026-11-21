// src/lib/auth/rate-limit.ts
// Per-email login failure counter (Turnstile challenge trigger) and the
// per-email serialization lock for login attempts.
//
// There is no account lockout: a lock lets anyone deny a victim their own
// login. After LOGIN_CHALLENGE_THRESHOLD failures inside the window, login
// asks for a Turnstile pass instead. The counter lives in memory, is keyed by
// the lower-cased email, and counts EVERY email (registered or not), so the
// challenge never reveals whether an account exists. It is bounded by the
// fixed-window limiter (key cap, eviction, overflow shards).

import { createFixedWindowRateLimiter } from '@/lib/rate-limit'

export const LOGIN_CHALLENGE_THRESHOLD = 5
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

const failureCounter = createFixedWindowRateLimiter({
  max: LOGIN_CHALLENGE_THRESHOLD,
  windowMs: LOGIN_FAILURE_WINDOW_MS,
})

function failureKey(email: string): string {
  return email.trim().toLowerCase()
}

/** True once `email` has failed LOGIN_CHALLENGE_THRESHOLD logins in the window. */
export function isLoginChallengeRequired(email: string): boolean {
  return failureCounter.peek(failureKey(email)) >= LOGIN_CHALLENGE_THRESHOLD
}

/** Count one failed login for `email`, whether or not an account exists. */
export function recordLoginFailure(email: string): void {
  failureCounter.check(failureKey(email))
}

/** Forget the failures for `email` after a successful login. */
export function clearLoginFailures(email: string): void {
  failureCounter.clear(failureKey(email))
}

/** Empty the counter. For tests only. */
export function _resetLoginFailuresForTests(): void {
  failureCounter.reset()
}

const emailChains = new Map<string, Promise<unknown>>()

/**
 * Run `fn` serialized per email (single-process server). The lock state must
 * be re-read after the previous attempt's bcrypt+record finished; otherwise N
 * parallel guesses all pass the challenge check before any failure is recorded.
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

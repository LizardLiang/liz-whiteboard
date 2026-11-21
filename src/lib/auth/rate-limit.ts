// src/lib/auth/rate-limit.ts
// Per-email login failure counter (Turnstile challenge trigger) and the
// per-email serialization lock for login attempts.
//
// There is no account lockout: a lock lets anyone deny a victim their own
// login. After LOGIN_CHALLENGE_THRESHOLD failures inside the window, login
// asks for a Turnstile pass instead. The counter lives in memory, is keyed by
// the lower-cased email, and counts EVERY email (registered or not), so the
// challenge never reveals whether an account exists.
//
// It is its own structure, not the IP fixed-window limiter: the keys are
// attacker-chosen emails, so the map must never evict a live entry (that would
// let an attacker flood new emails to erase a victim's count). It holds at most
// LOGIN_FAILURE_MAX_KEYS entries and deletes only expired ones. When the map
// is full and an email is not tracked, recording is a no-op and the challenge
// is required (fail closed).

export const LOGIN_CHALLENGE_THRESHOLD = 5
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const LOGIN_FAILURE_MAX_KEYS = 10_000

interface FailureEntry {
  count: number
  windowStart: number
}

const failures = new Map<string, FailureEntry>()

/** Cap-time sweeps are throttled so a full map cannot force a scan per call. */
const SWEEP_MIN_INTERVAL_MS = 1000
let lastSweep = 0

function failureKey(email: string): string {
  return email.trim().toLowerCase()
}

function isExpired(entry: FailureEntry, now: number): boolean {
  return now - entry.windowStart >= LOGIN_FAILURE_WINDOW_MS
}

function sweepExpired(now: number): void {
  lastSweep = now
  for (const [key, entry] of failures) {
    if (isExpired(entry, now)) failures.delete(key)
  }
}

/**
 * True once `email` has failed LOGIN_CHALLENGE_THRESHOLD logins in the window.
 * Also true for an untracked email while the map is full.
 */
export function isLoginChallengeRequired(email: string): boolean {
  const key = failureKey(email)
  const now = Date.now()
  const entry = failures.get(key)
  if (entry && !isExpired(entry, now)) {
    return entry.count >= LOGIN_CHALLENGE_THRESHOLD
  }
  if (failures.size < LOGIN_FAILURE_MAX_KEYS) return false
  if (now - lastSweep >= SWEEP_MIN_INTERVAL_MS) sweepExpired(now)
  return failures.size >= LOGIN_FAILURE_MAX_KEYS
}

/** Count one failed login for `email`, whether or not an account exists. */
export function recordLoginFailure(email: string): void {
  const key = failureKey(email)
  const now = Date.now()
  const entry = failures.get(key)
  if (entry && !isExpired(entry, now)) {
    entry.count += 1
    return
  }
  if (failures.size >= LOGIN_FAILURE_MAX_KEYS) {
    if (now - lastSweep >= SWEEP_MIN_INTERVAL_MS) sweepExpired(now)
    else if (entry) failures.delete(key)
    if (failures.size >= LOGIN_FAILURE_MAX_KEYS) return
  }
  failures.set(key, { count: 1, windowStart: now })
}

/** Forget the failures for `email` after a successful login. */
export function clearLoginFailures(email: string): void {
  failures.delete(failureKey(email))
}

/** Empty the counter. For tests only. */
export function _resetLoginFailuresForTests(): void {
  failures.clear()
  lastSweep = 0
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

// src/lib/auth/auth-limits.ts
// Per-IP fixed-window limiters for login and register (in-process, reset on
// restart). Account lockout alone cannot stop one IP from spraying many
// accounts; these cap how many attempts a single IP gets per window.
//
// Login: 30 attempts / 15 min per IP. A single IP hammering ONE account is
// stopped sooner by the account lockout (5 failures); this limit catches
// spraying across accounts and keeps bcrypt CPU cost bounded.
// Register: 10 attempts / hour per IP.

import { createFixedWindowRateLimiter } from '@/lib/rate-limit'

export const LOGIN_IP_LIMIT_MAX = 30
export const LOGIN_IP_LIMIT_WINDOW_MS = 15 * 60_000
export const REGISTER_IP_LIMIT_MAX = 10
export const REGISTER_IP_LIMIT_WINDOW_MS = 60 * 60_000

const loginLimiter = createFixedWindowRateLimiter({
  max: LOGIN_IP_LIMIT_MAX,
  windowMs: LOGIN_IP_LIMIT_WINDOW_MS,
})
const registerLimiter = createFixedWindowRateLimiter({
  max: REGISTER_IP_LIMIT_MAX,
  windowMs: REGISTER_IP_LIMIT_WINDOW_MS,
})

/** True when `ip` may attempt a login. Counts the attempt. */
export function checkLoginIpRateLimit(ip: string): boolean {
  return loginLimiter.check(ip)
}

/** True when `ip` may attempt a registration. Counts the attempt. */
export function checkRegisterIpRateLimit(ip: string): boolean {
  return registerLimiter.check(ip)
}

/** Clears both limiters. For tests only. */
export function _resetAuthLimitsForTests(): void {
  loginLimiter.reset()
  registerLimiter.reset()
}

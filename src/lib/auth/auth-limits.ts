// src/lib/auth/auth-limits.ts
// Per-IP fixed-window limiters for login and register (in-process, reset on
// restart). The per-email Turnstile challenge cannot stop one IP from spraying
// many accounts; these cap how many attempts a single IP gets per window.
//
// Login: 30 attempts / 15 min per IP. A single IP hammering ONE account is
// stopped sooner by the Turnstile challenge: after 5 failures per email,
// login requires a Turnstile pass. This limit catches spraying across
// accounts and keeps bcrypt CPU cost bounded.
// Register: 10 attempts / hour per IP.
// Token (/token): 120 requests / minute per IP. A legitimate OAuth client calls
// /token once per login (code exchange) and once per access-token lifetime
// (refresh; default OAUTH_ACCESS_TOKEN_TTL = 3600 s), so even a few hundred
// clients behind one NAT stay far below 2 req/s. The cap exists to stop an
// anonymous caller from driving the server's CPU and DB through /token.

import { createFixedWindowRateLimiter } from '@/lib/rate-limit'

export const LOGIN_IP_LIMIT_MAX = 30
export const LOGIN_IP_LIMIT_WINDOW_MS = 15 * 60_000
export const REGISTER_IP_LIMIT_MAX = 10
export const REGISTER_IP_LIMIT_WINDOW_MS = 60 * 60_000

export const TOKEN_IP_LIMIT_MAX = 120
export const TOKEN_IP_LIMIT_WINDOW_MS = 60_000

const loginLimiter = createFixedWindowRateLimiter({
  max: LOGIN_IP_LIMIT_MAX,
  windowMs: LOGIN_IP_LIMIT_WINDOW_MS,
})
const registerLimiter = createFixedWindowRateLimiter({
  max: REGISTER_IP_LIMIT_MAX,
  windowMs: REGISTER_IP_LIMIT_WINDOW_MS,
})

const tokenLimiter = createFixedWindowRateLimiter({
  max: TOKEN_IP_LIMIT_MAX,
  windowMs: TOKEN_IP_LIMIT_WINDOW_MS,
})

/** True when `ip` may call /token. Counts the request. */
export function checkTokenIpRateLimit(ip: string): boolean {
  return tokenLimiter.check(ip)
}

/** True when `ip` may attempt a login. Counts the attempt. */
export function checkLoginIpRateLimit(ip: string): boolean {
  return loginLimiter.check(ip)
}

/** True when `ip` may attempt a registration. Counts the attempt. */
export function checkRegisterIpRateLimit(ip: string): boolean {
  return registerLimiter.check(ip)
}

/** Clears all limiters. For tests only. */
export function _resetAuthLimitsForTests(): void {
  loginLimiter.reset()
  registerLimiter.reset()
  tokenLimiter.reset()
}

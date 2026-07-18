// src/lib/rate-limit.ts
// Shared per-IP fixed-window rate limiter + trusted-proxy client-IP
// extraction. Used by src/routes/oauth/register.ts and
// src/routes/api/collab-token.ts (previously duplicated independently in
// each file — W5 fix).
//
// TRUST BOUNDARY (W2 fix): this app is deployed behind a single reverse
// proxy hop (see the Docker Compose / prod topology — a proxy terminates
// TLS in front of the app; the app process is never reached directly from
// the public internet). A well-behaved single-hop proxy APPENDS the real
// connecting peer's IP as the LAST entry of X-Forwarded-For (e.g. nginx's
// `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` appends to,
// rather than replaces, whatever XFF the client sent) — an attacker can
// prepend arbitrary spoofed values, but the last hop is always the value
// the trusted proxy itself observed and wrote.
//
// The previous implementation trusted the FIRST (left-most) XFF value, which
// is exactly the attacker-controlled part of the header — any caller could
// set `X-Forwarded-For: <random-value>` on every request and get a fresh
// rate-limit bucket each time, defeating the limiter entirely.
//
// If the deployment topology changes (additional proxy hops, a CDN in
// front, etc.), this single-hop assumption must be revisited — e.g. by
// trusting the Nth-from-last hop, or switching to a platform-provided
// "real IP" header that the edge guarantees clients cannot set.
export function extractClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean)
    if (hops.length > 0) {
      // Last hop = appended by our single trusted proxy; not spoofable by
      // the client without also controlling the proxy.
      return hops[hops.length - 1]
    }
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

interface RateLimitEntry {
  count: number
  windowStart: number
}

export interface RateLimiter {
  /** Returns true if `ip` is within the configured limit, false if it exceeds it. */
  check: (ip: string) => boolean
  /** Clears all tracked windows. For tests only. */
  reset: () => void
}

/**
 * Create an in-process fixed-window rate limiter (resets on restart).
 * Each call to check() with the same `ip` within `windowMs` of the first
 * call increments a counter; once the counter exceeds `max`, check()
 * returns false until the window rolls over.
 */
export function createFixedWindowRateLimiter(opts: {
  max: number
  windowMs: number
}): RateLimiter {
  const map = new Map<string, RateLimitEntry>()

  return {
    check(ip: string): boolean {
      const now = Date.now()
      const entry = map.get(ip)
      if (!entry || now - entry.windowStart >= opts.windowMs) {
        map.set(ip, { count: 1, windowStart: now })
        return true
      }
      entry.count += 1
      return entry.count <= opts.max
    },
    reset(): void {
      map.clear()
    },
  }
}

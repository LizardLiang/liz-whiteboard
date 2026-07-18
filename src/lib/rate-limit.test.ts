// @vitest-environment node
// src/lib/rate-limit.test.ts
// Unit tests for the shared fixed-window rate limiter and trusted-proxy IP
// extraction (W2 + W5 fixes) used by src/routes/oauth/register.ts and
// src/routes/api/collab-token.ts.

import { describe, expect, it } from 'vitest'
import { createFixedWindowRateLimiter, extractClientIp } from './rate-limit'

describe('createFixedWindowRateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createFixedWindowRateLimiter({ max: 3, windowMs: 60_000 })
    expect(limiter.check('1.2.3.4')).toBe(true)
    expect(limiter.check('1.2.3.4')).toBe(true)
    expect(limiter.check('1.2.3.4')).toBe(true)
  })

  it('rejects once the limit is exceeded within the window', () => {
    const limiter = createFixedWindowRateLimiter({ max: 3, windowMs: 60_000 })
    limiter.check('5.6.7.8')
    limiter.check('5.6.7.8')
    limiter.check('5.6.7.8')
    expect(limiter.check('5.6.7.8')).toBe(false)
  })

  it('tracks separate IPs independently', () => {
    const limiter = createFixedWindowRateLimiter({ max: 1, windowMs: 60_000 })
    expect(limiter.check('9.9.9.9')).toBe(true)
    expect(limiter.check('9.9.9.9')).toBe(false)
    expect(limiter.check('1.1.1.1')).toBe(true)
  })

  it('reset() clears all tracked windows', () => {
    const limiter = createFixedWindowRateLimiter({ max: 1, windowMs: 60_000 })
    limiter.check('2.2.2.2')
    expect(limiter.check('2.2.2.2')).toBe(false)
    limiter.reset()
    expect(limiter.check('2.2.2.2')).toBe(true)
  })
})

describe('extractClientIp: trusted-proxy last-hop extraction (W2 fix)', () => {
  it('uses the LAST X-Forwarded-For hop, not the first (spoof resistance)', () => {
    const request = new Request('http://localhost/', {
      headers: {
        // Attacker-controlled first hop, real-proxy-appended last hop.
        'x-forwarded-for': 'attacker-spoofed-value, 203.0.113.9',
      },
    })
    expect(extractClientIp(request)).toBe('203.0.113.9')
  })

  it('an attacker cannot get a fresh rate-limit bucket by rotating the first XFF hop', () => {
    const request1 = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': 'fake-1, 203.0.113.9' },
    })
    const request2 = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': 'fake-2, 203.0.113.9' },
    })
    expect(extractClientIp(request1)).toBe(extractClientIp(request2))
  })

  it('handles a single-hop X-Forwarded-For value', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    })
    expect(extractClientIp(request)).toBe('203.0.113.9')
  })

  it('trims whitespace around hops', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': ' fake-1 ,  203.0.113.9  ' },
    })
    expect(extractClientIp(request)).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip when X-Forwarded-For is absent', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-real-ip': '198.51.100.7' },
    })
    expect(extractClientIp(request)).toBe('198.51.100.7')
  })

  it('falls back to "unknown" when neither header is present', () => {
    const request = new Request('http://localhost/')
    expect(extractClientIp(request)).toBe('unknown')
  })
})

// @vitest-environment node
// src/lib/rate-limit.test.ts
// Unit tests for the shared fixed-window rate limiter and trusted-proxy IP
// extraction (W2 + W5 fixes) used by src/routes/oauth/register.ts and
// src/routes/api/collab-token.ts.

import { afterEach, describe, expect, it } from 'vitest'
import {
  PEER_IP_HEADER,
  createFixedWindowRateLimiter,
  extractClientIp,
} from './rate-limit'

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

describe('extractClientIp: peer address + trusted proxies (audit L2)', () => {
  const req = (headers: Record<string, string>) =>
    new Request('http://localhost/', { headers })
  const ORIGINAL = process.env.TRUSTED_PROXIES
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TRUSTED_PROXIES
    else process.env.TRUSTED_PROXIES = ORIGINAL
  })

  it('uses the peer address when there is no forwarding header', () => {
    expect(extractClientIp(req({ [PEER_IP_HEADER]: '192.0.2.5' }))).toBe(
      '192.0.2.5',
    )
  })

  it('ignores X-Forwarded-For from an untrusted (public) peer', () => {
    expect(
      extractClientIp(
        req({ [PEER_IP_HEADER]: '192.0.2.5', 'x-forwarded-for': '1.2.3.4' }),
      ),
    ).toBe('192.0.2.5')
  })

  it('ignores x-real-ip from an untrusted peer', () => {
    expect(
      extractClientIp(
        req({ [PEER_IP_HEADER]: '192.0.2.5', 'x-real-ip': '1.2.3.4' }),
      ),
    ).toBe('192.0.2.5')
  })

  it('trusts the rightmost non-proxy XFF hop behind a default-trusted proxy', () => {
    expect(
      extractClientIp(
        req({
          [PEER_IP_HEADER]: '172.18.0.4',
          'x-forwarded-for': 'spoofed, 1.1.1.1, 203.0.113.9',
        }),
      ),
    ).toBe('203.0.113.9')
  })

  it('skips trusted proxies in the XFF chain', () => {
    expect(
      extractClientIp(
        req({
          [PEER_IP_HEADER]: '10.0.0.2',
          'x-forwarded-for': '203.0.113.9, 192.168.1.1',
        }),
      ),
    ).toBe('203.0.113.9')
  })

  it('rotating the leftmost XFF hop does not change the bucket', () => {
    const a = req({
      [PEER_IP_HEADER]: '127.0.0.1',
      'x-forwarded-for': '9.9.9.9, 203.0.113.9',
    })
    const b = req({
      [PEER_IP_HEADER]: '127.0.0.1',
      'x-forwarded-for': '8.8.8.8, 203.0.113.9',
    })
    expect(extractClientIp(a)).toBe(extractClientIp(b))
  })

  it('ignores x-real-ip under the default trusted list, even from a trusted peer', () => {
    delete process.env.TRUSTED_PROXIES
    expect(
      extractClientIp(
        req({ [PEER_IP_HEADER]: '127.0.0.1', 'x-real-ip': '198.51.100.7' }),
      ),
    ).toBe('127.0.0.1')
  })

  it('honours x-real-ip from a trusted peer when TRUSTED_PROXIES is explicit', () => {
    process.env.TRUSTED_PROXIES = '127.0.0.1'
    expect(
      extractClientIp(
        req({ [PEER_IP_HEADER]: '127.0.0.1', 'x-real-ip': '198.51.100.7' }),
      ),
    ).toBe('198.51.100.7')
  })

  it('LAN spoof: client-supplied first hop loses to the proxy-appended LAN IP', () => {
    delete process.env.TRUSTED_PROXIES
    // Caddy (172.18.0.2) appended the LAN client 192.168.1.50; the client
    // forged a leading private hop.
    expect(
      extractClientIp(
        req({
          [PEER_IP_HEADER]: '172.18.0.2',
          'x-forwarded-for': '10.9.9.9, 192.168.1.50',
        }),
      ),
    ).toBe('192.168.1.50')
  })

  it('all-trusted XFF chain returns the rightmost hop, never the first', () => {
    delete process.env.TRUSTED_PROXIES
    expect(
      extractClientIp(
        req({
          [PEER_IP_HEADER]: '172.18.0.2',
          'x-forwarded-for': '10.1.1.1, 10.2.2.2, 192.168.0.9',
        }),
      ),
    ).toBe('192.168.0.9')
  })

  it('normalises an IPv4-mapped IPv6 peer', () => {
    expect(
      extractClientIp(
        req({
          [PEER_IP_HEADER]: '::ffff:172.17.0.2',
          'x-forwarded-for': '203.0.113.9',
        }),
      ),
    ).toBe('203.0.113.9')
  })

  it('TRUSTED_PROXIES replaces the default list', () => {
    process.env.TRUSTED_PROXIES = '203.0.113.0/24'
    // default-trusted 10.x is now untrusted
    expect(
      extractClientIp(
        req({ [PEER_IP_HEADER]: '10.0.0.2', 'x-forwarded-for': '1.2.3.4' }),
      ),
    ).toBe('10.0.0.2')
    expect(
      extractClientIp(
        req({ [PEER_IP_HEADER]: '203.0.113.50', 'x-forwarded-for': '1.2.3.4' }),
      ),
    ).toBe('1.2.3.4')
  })

  it('falls back to "unknown" when no peer is stamped', () => {
    expect(extractClientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe(
      'unknown',
    )
  })
})

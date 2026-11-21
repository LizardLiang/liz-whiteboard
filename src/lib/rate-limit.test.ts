// @vitest-environment node
// src/lib/rate-limit.test.ts
// Unit tests for the shared fixed-window rate limiter and trusted-proxy IP
// extraction (W2 + W5 fixes) used by src/routes/oauth/register.ts and
// src/routes/api/collab-token.ts.

import { createServer } from 'node:http'
import { NodeRequest } from 'srvx/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PEER_IP_HEADER,
  createFixedWindowRateLimiter,
  extractClientIp,
  stampPeerIp,
} from './rate-limit'
import type { IncomingMessage } from 'node:http'

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

  describe('bounded memory (audit F4)', () => {
    afterEach(() => vi.useRealTimers())

    it('never holds more than maxKeys keys', () => {
      const limiter = createFixedWindowRateLimiter({
        max: 5,
        windowMs: 60_000,
        maxKeys: 100,
      })
      for (let i = 0; i < 1000; i++) limiter.check(`ip-${i}`)
      expect(limiter.size()).toBeLessThanOrEqual(100)
    })

    it('a blocked key stays blocked after 10,000+ new keys arrive', () => {
      const limiter = createFixedWindowRateLimiter({
        max: 2,
        windowMs: 60_000,
      })
      limiter.check('victim')
      limiter.check('victim')
      expect(limiter.check('victim')).toBe(false)
      for (let i = 0; i < 10_500; i++) limiter.check(`flood-${i}`)
      expect(limiter.check('victim')).toBe(false)
    })

    it('new keys beyond the cap share one overflow bucket', () => {
      const limiter = createFixedWindowRateLimiter({
        max: 2,
        windowMs: 60_000,
        maxKeys: 3,
      })
      limiter.check('a')
      limiter.check('b')
      limiter.check('c')
      expect(limiter.check('d')).toBe(true)
      expect(limiter.check('e')).toBe(true)
      expect(limiter.check('f')).toBe(false)
      expect(limiter.size()).toBe(3)
    })

    it('deletes expired windows to make room before overflowing', () => {
      vi.useFakeTimers()
      const limiter = createFixedWindowRateLimiter({
        max: 1,
        windowMs: 1000,
        maxKeys: 3,
      })
      limiter.check('old1')
      limiter.check('old2')
      vi.advanceTimersByTime(1500)
      limiter.check('live')
      limiter.check('new')
      expect(limiter.size()).toBe(2)
      expect(limiter.check('live')).toBe(false)
      expect(limiter.check('new2')).toBe(true)
      expect(limiter.size()).toBe(3)
      // Map full of live windows: the next new keys share the overflow bucket.
      expect(limiter.check('new3')).toBe(true)
      expect(limiter.check('new4')).toBe(false)
    })

    it('two addresses in the same IPv6 /64 share one window', () => {
      const limiter = createFixedWindowRateLimiter({ max: 1, windowMs: 60_000 })
      expect(limiter.check('2001:db8:1:2::1')).toBe(true)
      expect(limiter.check('2001:db8:1:2:ffff::9')).toBe(false)
      expect(limiter.check('2001:db8:1:3::1')).toBe(true)
      expect(limiter.size()).toBe(2)
    })

    it('keys IPv4 and non-IP keys unchanged', () => {
      const limiter = createFixedWindowRateLimiter({ max: 1, windowMs: 60_000 })
      expect(limiter.check('1.2.3.4')).toBe(true)
      expect(limiter.check('1.2.3.5')).toBe(true)
      expect(limiter.check('unknown')).toBe(true)
      expect(limiter.check('unknown')).toBe(false)
    })
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

describe('stampPeerIp', () => {
  // Sends a real request and returns the extractClientIp() verdict on the web
  // Request srvx builds from it, the way the dev server's Nitro layer does.
  async function seenIp(stamp: (req: IncomingMessage) => void) {
    let seen = ''
    const server = createServer((req, res) => {
      stamp(req)
      const webReq = new NodeRequest({ req, res })
      // Entries come from rawHeaders, as when the Request crosses to a worker.
      seen = extractClientIp(
        new Request(webReq.url, { headers: [...webReq.headers] }),
      )
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as { port: number }
    await fetch(`http://127.0.0.1:${port}/`, {
      headers: { [PEER_IP_HEADER]: '9.9.9.9' },
    })
    server.close()
    return seen
  }

  it('a stamp on req.headers alone does not reach the web Request', async () => {
    const ip = await seenIp((req) => {
      req.headers[PEER_IP_HEADER] = req.socket.remoteAddress ?? ''
    })
    expect(ip).toBe('9.9.9.9')
  })

  it('stampPeerIp gives the web Request the real peer, replacing a forged value', async () => {
    expect(await seenIp((req) => stampPeerIp(req))).toBe('127.0.0.1')
  })
})

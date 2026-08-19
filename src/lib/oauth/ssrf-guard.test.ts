// @vitest-environment node
// src/lib/oauth/ssrf-guard.test.ts
// Unit tests for the CIMD SSRF guard (mcp-oauth-open-cimd). DNS is mocked;
// no real lookups. Covers every denied range, the IPv4-in-IPv6 forms that
// make a naive v6 check useless, the split-horizon case, and the
// CIMD_TEST_ORIGINS exemption's production refusal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: (...args: Array<unknown>) => lookupMock(...args),
}))

const { blockedAddressReason, checkPublicHost } = await import('./ssrf-guard')

function resolvesTo(...addresses: Array<string>) {
  lookupMock.mockResolvedValue(addresses.map((address) => ({ address })))
}

beforeEach(() => {
  lookupMock.mockReset()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('blockedAddressReason: IPv4 ranges', () => {
  const blocked: Array<[string, string]> = [
    ['0.0.0.0', 'this-network'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'link-local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
  ]

  it.each(blocked)('blocks %s (%s)', (address, label) => {
    expect(blockedAddressReason(address)).toBe(label)
  })

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '11.0.0.1',
    '100.63.255.255',
  ]
  it.each(allowed)('allows public address %s', (address) => {
    expect(blockedAddressReason(address)).toBeNull()
  })
})

describe('blockedAddressReason: IPv6 ranges', () => {
  const blocked: Array<[string, string]> = [
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
  ]

  it.each(blocked)('blocks %s (%s)', (address, label) => {
    expect(blockedAddressReason(address)).toBe(label)
  })

  it('allows a public IPv6 address', () => {
    expect(blockedAddressReason('2606:4700:4700::1111')).toBeNull()
  })

  // A v6 check that forgets these lets 127.0.0.1 through in a v6 costume.
  it('blocks IPv4-mapped loopback (::ffff:127.0.0.1)', () => {
    expect(blockedAddressReason('::ffff:127.0.0.1')).toBe(
      'IPv4-in-IPv6 loopback',
    )
  })

  it('blocks IPv4-mapped private (::ffff:10.0.0.1)', () => {
    expect(blockedAddressReason('::ffff:10.0.0.1')).toBe('IPv4-in-IPv6 private')
  })

  it('blocks IPv4-mapped link-local metadata address', () => {
    expect(blockedAddressReason('::ffff:169.254.169.254')).toBe(
      'IPv4-in-IPv6 link-local',
    )
  })

  it('blocks NAT64-embedded loopback (64:ff9b::127.0.0.1)', () => {
    expect(blockedAddressReason('64:ff9b::127.0.0.1')).toBe(
      'IPv4-in-IPv6 loopback',
    )
  })

  it('allows IPv4-mapped public address', () => {
    expect(blockedAddressReason('::ffff:8.8.8.8')).toBeNull()
  })

  it('ignores a zone id when classifying', () => {
    expect(blockedAddressReason('fe80::1%eth0')).toBe('link-local')
  })
})

describe('checkPublicHost: hostname-shape refusals (no DNS)', () => {
  it('refuses an IPv4 literal host', async () => {
    const result = await checkPublicHost('127.0.0.1', 'https://127.0.0.1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('IP literal')
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('refuses an IPv6 literal host', async () => {
    const result = await checkPublicHost('::1', 'https://[::1]')
    expect(result.allowed).toBe(false)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it.each(['.local', '.internal', '.localhost', '.home.arpa'])(
    'refuses a host ending in %s',
    async (suffix) => {
      const host = `router${suffix}`
      const result = await checkPublicHost(host, `https://${host}`)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain(suffix)
      expect(lookupMock).not.toHaveBeenCalled()
    },
  )

  it('refuses a bare hostname with no dot', async () => {
    const result = await checkPublicHost('redis', 'https://redis')
    expect(result.allowed).toBe(false)
    expect(lookupMock).not.toHaveBeenCalled()
  })
})

describe('checkPublicHost: DNS results', () => {
  it('allows a host resolving only to public addresses', async () => {
    resolvesTo('93.184.216.34', '2606:2800:220:1::1')
    const result = await checkPublicHost('example.com', 'https://example.com')
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('refuses a host resolving to a private address', async () => {
    resolvesTo('192.168.1.10')
    const result = await checkPublicHost('evil.example', 'https://evil.example')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('private')
  })

  // Split horizon: a public record must not launder a private sibling.
  it('refuses when ANY resolved address is private', async () => {
    resolvesTo('93.184.216.34', '10.0.0.5')
    const result = await checkPublicHost('evil.example', 'https://evil.example')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('private')
  })

  it('refuses when DNS lookup throws', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    const result = await checkPublicHost('nope.example', 'https://nope.example')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('DNS lookup failed')
  })

  it('refuses when DNS returns no addresses', async () => {
    resolvesTo()
    const result = await checkPublicHost(
      'empty.example',
      'https://empty.example',
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('DNS returned no addresses')
  })
})

describe('checkPublicHost: CIMD_TEST_ORIGINS exemption', () => {
  it('exempts a named origin outside production, skipping DNS entirely', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv(
      'CIMD_TEST_ORIGINS',
      JSON.stringify(['https://cimd.test.local:4599']),
    )

    const result = await checkPublicHost(
      'cimd.test.local',
      'https://cimd.test.local:4599',
    )
    expect(result.allowed).toBe(true)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('does NOT exempt an origin that was not named', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv(
      'CIMD_TEST_ORIGINS',
      JSON.stringify(['https://cimd.test.local:4599']),
    )

    const result = await checkPublicHost(
      'other.test.local',
      'https://other.test.local',
    )
    expect(result.allowed).toBe(false)
  })

  // The DEBUG_SUPER_PASSWORD lesson: an env bypass must fail closed in prod.
  it('ignores the exemption entirely in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv(
      'CIMD_TEST_ORIGINS',
      JSON.stringify(['https://cimd.test.local:4599']),
    )

    const result = await checkPublicHost(
      'cimd.test.local',
      'https://cimd.test.local:4599',
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('.local')
  })
})

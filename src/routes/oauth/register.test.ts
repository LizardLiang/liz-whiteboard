// @vitest-environment node
// src/routes/oauth/register.test.ts
// Unit tests for the /oauth/register DCR endpoint's rate limiter and its
// underlying registration path (AC4). Mirrors the collab-token.test.ts
// pattern of testing exported handler-support functions directly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetIpRateLimitForTests,
  checkIpRateLimit,
  isDcrEnabled,
} from './register'
import { _resetClientStoreForTests, getClient, registerClient } from '@/lib/oauth/clients'
import { redirectUriAllowed } from '@/lib/oauth/config'

beforeEach(() => {
  _resetIpRateLimitForTests()
  _resetClientStoreForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('checkIpRateLimit (per-IP fixed window)', () => {
  it('allows requests under the limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkIpRateLimit('1.2.3.4')).toBe(true)
    }
  })

  it('rejects the request once the per-IP limit is exceeded', () => {
    for (let i = 0; i < 10; i++) {
      checkIpRateLimit('5.6.7.8')
    }
    expect(checkIpRateLimit('5.6.7.8')).toBe(false)
  })

  it('tracks separate IPs independently', () => {
    for (let i = 0; i < 10; i++) {
      checkIpRateLimit('9.9.9.9')
    }
    expect(checkIpRateLimit('9.9.9.9')).toBe(false)
    expect(checkIpRateLimit('1.1.1.1')).toBe(true)
  })
})

describe('redirect_uris validation reuses redirectUriAllowed (AC4)', () => {
  it('accepts a loopback-http redirect_uri', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1:8080/callback'],
        'http://127.0.0.1:8080/callback',
      ),
    ).toBe(true)
  })

  it('rejects a non-loopback http redirect_uri', () => {
    expect(
      redirectUriAllowed(
        ['http://evil.example/cb'],
        'http://evil.example/cb',
      ),
    ).toBe(false)
  })

  it('rejects a javascript: redirect_uri (W1 fix)', () => {
    expect(
      redirectUriAllowed(
        ['javascript:alert(1)'],
        'javascript:alert(1)',
      ),
    ).toBe(false)
  })

  it('rejects a data: redirect_uri (W1 fix)', () => {
    expect(
      redirectUriAllowed(
        ['data:text/html,<script>alert(1)</script>'],
        'data:text/html,<script>alert(1)</script>',
      ),
    ).toBe(false)
  })
})

describe('registerClient -> getClient round trip via the DCR store (AC4)', () => {
  it('register returns a public client with no client_secret, persisted for later /authorize + /token lookups', () => {
    const client = registerClient({
      redirectUris: ['http://127.0.0.1:8080/callback'],
      clientName: 'Test Client',
    })

    expect(client.clientId).toBeTruthy()
    expect(client.tokenEndpointAuthMethod).toBe('none')
    expect(
      (client as unknown as Record<string, unknown>).client_secret,
    ).toBeUndefined()

    // Simulates the AS restarting and a later /authorize or /token call
    // resolving the same client by clientId.
    const resolved = getClient(client.clientId)
    expect(resolved).not.toBeNull()
    expect(resolved?.redirectUris).toEqual(['http://127.0.0.1:8080/callback'])
    // BLOCKER fix (2026-07-18): DCR rows are always untrusted; /authorize
    // refuses them outright rather than auto-approving.
    expect(resolved?.trusted).toBe(false)
  })
})

describe('isDcrEnabled: DCR kill switch (BLOCKER fix, off by default)', () => {
  it('is disabled when OAUTH_ALLOW_DCR is unset', () => {
    vi.stubEnv('OAUTH_ALLOW_DCR', '')
    expect(isDcrEnabled()).toBe(false)
  })

  it('is disabled for any value other than the exact string "true"', () => {
    vi.stubEnv('OAUTH_ALLOW_DCR', '1')
    expect(isDcrEnabled()).toBe(false)
    vi.stubEnv('OAUTH_ALLOW_DCR', 'yes')
    expect(isDcrEnabled()).toBe(false)
  })

  it('is enabled only when OAUTH_ALLOW_DCR is exactly "true"', () => {
    vi.stubEnv('OAUTH_ALLOW_DCR', 'true')
    expect(isDcrEnabled()).toBe(true)
  })
})

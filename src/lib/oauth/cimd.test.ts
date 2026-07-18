// @vitest-environment node
// src/lib/oauth/cimd.test.ts
// Unit tests for resolveCimdClient() — Client ID Metadata Document resolution.
// Mocks global fetch; no real network calls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetCimdCacheForTests, resolveCimdClient } from './cimd'

function jsonResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  _resetCimdCacheForTests()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('resolveCimdClient: origin allowlist (AC2)', () => {
  it('rejects a URL whose origin is not in the allowlist, without fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await resolveCimdClient('https://evil.example/client')
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-https URL outright', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await resolveCimdClient('http://claude.ai/client')
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('accepts a URL whose origin is in the default allowlist (claude.ai)', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          client_id: url,
          redirect_uris: ['http://127.0.0.1:0/callback'],
        }),
      ),
    )

    const result = await resolveCimdClient(url)
    expect(result).not.toBeNull()
    expect(result?.clientId).toBe(url)
    expect(result?.trusted).toBe(true)
  })

  it('respects CIMD_ALLOWED_ORIGINS env override', async () => {
    vi.stubEnv('CIMD_ALLOWED_ORIGINS', JSON.stringify(['https://example.com']))
    const url = 'https://example.com/client'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ client_id: url, redirect_uris: ['https://example.com/cb'] }),
      ),
    )

    const result = await resolveCimdClient(url)
    expect(result?.clientId).toBe(url)

    // claude.ai should now NOT be allowed since the override replaced the default list.
    const rejected = await resolveCimdClient(
      'https://claude.ai/oauth/claude-code-client-metadata',
    )
    expect(rejected).toBeNull()
  })
})

describe('resolveCimdClient: self-reference check', () => {
  it('rejects when doc.client_id does not equal the fetched URL', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          client_id: 'https://claude.ai/some-other-id',
          redirect_uris: ['http://127.0.0.1:0/callback'],
        }),
      ),
    )

    const result = await resolveCimdClient(url)
    expect(result).toBeNull()
  })
})

describe('resolveCimdClient: fetch/document failure modes', () => {
  it('rejects when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await resolveCimdClient(
      'https://claude.ai/oauth/claude-code-client-metadata',
    )
    expect(result).toBeNull()
  })

  it('rejects a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    )
    const result = await resolveCimdClient(
      'https://claude.ai/oauth/claude-code-client-metadata',
    )
    expect(result).toBeNull()
  })

  it('rejects a redirect response instead of following it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example/client' },
        }),
      ),
    )
    const result = await resolveCimdClient(
      'https://claude.ai/oauth/claude-code-client-metadata',
    )
    expect(result).toBeNull()
  })

  it('rejects non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
    )
    const result = await resolveCimdClient(
      'https://claude.ai/oauth/claude-code-client-metadata',
    )
    expect(result).toBeNull()
  })

  it('rejects a document with no redirect_uris', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ client_id: url })),
    )
    const result = await resolveCimdClient(url)
    expect(result).toBeNull()
  })

  it('rejects a body larger than the ~32KB cap', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    const hugeName = 'x'.repeat(64 * 1024)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          client_id: url,
          redirect_uris: ['http://127.0.0.1:0/callback'],
          client_name: hugeName,
        }),
      ),
    )
    const result = await resolveCimdClient(url)
    expect(result).toBeNull()
  })
})

describe('resolveCimdClient: fail-closed when body is not streamable (W3 fix)', () => {
  it('rejects a response whose .body is null instead of buffering it unbounded', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    // Construct a Response-like object whose `.body` is null (simulates a
    // runtime/response type that doesn't expose a readable stream) but which
    // still has a working .text() — the previous implementation would fall
    // back to buffering this via response.text() before checking size,
    // contradicting the streaming-cap guarantee.
    const fakeResponse = {
      status: 200,
      ok: true,
      body: null,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            client_id: url,
            redirect_uris: ['http://127.0.0.1:0/callback'],
          }),
        ),
    } as unknown as Response

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse))

    const result = await resolveCimdClient(url)
    expect(result).toBeNull()
  })
})

describe('resolveCimdClient: last-known-good fallback for refresh (W4 fix)', () => {
  it('falls back to the last-known-good client on a transient fetch failure when allowStaleOnFailure=true, but NOT by default', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    const goodDoc = jsonResponse({
      client_id: url,
      redirect_uris: ['http://127.0.0.1:0/callback'],
      client_name: 'Claude Code',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(goodDoc))

    // Populate both the short-TTL cache and the last-known-good cache.
    const first = await resolveCimdClient(url)
    expect(first).not.toBeNull()

    // Simulate the short-TTL cache having expired and claude.ai being
    // unreachable (transient outage) on the next resolution attempt.
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(11 * 60 * 1000) // past the 10-minute cache TTL
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('network down')),
      )

      const freshAttempt = await resolveCimdClient(url)
      expect(freshAttempt).toBeNull() // no fallback without the flag

      const refreshAttempt = await resolveCimdClient(url, {
        allowStaleOnFailure: true,
      })
      expect(refreshAttempt).not.toBeNull()
      expect(refreshAttempt?.clientId).toBe(url)
      expect(refreshAttempt?.name).toBe('Claude Code')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT fall back to stale data for a self-reference mismatch, even with allowStaleOnFailure', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          client_id: url,
          redirect_uris: ['http://127.0.0.1:0/callback'],
        }),
      ),
    )
    const first = await resolveCimdClient(url)
    expect(first).not.toBeNull()

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(11 * 60 * 1000)
      // Document now vouches for a different client_id — a spoofing signal,
      // not a transient outage, so no stale fallback even with the flag set.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            client_id: 'https://claude.ai/some-other-id',
            redirect_uris: ['http://127.0.0.1:0/callback'],
          }),
        ),
      )
      const result = await resolveCimdClient(url, {
        allowStaleOnFailure: true,
      })
      expect(result).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns null (no fallback) when there is no last-known-good entry yet', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const result = await resolveCimdClient(url, { allowStaleOnFailure: true })
    expect(result).toBeNull()
  })
})

describe('resolveCimdClient: caching', () => {
  it('caches a resolved client and does not re-fetch on the second call', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata'
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        client_id: url,
        redirect_uris: ['http://127.0.0.1:0/callback'],
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const first = await resolveCimdClient(url)
    const second = await resolveCimdClient(url)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

// src/lib/auth/turnstile.test.ts
// Unit tests for Turnstile verification. Mocks global fetch
// — no real network call to Cloudflare.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstile } from './turnstile'

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = 'test-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY
  } else {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET
  }
})

describe('verifyTurnstile', () => {
  it('fails closed when no token is given', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await verifyTurnstile(null, '203.0.113.9')).toBe(false)
    expect(await verifyTurnstile(undefined, '203.0.113.9')).toBe(false)
    expect(await verifyTurnstile('', '203.0.113.9')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when TURNSTILE_SECRET_KEY is not set', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await verifyTurnstile('some-token', '203.0.113.9')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )

    expect(await verifyTurnstile('some-token', '203.0.113.9')).toBe(false)
  })

  it('fails closed on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 500 })),
    )

    expect(await verifyTurnstile('some-token', '203.0.113.9')).toBe(false)
  })

  it('fails closed on success: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ success: false }), { status: 200 }),
        ),
    )

    expect(await verifyTurnstile('some-token', '203.0.113.9')).toBe(false)
  })

  it('returns true on success: true, and posts the expected form fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstile('good-token', '203.0.113.9')

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.method).toBe('POST')
    const body = init.body as URLSearchParams
    expect(body.get('secret')).toBe('test-secret')
    expect(body.get('response')).toBe('good-token')
    expect(body.get('remoteip')).toBe('203.0.113.9')
  })
})

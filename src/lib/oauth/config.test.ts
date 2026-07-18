// @vitest-environment node
// src/lib/oauth/config.test.ts
// Unit tests for redirectUriAllowed() — RFC 8252 §7.3 any-port loopback
// redirect matching (the tactical plan's "must-fix").

import { describe, expect, it } from 'vitest'
import { redirectUriAllowed } from './config'

describe('redirectUriAllowed: loopback any-port matching (AC3)', () => {
  it('matches a loopback redirect_uri with a different ephemeral port than registered', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1/callback'],
        'http://127.0.0.1:53187/callback',
      ),
    ).toBe(true)
  })

  it('matches when the registered entry has a fixed port and presented has none', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1:10000/callback'],
        'http://127.0.0.1:53187/callback',
      ),
    ).toBe(true)
  })

  it('matches localhost the same way as 127.0.0.1 (same hostname required)', () => {
    expect(
      redirectUriAllowed(
        ['http://localhost:10000/callback'],
        'http://localhost:61234/callback',
      ),
    ).toBe(true)
  })

  it('does not cross-match 127.0.0.1 registered against localhost presented', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1:10000/callback'],
        'http://localhost:61234/callback',
      ),
    ).toBe(false)
  })

  it('rejects a loopback redirect_uri with a different path than registered', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1:10000/callback'],
        'http://127.0.0.1:53187/other-path',
      ),
    ).toBe(false)
  })

  it('rejects a non-loopback http:// redirect_uri outright', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1:10000/callback'],
        'http://evil.example/cb',
      ),
    ).toBe(false)
  })

  it('rejects a non-loopback http redirect even if it happens to be registered verbatim', () => {
    // Defense in depth: OAuth 2.1 §4.1.1 forbids non-loopback http:// redirects
    // regardless of what's in the allowlist.
    expect(
      redirectUriAllowed(['http://evil.example/cb'], 'http://evil.example/cb'),
    ).toBe(false)
  })

  it('exact-matches https redirect_uris (no port tolerance for non-loopback)', () => {
    expect(
      redirectUriAllowed(
        ['https://claude.ai/api/auth/oauth2/callback'],
        'https://claude.ai/api/auth/oauth2/callback',
      ),
    ).toBe(true)
  })

  it('rejects an https redirect_uri not present in the registered list', () => {
    expect(
      redirectUriAllowed(
        ['https://claude.ai/api/auth/oauth2/callback'],
        'https://claude.ai/other/callback',
      ),
    ).toBe(false)
  })

  it('rejects an unparseable presented redirect_uri', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:10000/callback'], 'not-a-url'),
    ).toBe(false)
  })

  it('rejects when registered list is empty', () => {
    expect(redirectUriAllowed([], 'http://127.0.0.1:53187/callback')).toBe(
      false,
    )
  })
})

describe('redirectUriAllowed: scheme allowlist (W1 fix)', () => {
  it('rejects a javascript: redirect_uri even if registered verbatim', () => {
    expect(
      redirectUriAllowed(
        ['javascript:alert(document.cookie)'],
        'javascript:alert(document.cookie)',
      ),
    ).toBe(false)
  })

  it('rejects a data: redirect_uri even if registered verbatim', () => {
    expect(
      redirectUriAllowed(
        ['data:text/html,<script>alert(1)</script>'],
        'data:text/html,<script>alert(1)</script>',
      ),
    ).toBe(false)
  })

  it('rejects an arbitrary custom-scheme redirect_uri even if registered verbatim', () => {
    expect(
      redirectUriAllowed(
        ['com.evil.app:/callback'],
        'com.evil.app:/callback',
      ),
    ).toBe(false)
  })
})

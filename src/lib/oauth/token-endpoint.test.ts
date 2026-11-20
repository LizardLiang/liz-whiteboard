// @vitest-environment node
// src/lib/oauth/token-endpoint.test.ts
// /token must prove a client is known BEFORE resolveClient (which fetches CIMD
// URLs), and must rate-limit per IP. Real data layer; only resolveClient is
// wrapped in a spy so the tests can assert it was never reached.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTokenPost } from './token-endpoint'
import type * as ResolveClientModule from '@/lib/oauth/resolve-client'

import { resolveClient } from '@/lib/oauth/resolve-client'
import { _resetClientStoreForTests, registerClient } from '@/lib/oauth/clients'
import {
  _resetCodesForTests,
  consumeAuthCode,
  issueAuthCode,
} from '@/lib/oauth/codes'
import { getOAuthConfig } from '@/lib/oauth/config'
import { deriveS256Challenge, generateCodeVerifier } from '@/lib/oauth/pkce'
import { _resetTokenStoresForTests, issueTokens } from '@/lib/oauth/tokens'
import { _resetKeyPairForTests } from '@/lib/oauth/keys'
import {
  TOKEN_IP_LIMIT_MAX,
  _resetAuthLimitsForTests,
} from '@/lib/auth/auth-limits'
import { PEER_IP_HEADER } from '@/lib/rate-limit'
import { makeUser, resetDb } from '@/test/db-helpers'

vi.mock('@/lib/oauth/resolve-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof ResolveClientModule>()
  return { ...actual, resolveClient: vi.fn(actual.resolveClient) }
})

vi.stubEnv('OAUTH_ISSUER', 'http://localhost:3000')

const CIMD_URL = 'https://attacker.example/client.json'
const REDIRECT = 'http://127.0.0.1:19999/callback'

function post(form: Record<string, string>, ip = '203.0.113.9'): Request {
  return new Request('http://localhost/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      [PEER_IP_HEADER]: ip,
    },
    body: new URLSearchParams(form).toString(),
  })
}

beforeEach(() => {
  resetDb()
  _resetClientStoreForTests()
  _resetCodesForTests()
  _resetTokenStoresForTests()
  _resetKeyPairForTests()
  _resetAuthLimitsForTests()
  vi.mocked(resolveClient).mockClear()
})

function codeFor(clientId: string, verifier: string) {
  const config = getOAuthConfig()
  return issueAuthCode(
    {
      clientId,
      redirectUri: REDIRECT,
      userId: makeUser().id,
      codeChallenge: deriveS256Challenge(verifier),
      codeChallengeMethod: 'S256',
      resource: config.mcpResourceUri,
      scope: config.scopes.join(' '),
    },
    config,
  )
}

describe('/token authorization_code: no CIMD fetch before the client is proven', () => {
  it('an unknown code with a CIMD client_id never reaches resolveClient', async () => {
    const res = await handleTokenPost(
      post({
        grant_type: 'authorization_code',
        client_id: CIMD_URL,
        code: 'does-not-exist',
        redirect_uri: REDIRECT,
        code_verifier: 'v'.repeat(50),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
    expect(resolveClient).not.toHaveBeenCalled()
  })

  it('a live code presented by another client_id is refused without resolving, and burned', async () => {
    const dcr = registerClient({ redirectUris: [REDIRECT] })
    const verifier = generateCodeVerifier()
    const code = codeFor(dcr.clientId, verifier)

    const res = await handleTokenPost(
      post({
        grant_type: 'authorization_code',
        client_id: CIMD_URL,
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }),
    )
    expect((await res.json()).error).toBe('invalid_grant')
    expect(resolveClient).not.toHaveBeenCalled()
    // Same single-use semantics as before: the wrong-client attempt consumed it.
    expect(consumeAuthCode(code)).toBeNull()
  })

  it('a valid code for a registered client still exchanges for tokens', async () => {
    const dcr = registerClient({ redirectUris: [REDIRECT] })
    const verifier = generateCodeVerifier()
    const code = codeFor(dcr.clientId, verifier)

    const res = await handleTokenPost(
      post({
        grant_type: 'authorization_code',
        client_id: dcr.clientId,
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.access_token).toBeTruthy()
    expect(json.refresh_token).toBeTruthy()
    // The same code cannot be used twice.
    const again = await handleTokenPost(
      post({
        grant_type: 'authorization_code',
        client_id: dcr.clientId,
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }),
    )
    expect(again.status).toBe(400)
  })
})

describe('/token refresh_token: no CIMD fetch before the client is proven', () => {
  it('an unknown refresh token never reaches resolveClient', async () => {
    const res = await handleTokenPost(
      post({
        grant_type: 'refresh_token',
        client_id: CIMD_URL,
        refresh_token: 'nope',
      }),
    )
    expect((await res.json()).error).toBe('invalid_grant')
    expect(resolveClient).not.toHaveBeenCalled()
  })

  it("another client's refresh token never reaches resolveClient", async () => {
    const dcr = registerClient({ redirectUris: [REDIRECT] })
    const issued = await issueTokens(
      {
        userId: makeUser().id,
        clientId: dcr.clientId,
        scope: 'whiteboard',
        resource: getOAuthConfig().mcpResourceUri,
      },
      getOAuthConfig(),
    )
    const res = await handleTokenPost(
      post({
        grant_type: 'refresh_token',
        client_id: CIMD_URL,
        refresh_token: issued.refreshToken,
      }),
    )
    expect((await res.json()).error).toBe('invalid_grant')
    expect(resolveClient).not.toHaveBeenCalled()
  })

  it('a refresh token presented by its own client still rotates', async () => {
    const dcr = registerClient({ redirectUris: [REDIRECT] })
    const issued = await issueTokens(
      {
        userId: makeUser().id,
        clientId: dcr.clientId,
        scope: 'whiteboard',
        resource: getOAuthConfig().mcpResourceUri,
      },
      getOAuthConfig(),
    )
    const res = await handleTokenPost(
      post({
        grant_type: 'refresh_token',
        client_id: dcr.clientId,
        refresh_token: issued.refreshToken,
      }),
    )
    expect(res.status).toBe(200)
  })
})

describe('/token per-IP rate limit', () => {
  it('refuses with 429 once an IP exceeds the window, other IPs unaffected', async () => {
    const bad = { grant_type: 'nope' }
    for (let i = 0; i < TOKEN_IP_LIMIT_MAX; i++) {
      expect((await handleTokenPost(post(bad, '198.51.100.1'))).status).toBe(400)
    }
    const limited = await handleTokenPost(post(bad, '198.51.100.1'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect((await handleTokenPost(post(bad, '198.51.100.2'))).status).toBe(400)
  })
})

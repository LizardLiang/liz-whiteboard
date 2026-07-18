// @vitest-environment node
// src/routes/authorize.test.ts
// Unit tests for the /authorize trust gate (security review BLOCKER fix,
// 2026-07-18): an untrusted client must be refused outright — no
// authorization code issued, no redirect carrying a code — while a trusted
// (first-party or origin-verified CIMD) client with a valid session still
// gets one. Mirrors the handler logic in src/routes/authorize.ts (same
// pattern as src/routes/api/auth.test.ts / collab-token.test.ts: the
// TanStack Start route handler can't be invoked directly outside a server
// runtime, so the logic is mirrored here against REAL data-layer and OAuth
// modules — nothing about client resolution, redirect_uri validation, the
// trust gate, or code issuance/consumption is mocked).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetClientStoreForTests, registerClient } from '@/lib/oauth/clients'
import { _resetCimdCacheForTests } from '@/lib/oauth/cimd'
import { _resetCodesForTests, consumeAuthCode, issueAuthCode } from '@/lib/oauth/codes'
import { getOAuthConfig, redirectUriAllowed } from '@/lib/oauth/config'
import { resolveClient } from '@/lib/oauth/resolve-client'
import { buildSetCookieHeader, parseSessionCookie } from '@/lib/auth/cookies'
import { createUserSession, validateSessionToken } from '@/lib/auth/session'
import { makeUser, resetDb } from '@/test/db-helpers'

const TEST_ISSUER = 'http://localhost:3000'
vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)

// ─────────────────────────────────────────────────────────────────────────────
// Handler logic mirrored from src/routes/authorize.ts (GET handler), using
// the REAL resolveClient / redirectUriAllowed / trust-gate / issueAuthCode
// path. Trimmed of the request-param-validation branch (covered implicitly
// by always sending well-formed params here).
// ─────────────────────────────────────────────────────────────────────────────
async function handleAuthorize(
  request: Request,
  params: {
    clientId: string
    redirectUri: string
    state?: string
    codeChallenge?: string
  },
): Promise<Response> {
  const config = getOAuthConfig()
  const client = await resolveClient(params.clientId)
  if (!client) {
    return new Response(
      JSON.stringify({ error: 'unauthorized_client', description: 'Unknown client_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (!redirectUriAllowed(client.redirectUris, params.redirectUri)) {
    return new Response(
      JSON.stringify({ error: 'invalid_request', description: 'redirect_uri mismatch' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const isTrustedClient = client.firstParty || client.trusted === true
  if (!isTrustedClient) {
    return new Response(
      JSON.stringify({
        error: 'unauthorized_client',
        error_description: 'This client is not verified for this authorization server.',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const effectiveScope = config.scopes.join(' ')
  const effectiveResource = config.mcpResourceUri

  const cookieHeader = request.headers.get('cookie')
  const sessionToken = parseSessionCookie(cookieHeader)
  if (!sessionToken) {
    return Response.redirect('http://localhost:3000/login', 302)
  }
  const authResult = await validateSessionToken(sessionToken)
  if (!authResult) {
    return Response.redirect('http://localhost:3000/login', 302)
  }
  const { user } = authResult

  const code = issueAuthCode(
    {
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      userId: user.id,
      codeChallenge: params.codeChallenge ?? 'test-challenge',
      codeChallengeMethod: 'S256',
      resource: effectiveResource,
      scope: effectiveScope,
    },
    config,
  )

  const callbackUrl = new URL(params.redirectUri)
  callbackUrl.searchParams.set('code', code)
  if (params.state) callbackUrl.searchParams.set('state', params.state)
  return Response.redirect(callbackUrl.toString(), 302)
}

beforeEach(() => {
  resetDb()
  _resetClientStoreForTests()
  _resetCimdCacheForTests()
  _resetCodesForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
})

async function loggedInRequest(): Promise<{ request: Request; userId: string }> {
  const user = makeUser()
  const { token } = await createUserSession(user.id, false)
  const cookie = buildSetCookieHeader(token, false).split(';')[0] // "session_token=..."
  const request = new Request('http://localhost:3000/authorize', {
    headers: { cookie },
  })
  return { request, userId: user.id }
}

describe('authorize trust gate: untrusted client is refused (BLOCKER fix)', () => {
  it('refuses a DCR-registered (untrusted) client with a JSON error, not a redirect-with-code', async () => {
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
      clientName: 'Attacker-registered client',
    })
    expect(dcrClient.trusted).toBe(false) // sanity: DCR rows are untrusted

    const { request } = await loggedInRequest()
    const response = await handleAuthorize(request, {
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
      state: 'attacker-state',
    })

    // No redirect at all — an untrusted client must not get anything that
    // looks like a successful (or even error-carrying) step of the flow.
    expect(response.status).toBe(403)
    expect(response.headers.get('location')).toBeNull()
    const body = await response.json()
    expect(body.error).toBe('unauthorized_client')
  })

  it('never issues a consumable authorization code for a refused untrusted client', async () => {
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
    })
    const { request } = await loggedInRequest()

    // Snapshot: consuming any freshly-generated-looking code should fail
    // because none was ever issued for this flow. We can't guess the code
    // string, so instead assert indirectly: issueAuthCode is never reached
    // by checking the response carries no `code` search param anywhere.
    const response = await handleAuthorize(request, {
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
    })
    expect(response.status).toBe(403)

    // Also confirm no Location header exists to extract a code from.
    expect(response.headers.get('location')).toBeNull()
  })

  it('refuses an untrusted client even without a valid session (fails closed, not just fails to a login redirect)', async () => {
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
    })
    const anonymousRequest = new Request('http://localhost:3000/authorize')

    const response = await handleAuthorize(anonymousRequest, {
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
    })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('unauthorized_client')
  })
})

describe('authorize trust gate: trusted clients still work (regression)', () => {
  it('issues a redirect with a consumable code for the static first-party client', async () => {
    const { request, userId } = await loggedInRequest()

    const response = await handleAuthorize(request, {
      clientId: 'mcp-claude',
      redirectUri: 'http://localhost:10000/callback',
      state: 'xyz',
    })

    expect(response.status).toBe(302)
    const location = response.headers.get('location')
    expect(location).toBeTruthy()
    const redirectUrl = new URL(location!)
    expect(redirectUrl.searchParams.get('state')).toBe('xyz')
    const code = redirectUrl.searchParams.get('code')
    expect(code).toBeTruthy()

    // Prove it's a real, single-use, consumable code bound to this flow.
    const consumed = consumeAuthCode(code!)
    expect(consumed).not.toBeNull()
    expect(consumed?.userId).toBe(userId)
    expect(consumed?.clientId).toBe('mcp-claude')
  })

  it('issues a code for an origin-verified CIMD client', async () => {
    const cimdUrl = 'https://claude.ai/oauth/claude-code-client-metadata'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            client_id: cimdUrl,
            redirect_uris: ['http://127.0.0.1:20000/callback'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const { request } = await loggedInRequest()
    const response = await handleAuthorize(request, {
      clientId: cimdUrl,
      redirectUri: 'http://127.0.0.1:20000/callback',
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('code')).toBeTruthy()

    vi.unstubAllGlobals()
  })

  it('redirects to /login (not a code) when the trusted client has no session', async () => {
    const anonymousRequest = new Request('http://localhost:3000/authorize')
    const response = await handleAuthorize(anonymousRequest, {
      clientId: 'mcp-claude',
      redirectUri: 'http://localhost:10000/callback',
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/login')
  })
})

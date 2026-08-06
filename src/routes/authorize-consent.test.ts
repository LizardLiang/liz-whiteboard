// @vitest-environment node
// src/routes/authorize-consent.test.ts
// Unit tests for the THREE-WAY untrusted-client branch added to /authorize by
// mcp-oauth-dcr-consent: existing-grant issuance, scope intersection /
// invalid_scope, and the consent redirect. Deliberately a SEPARATE file from
// src/routes/authorize.test.ts (which must stay unmodified — it pins the
// trusted-client branch's Response shapes) — mirrors that file's own pattern
// of testing a local copy of the handler logic against REAL data-layer and
// OAuth modules (nothing mocked except CIMD's network fetch, unused here).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetClientStoreForTests, registerClient } from '@/lib/oauth/clients'
import { _resetCimdCacheForTests } from '@/lib/oauth/cimd'
import { _resetCodesForTests, consumeAuthCode } from '@/lib/oauth/codes'
import { getOAuthConfig, redirectUriAllowed } from '@/lib/oauth/config'
import { _resetGrantStoreForTests, getGrant, scopeCovers, upsertGrant } from '@/lib/oauth/grants'
import {
  _resetPendingConsentForTests,
  createPendingConsent,
  peekPendingConsent,
} from '@/lib/oauth/pending-consent'
import { resolveClient } from '@/lib/oauth/resolve-client'
import { buildSetCookieHeader } from '@/lib/auth/cookies'
import { createUserSession } from '@/lib/auth/session'
import { makeUser, resetDb } from '@/test/db-helpers'

const TEST_ISSUER = 'http://localhost:3000'

// ─────────────────────────────────────────────────────────────────────────────
// Handler logic mirrored from the UNTRUSTED branch of src/routes/authorize.ts
// (post-session three-way gate), against the REAL resolveClient / grants /
// pending-consent / codes modules. The trusted branch is intentionally NOT
// duplicated here — that's authorize.test.ts's job, and it stays untouched.
// ─────────────────────────────────────────────────────────────────────────────
async function handleUntrustedAuthorize(params: {
  clientId: string
  redirectUri: string
  scope?: string
  state?: string
  userId: string
}): Promise<Response> {
  const config = getOAuthConfig()
  const client = await resolveClient(params.clientId)
  if (!client) throw new Error('test setup: client must resolve')
  if (!redirectUriAllowed(client.redirectUris, params.redirectUri)) {
    throw new Error('test setup: redirect_uri must be valid')
  }

  const requestedScopes = params.scope
    ? params.scope.split(' ').filter(Boolean)
    : config.scopes
  const intersectionScopes = requestedScopes.filter((s) =>
    config.scopes.includes(s),
  )

  if (intersectionScopes.length === 0) {
    const errorUrl = new URL(params.redirectUri)
    errorUrl.searchParams.set('error', 'invalid_scope')
    if (params.state) errorUrl.searchParams.set('state', params.state)
    return Response.redirect(errorUrl.toString(), 302)
  }

  const intersectionScopeStr = intersectionScopes.join(' ')
  const existingGrant = getGrant(params.userId, params.clientId)

  if (existingGrant && scopeCovers(existingGrant.scope, intersectionScopes)) {
    const { issueAuthCode } = await import('@/lib/oauth/codes')
    const code = issueAuthCode(
      {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        userId: params.userId,
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256',
        resource: config.mcpResourceUri,
        scope: existingGrant.scope,
      },
      config,
    )
    const callbackUrl = new URL(params.redirectUri)
    callbackUrl.searchParams.set('code', code)
    if (params.state) callbackUrl.searchParams.set('state', params.state)
    return Response.redirect(callbackUrl.toString(), 302)
  }

  const requestId = createPendingConsent({
    clientId: params.clientId,
    clientName: client.name,
    redirectUri: params.redirectUri,
    scope: intersectionScopeStr,
    codeChallenge: 'test-challenge',
    codeChallengeMethod: 'S256',
    resource: config.mcpResourceUri,
    state: params.state ?? '',
    userId: params.userId,
  })

  const consentUrl = new URL('/oauth/consent', TEST_ISSUER)
  consentUrl.searchParams.set('request_id', requestId)
  return Response.redirect(consentUrl.toString(), 302)
}

beforeEach(() => {
  resetDb()
  _resetClientStoreForTests()
  _resetCimdCacheForTests()
  _resetCodesForTests()
  _resetGrantStoreForTests()
  _resetPendingConsentForTests()
})

afterEach(() => {
  // no env stubbing in this file — nothing to unstub
})

describe('untrusted client, no covering grant -> consent redirect', () => {
  it('redirects to /oauth/consent with an opaque request_id, never a code', async () => {
    const { id: userId } = makeUser()
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
      clientName: 'VS Code MCP',
    })

    const response = await handleUntrustedAuthorize({
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
      state: 'abc',
      userId,
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/oauth/consent')
    expect(location.searchParams.get('code')).toBeNull()

    const requestId = location.searchParams.get('request_id')
    expect(requestId).toBeTruthy()

    const pending = peekPendingConsent(requestId!)
    expect(pending).not.toBeNull()
    expect(pending?.clientId).toBe(dcrClient.clientId)
    expect(pending?.clientName).toBe('VS Code MCP')
    expect(pending?.userId).toBe(userId)
    expect(pending?.scope).toBe('whiteboard')
  })
})

describe('untrusted client, existing covering grant -> issues a code, skips consent', () => {
  it('issues a consumable code directly when the requested scope is already granted', async () => {
    const { id: userId } = makeUser()
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
    })
    upsertGrant(userId, dcrClient.clientId, 'whiteboard')

    const response = await handleUntrustedAuthorize({
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
      state: 'xyz',
      userId,
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).not.toBe('/oauth/consent')
    const code = location.searchParams.get('code')
    expect(code).toBeTruthy()

    const consumed = consumeAuthCode(code!)
    expect(consumed).not.toBeNull()
    expect(consumed?.userId).toBe(userId)
    expect(consumed?.scope).toBe('whiteboard')
  })
})

describe('untrusted client, scope escalation beyond an existing grant -> re-prompts', () => {
  it('does not skip consent when the requested scope is not fully covered', async () => {
    const { id: userId } = makeUser()
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
    })
    // Grant an empty/narrower scope than what's requested this time.
    upsertGrant(userId, dcrClient.clientId, '')

    const response = await handleUntrustedAuthorize({
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
      scope: 'whiteboard',
      userId,
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/oauth/consent')
  })
})

describe('untrusted client, empty scope intersection -> invalid_scope', () => {
  it('redirects to the client redirect_uri with error=invalid_scope, no consent, no code', async () => {
    const { id: userId } = makeUser()
    const dcrClient = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
    })

    const response = await handleUntrustedAuthorize({
      clientId: dcrClient.clientId,
      redirectUri: 'http://127.0.0.1:19999/callback',
      scope: 'not-a-real-scope',
      state: 'zzz',
      userId,
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe(
      'http://127.0.0.1:19999/callback',
    )
    expect(location.searchParams.get('error')).toBe('invalid_scope')
    expect(location.searchParams.get('state')).toBe('zzz')
    expect(location.searchParams.get('code')).toBeNull()
  })
})

// Sanity: the trust classification driving this whole branch is unaffected
// (DCR rows are always untrusted — same invariant authorize.test.ts pins).
describe('sanity: DCR rows remain untrusted (does not touch the trusted branch)', () => {
  it('a freshly-registered DCR client is untrusted', () => {
    const client = registerClient({
      redirectUris: ['http://127.0.0.1:19999/callback'],
    })
    expect(client.trusted).toBe(false)
    expect(client.firstParty).toBe(false)
  })
})

// Session-creation smoke check — confirms the fixtures used elsewhere in this
// suite (buildSetCookieHeader/createUserSession) still exist with the same
// shape authorize.test.ts relies on, without re-testing session validation
// itself (already covered there).
describe('session fixtures still match authorize.test.ts shape', () => {
  it('createUserSession + buildSetCookieHeader produce a parseable cookie', async () => {
    const { id: userId } = makeUser()
    const { token } = await createUserSession(userId, false)
    const cookie = buildSetCookieHeader(token, false)
    expect(cookie).toContain('session_token=')
  })
})

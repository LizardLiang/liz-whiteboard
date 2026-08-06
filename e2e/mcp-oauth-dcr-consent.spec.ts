// e2e/mcp-oauth-dcr-consent.spec.ts
// End-to-end coverage for MCP OAuth DCR + consent screen
// (mcp-oauth-dcr-consent): register a client via DCR, drive the real
// /authorize -> /oauth/consent -> approve -> /token flow in the browser,
// confirm a second authorize for the same client skips consent, confirm
// revoking at /settings/connections breaks a refresh and re-prompts, confirm
// deny issues no code, and confirm the trusted/first-party (Claude Code)
// path still gets NO consent prompt at all (the hard regression this whole
// feature must not break). Auth comes from global-setup's storageState —
// mirrors e2e/version-history.spec.ts's structure.
//
// The consent screen and /settings/connections are ordinary server-rendered
// TanStack routes (not Socket.IO), so — unlike version-history.spec.ts's
// restore broadcast — nothing here depends on the single-process prod build;
// this suite runs fine against the two-process dev server.
import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { BASE_URL } from './fixtures'
import type { Page } from '@playwright/test'

// A fixed loopback redirect_uri per RFC 8252 §7.3 — nothing needs to be
// listening on this port. Each test that needs to observe the final
// redirect intercepts requests to this origin (see interceptRedirect below)
// and fulfills them locally instead of hitting the network.
const REDIRECT_PORT = 39217
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

// Unique per suite-run: DCR client rows this spec creates are NOT wiped by
// e2e/seed.ts (unlike the fixed-id whiteboard fixtures — see fixtures.ts),
// so a repeated run leaves prior runs' "E2E VS Code MCP"-named grants behind
// (orphan-GC'd after 24h — see sweepOrphanClients() — but not before then).
// A random suffix keeps each run's client name locator unambiguous on
// /settings/connections regardless of what earlier runs left behind.
const RUN_SUFFIX = randomBytes(4).toString('hex')
const APPROVED_CLIENT_NAME = `E2E VS Code MCP ${RUN_SUFFIX}`
const DENIED_CLIENT_NAME = `E2E Denied Client ${RUN_SUFFIX}`

function makePkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function buildAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scope?: string
}): string {
  const url = new URL('/authorize', BASE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)
  if (params.scope) url.searchParams.set('scope', params.scope)
  return url.toString()
}

/** Intercept the (unreachable) loopback redirect_uri and fulfill it locally
 * so `page.goto`/click-driven navigation can actually land there and we can
 * read the resulting `code`/`error` query params off `page.url()`. */
async function interceptRedirect(page: Page) {
  await page.route(`http://127.0.0.1:${REDIRECT_PORT}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>oauth callback received</body></html>',
    }),
  )
}

async function registerDcrClient(
  request: Page['request'],
  clientName: string,
): Promise<string> {
  const response = await request.post(`${BASE_URL}/oauth/register`, {
    data: {
      redirect_uris: [REDIRECT_URI],
      client_name: clientName,
    },
  })
  expect(response.status()).toBe(201)
  const body = (await response.json()) as { client_id: string }
  expect(body.client_id).toBeTruthy()
  return body.client_id
}

async function exchangeCodeForTokens(
  request: Page['request'],
  params: { code: string; clientId: string; verifier: string },
): Promise<{ access_token: string; refresh_token: string }> {
  const response = await request.post(`${BASE_URL}/token`, {
    form: {
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: params.verifier,
    },
  })
  expect(response.status()).toBe(200)
  return response.json()
}

/**
 * Hit /authorize via the API request context (not a browser navigation) and
 * return its 302 Location header without following it. Deliberately NOT a
 * `page.goto()` here: Chromium's cross-origin redirect-CHAIN interception
 * (goto -> 302 straight to an intercepted loopback origin, all within one
 * navigation) is flaky under Playwright's route mocking in this repo's dev
 * setup — confirmed empirically (works for a same-navigation button click
 * that triggers `window.location.assign`, but not for a goto() whose FIRST
 * hop is already the cross-origin redirect). Inspecting the raw Location
 * header is deterministic and still exercises the real server-side
 * three-way trust gate end-to-end — the piece under test here. The
 * session cookie from storageState is shared with this fixture (verified
 * empirically: an unauthenticated request would 302 to /login, not the
 * client's redirect_uri).
 */
async function authorizeRedirectLocation(
  request: Page['request'],
  url: string,
): Promise<{ status: number; location: string | undefined }> {
  const response = await request.get(url, { maxRedirects: 0 })
  return { status: response.status(), location: response.headers().location }
}

test.describe('MCP OAuth DCR + consent screen (mcp-oauth-dcr-consent)', () => {
  test.describe.configure({ mode: 'serial' })

  let clientId: string
  let refreshToken: string

  test('register via DCR, land on consent, approve, and exchange the code at /token', async ({
    page,
    request,
  }) => {
    clientId = await registerDcrClient(request, APPROVED_CLIENT_NAME)

    const { verifier, challenge } = makePkce()
    await interceptRedirect(page)

    await page.goto(
      buildAuthorizeUrl({
        clientId,
        redirectUri: REDIRECT_URI,
        challenge,
        state: 'e2e-state-1',
        scope: 'whiteboard',
      }),
    )

    // AC — landed on the consent screen, not an immediate redirect-with-code.
    // (CardTitle renders a styled <div>, not a heading role — text locator
    // matches the actual markup; see src/components/ui/card.tsx.)
    await expect(page.getByText('Authorize application')).toBeVisible()
    await expect(page.getByText(APPROVED_CLIENT_NAME)).toBeVisible()
    await expect(page.getByText(REDIRECT_URI)).toBeVisible()
    await expect(page.getByText('whiteboard', { exact: true })).toBeVisible()
    // AC — the "not verified" warning is shown for every untrusted client.
    await expect(
      page.getByText(/not verified by ER Whiteboard/),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Approve' }).click()

    // AC — approving redirects to the client's redirect_uri carrying a code.
    await page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${REDIRECT_PORT}`))
    const callbackUrl = new URL(page.url())
    expect(callbackUrl.searchParams.get('state')).toBe('e2e-state-1')
    const code = callbackUrl.searchParams.get('code')
    expect(code).toBeTruthy()

    // AC — the code is real and exchanges for tokens.
    const tokens = await exchangeCodeForTokens(request, {
      code: code!,
      clientId,
      verifier,
    })
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()
    refreshToken = tokens.refresh_token
  })

  test('second authorize for the same client skips consent entirely', async ({
    request,
  }) => {
    const { challenge } = makePkce()

    const { status, location } = await authorizeRedirectLocation(
      request,
      buildAuthorizeUrl({
        clientId,
        redirectUri: REDIRECT_URI,
        challenge,
        state: 'e2e-state-2',
        scope: 'whiteboard',
      }),
    )

    // Redirected DIRECTLY to the client's redirect_uri with a code — never
    // to /oauth/consent.
    expect(status).toBe(302)
    expect(location).toBeTruthy()
    const callbackUrl = new URL(location!)
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(REDIRECT_URI)
    expect(callbackUrl.searchParams.get('code')).toBeTruthy()
    expect(callbackUrl.searchParams.get('state')).toBe('e2e-state-2')
  })

  test('revoking at /settings/connections breaks the refresh token and re-prompts on next authorize', async ({
    page,
    request,
  }) => {
    await page.goto('/settings/connections')
    await expect(
      page.getByRole('heading', { name: 'Connected applications' }),
    ).toBeVisible()

    // CardTitle renders a styled <div>, not a heading role — locate the
    // whole Card by its data-slot and filter on the client name text.
    const appCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: APPROVED_CLIENT_NAME })
    await expect(appCard.getByText('whiteboard')).toBeVisible()

    await appCard.getByRole('button', { name: 'Revoke' }).click()
    await expect(page.getByText('Access revoked')).toBeVisible()
    await expect(page.getByText(APPROVED_CLIENT_NAME)).toHaveCount(0)

    // AC — the existing refresh token no longer works (revoke deletes
    // matching OauthRefreshToken rows, not just the grant row).
    const refreshResponse = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      },
    })
    expect(refreshResponse.status()).not.toBe(200)

    // AC — the next authorize re-prompts for consent (grant was deleted):
    // redirects to /oauth/consent, not directly to the client with a code.
    const { challenge } = makePkce()
    const { status, location } = await authorizeRedirectLocation(
      request,
      buildAuthorizeUrl({
        clientId,
        redirectUri: REDIRECT_URI,
        challenge,
        state: 'e2e-state-3',
        scope: 'whiteboard',
      }),
    )
    expect(status).toBe(302)
    expect(location).toBeTruthy()
    expect(new URL(location!).pathname).toBe('/oauth/consent')
  })

  test('deny issues no code and persists no grant', async ({
    page,
    request,
  }) => {
    const denyClientId = await registerDcrClient(request, DENIED_CLIENT_NAME)
    const { challenge } = makePkce()
    await interceptRedirect(page)

    await page.goto(
      buildAuthorizeUrl({
        clientId: denyClientId,
        redirectUri: REDIRECT_URI,
        challenge,
        state: 'e2e-state-deny',
        scope: 'whiteboard',
      }),
    )
    await expect(page.getByText('Authorize application')).toBeVisible()

    await page.getByRole('button', { name: 'Deny' }).click()

    await page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${REDIRECT_PORT}`))
    const callbackUrl = new URL(page.url())
    expect(callbackUrl.searchParams.get('code')).toBeNull()
    expect(callbackUrl.searchParams.get('error')).toBe('access_denied')
    expect(callbackUrl.searchParams.get('state')).toBe('e2e-state-deny')

    await page.goto('/settings/connections')
    await expect(page.getByText(DENIED_CLIENT_NAME)).toHaveCount(0)
  })

  test('regression: trusted first-party client still gets NO consent prompt', async ({
    request,
  }) => {
    // 'mcp-claude' is the built-in first-party allowlist entry
    // (src/lib/oauth/config.ts's DEFAULT_MCP_CLIENT) — resolves
    // firstParty:true and must hit the unchanged auto-approve branch,
    // exactly like the CIMD (Claude Code) path. Uses one of its registered
    // fixed-port loopback redirect URIs.
    const trustedRedirectUri = 'http://127.0.0.1:10000/callback'
    const { challenge } = makePkce()
    const authorizeUrl = new URL('/authorize', BASE_URL)
    authorizeUrl.searchParams.set('client_id', 'mcp-claude')
    authorizeUrl.searchParams.set('redirect_uri', trustedRedirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('code_challenge', challenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('state', 'e2e-trusted')

    const { status, location } = await authorizeRedirectLocation(
      request,
      authorizeUrl.toString(),
    )

    // Redirected DIRECTLY to the client's redirect_uri with a code — never
    // to /oauth/consent. This is the hard regression this whole feature
    // must not introduce for Claude Code / CIMD-equivalent trusted clients.
    expect(status).toBe(302)
    expect(location).toBeTruthy()
    const callbackUrl = new URL(location!)
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(trustedRedirectUri)
    expect(callbackUrl.searchParams.get('code')).toBeTruthy()
    expect(callbackUrl.searchParams.get('state')).toBe('e2e-trusted')
  })
})

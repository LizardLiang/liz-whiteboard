// e2e/mcp-cimd-open.spec.ts
// End-to-end coverage for OPEN CIMD resolution + the consent gate
// (mcp-oauth-open-cimd): a client_id from an origin that is NOT on
// CIMD_TRUSTED_ORIGINS resolves from its metadata document, lands on the
// consent screen with its provenance shown, is approved once, and is then
// remembered PER ORIGIN — a second login presenting a DIFFERENT document URL
// on the same origin skips the prompt. Revoking at /settings/connections
// kills the grant and every refresh token from that origin.
//
// WHY ITS OWN CONFIG (playwright.cimd.config.ts):
//   The AS fetches the metadata document SERVER-side, so Playwright cannot
//   intercept it — a real HTTP server has to answer, and the app process has
//   to be told that origin is fetchable via CIMD_TEST_ORIGINS. The default
//   playwright.config.ts reuses an already-running dev server, which would not
//   have that env, so this spec runs against a dedicated dev server on its own
//   port. It must be the DEV server, not the prod build: CIMD_TEST_ORIGINS is
//   ignored outright when NODE_ENV=production, which is the point of the flag.
//
//   Run: bun run test:e2e:cimd
//
// Everything here is ordinary server-rendered TanStack routing plus the OAuth
// endpoints — no Socket.IO — so nothing depends on the single-process prod
// build (unlike e2e/coedit-table-create.spec.ts).
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import { BASE_URL } from './fixtures'
import type { Server } from 'node:http'
import type { Page } from '@playwright/test'

// Must match the origin named in playwright.cimd.config.ts's CIMD_TEST_ORIGINS.
const CIMD_PORT = 39311
const CIMD_ORIGIN = `http://127.0.0.1:${CIMD_PORT}`

// Loopback redirect per RFC 8252 §7.3 — nothing listens here; the browser
// tests intercept it (see interceptRedirect).
const REDIRECT_PORT = 39312
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

// Grants this spec creates are keyed by ORIGIN and are not wiped by
// e2e/seed.ts, so a repeat run would otherwise find the previous run's grant
// already in place and skip the very consent screen test 1 asserts. Each run
// therefore serves its documents from a unique PATH prefix but — deliberately
// — the same origin, and test 1 revokes any pre-existing grant first.
const RUN_SUFFIX = randomBytes(4).toString('hex')
const CLIENT_NAME = `E2E CIMD Editor ${RUN_SUFFIX}`
const DOC_A = `${CIMD_ORIGIN}/${RUN_SUFFIX}/client-a.json`
const DOC_B = `${CIMD_ORIGIN}/${RUN_SUFFIX}/client-b.json`

let cimdServer: Server

/**
 * Serve a self-referencing CIMD document at any path. Self-reference is a hard
 * requirement of the resolver: the document's `client_id` must equal the URL
 * it was fetched from, so the body is derived from the request URL.
 */
function startCimdServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const selfUrl = `${CIMD_ORIGIN}${req.url ?? '/'}`

    if (selfUrl !== DOC_A && selfUrl !== DOC_B) {
      res.writeHead(404).end('not found')
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        client_id: selfUrl,
        client_name: CLIENT_NAME,
        redirect_uris: [REDIRECT_URI],
      }),
    )
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(CIMD_PORT, '127.0.0.1', () => resolve(server))
  })
}

function makePkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function buildAuthorizeUrl(params: {
  clientId: string
  challenge: string
  state: string
  scope?: string
}): string {
  const url = new URL('/authorize', BASE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)
  if (params.scope) url.searchParams.set('scope', params.scope)
  return url.toString()
}

async function interceptRedirect(page: Page) {
  await page.route(`http://127.0.0.1:${REDIRECT_PORT}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>oauth callback received</body></html>',
    }),
  )
}

/** Hit /authorize without following the redirect — see the DCR spec's note on
 * why raw Location inspection beats a cross-origin goto() here. */
async function authorizeRedirectLocation(
  request: Page['request'],
  url: string,
): Promise<{ status: number; location: string | undefined }> {
  const response = await request.get(url, { maxRedirects: 0 })
  return { status: response.status(), location: response.headers().location }
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

test.beforeAll(async () => {
  cimdServer = await startCimdServer()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => cimdServer.close(() => resolve()))
})

test.describe('Open CIMD resolution + consent gate (mcp-oauth-open-cimd)', () => {
  test.describe.configure({ mode: 'serial' })

  let refreshToken: string

  test('an untrusted CIMD origin resolves, lands on consent with its provenance, and exchanges a code', async ({
    page,
    request,
  }) => {
    // A prior run of this spec may have left an approved grant for this
    // origin — revoke it so the consent screen is genuinely exercised.
    await page.goto(`${BASE_URL}/settings/connections`)
    const staleRow = page.getByText(CIMD_ORIGIN, { exact: false })
    if (await staleRow.count()) {
      await page
        .getByRole('button', { name: /revoke/i })
        .first()
        .click()
      await expect(page.getByText(CIMD_ORIGIN, { exact: false })).toHaveCount(0)
    }

    const { verifier, challenge } = makePkce()
    await interceptRedirect(page)

    await page.goto(
      buildAuthorizeUrl({
        clientId: DOC_A,
        challenge,
        state: 'cimd-state-1',
        scope: 'whiteboard',
      }),
    )

    // AC — resolved from the document (not rejected as unknown_client) AND
    // routed to consent rather than auto-approved.
    await expect(page.getByText('Authorize application')).toBeVisible()
    await expect(page.getByText(CLIENT_NAME)).toBeVisible()

    // AC — provenance: the screen says the identity document was fetched, and
    // names the origin it came from.
    await expect(page.getByText(/Identity document fetched from/)).toBeVisible()
    await expect(page.getByText(CIMD_ORIGIN, { exact: false })).toBeVisible()

    // AC — redirect hostname is shown prominently, full URI still present.
    await expect(
      page.getByText(`127.0.0.1:${REDIRECT_PORT}`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(REDIRECT_URI, { exact: true })).toBeVisible()

    // AC — loopback warning fires for a redirect on the user's own machine.
    await expect(page.getByText(/your own computer/)).toBeVisible()

    // AC — the unverified warning still shows.
    await expect(page.getByText(/not verified by ER Whiteboard/)).toBeVisible()

    await page.getByRole('button', { name: 'Approve' }).click()

    await page.waitForURL(
      new RegExp(`^http://127\\.0\\.0\\.1:${REDIRECT_PORT}`),
    )
    const callbackUrl = new URL(page.url())
    expect(callbackUrl.searchParams.get('state')).toBe('cimd-state-1')
    const code = callbackUrl.searchParams.get('code')
    expect(code).toBeTruthy()

    // AC — the code is bound to the FULL document URL, not the origin, and
    // exchanges successfully at /token.
    const tokens = await exchangeCodeForTokens(request, {
      code: code!,
      clientId: DOC_A,
      verifier,
    })
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()
    refreshToken = tokens.refresh_token
  })

  // The reason grants are origin-scoped: Codex publishes its metadata at a
  // path containing a per-login callback id, so per-URL keying would prompt on
  // every single login.
  test('a DIFFERENT document URL on the same origin skips consent', async ({
    request,
  }) => {
    const { challenge } = makePkce()

    const { status, location } = await authorizeRedirectLocation(
      request,
      buildAuthorizeUrl({
        clientId: DOC_B,
        challenge,
        state: 'cimd-state-2',
        scope: 'whiteboard',
      }),
    )

    expect(status).toBe(302)
    expect(location).toBeTruthy()
    // Straight to the client's redirect_uri with a code — never /oauth/consent.
    expect(location).toContain(`http://127.0.0.1:${REDIRECT_PORT}`)
    expect(location).not.toContain('/oauth/consent')
    expect(new URL(location!).searchParams.get('code')).toBeTruthy()
  })

  test('the connected-apps page lists ONE row for the origin', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/settings/connections`)
    await expect(page.getByText(CLIENT_NAME)).toHaveCount(1)
  })

  // F6d: refresh tokens are stored against the FULL document URL while the
  // grant is keyed by origin. An exact-key delete would leave them alive.
  test('revoking the origin kills refresh tokens issued to its document URLs', async ({
    page,
    request,
  }) => {
    await page.goto(`${BASE_URL}/settings/connections`)
    await expect(page.getByText(CLIENT_NAME)).toBeVisible()

    await page
      .getByRole('button', { name: /revoke/i })
      .first()
      .click()
    await expect(page.getByText(CLIENT_NAME)).toHaveCount(0)

    // The refresh token was issued to DOC_A; the grant was revoked by origin.
    const response = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: DOC_A,
      },
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('a revoked origin must consent again', async ({ page }) => {
    const { challenge } = makePkce()
    await interceptRedirect(page)

    await page.goto(
      buildAuthorizeUrl({
        clientId: DOC_B,
        challenge,
        state: 'cimd-state-3',
        scope: 'whiteboard',
      }),
    )

    await expect(page.getByText('Authorize application')).toBeVisible()
  })
})

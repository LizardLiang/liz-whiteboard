// e2e/oauth-refresh-rotation-race.spec.ts
// End-to-end coverage for the idempotent-replay grace window
// (fix/oauth-refresh-rotation-race): fires two concurrent refresh_token
// grants against the SAME refresh token and asserts both succeed with the
// same pair (instead of the loser's replay revoking the whole grant family),
// then asserts the surviving refresh token genuinely still works.
//
// Mirrors e2e/mcp-oauth-dcr-consent.spec.ts's direct-request pattern
// (request.get/post against /authorize and /token, no browser navigation
// needed since 'mcp-claude' is a first-party trusted client that
// auto-approves — see that spec's "regression: trusted first-party client"
// test). Auth for this spec comes only from the OAuth flow itself, not
// storageState — /authorize and /token don't require a logged-in browser
// session for a resource owner other than the one driving these requests,
// but /authorize DOES require a logged-in resource-owner session, which
// storageState (global-setup's real /login) already provides.
//
// "A subsequent authenticated call with the surviving token still works"
// (mission requirement B): no route in this repo validates a Bearer access
// token from an external client (the /mcp streamable-HTTP route and
// /.well-known/oauth-protected-resource endpoint don't exist here — out of
// scope per the fix's own investigation). The only in-repo way to prove the
// surviving refresh token is genuinely still valid — not just echoed back —
// is a further legitimate refresh_token grant against it, asserting success.
import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { BASE_URL } from './fixtures'

function makePkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

test.describe('OAuth refresh-token rotation race (fix/oauth-refresh-rotation-race)', () => {
  test('concurrent replay of one refresh token: both requests succeed with the same pair, and the surviving token still works', async ({
    request,
  }) => {
    // ── 1. Authorize + exchange, using the first-party trusted client so no
    //    consent-screen browser interaction is needed (auto-approve path). ──
    const { verifier, challenge } = makePkce()
    const redirectUri = 'http://localhost:3000/oauth/callback'
    const authorizeUrl = new URL('/authorize', BASE_URL)
    authorizeUrl.searchParams.set('client_id', 'mcp-claude')
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('code_challenge', challenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('state', 'e2e-rotation-race')

    const authorizeResponse = await request.get(authorizeUrl.toString(), {
      maxRedirects: 0,
    })
    expect(authorizeResponse.status()).toBe(302)
    const location = authorizeResponse.headers().location
    expect(location).toBeTruthy()
    const callbackUrl = new URL(location)
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri)
    const code = callbackUrl.searchParams.get('code')
    expect(code).toBeTruthy()

    const exchangeResponse = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'authorization_code',
        code: code!,
        client_id: 'mcp-claude',
        redirect_uri: redirectUri,
        code_verifier: verifier,
      },
    })
    expect(exchangeResponse.status()).toBe(200)
    const initialTokens = (await exchangeResponse.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(initialTokens.refresh_token).toBeTruthy()
    const refreshToken = initialTokens.refresh_token

    // ── 2. Fire two concurrent refresh_token grants against the SAME token —
    //    reproduces the Codex CLI cross-process lock race (openai/codex#33540):
    //    a losing process re-sends a token a winner already rotated. ──────────
    const refreshGrant = () =>
      request.post(`${BASE_URL}/token`, {
        form: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: 'mcp-claude',
        },
      })

    const [responseA, responseB] = await Promise.all([
      refreshGrant(),
      refreshGrant(),
    ])

    // AC — BOTH concurrent requests succeed. Before the fix, the loser's
    // replay of the just-rotated token was treated as theft (REUSE DETECTED)
    // and returned invalid_grant, revoking the entire family — which would
    // also have broken the winner's freshly-issued token.
    expect(responseA.status()).toBe(200)
    expect(responseB.status()).toBe(200)

    const bodyA = (await responseA.json()) as {
      access_token: string
      refresh_token: string
    }
    const bodyB = (await responseB.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(bodyA.access_token).toBeTruthy()
    expect(bodyB.access_token).toBeTruthy()
    // AC — the loser is re-served the SAME pair the winner already got, not
    // a distinct freshly-rotated pair.
    expect(bodyA.refresh_token).toBe(bodyB.refresh_token)
    const survivingRefreshToken = bodyA.refresh_token

    // ── 3. AC — the surviving refresh token genuinely still works (the
    //    family was NOT revoked by the race). No in-repo route accepts a
    //    Bearer access token from an external caller (see module comment),
    //    so "still works" is proven via a further legitimate refresh. ───────
    const finalRefresh = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: survivingRefreshToken,
        client_id: 'mcp-claude',
      },
    })
    expect(finalRefresh.status()).toBe(200)
    const finalBody = (await finalRefresh.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(finalBody.access_token).toBeTruthy()
    expect(finalBody.refresh_token).toBeTruthy()
  })
})

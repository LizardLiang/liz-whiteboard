// src/routes/authorize.ts
// OAuth 2.1 /authorize endpoint — auth-code + PKCE flow
//
// CONSENT POLICY (security review BLOCKER fix, 2026-07-18):
//   There is NO consent UI in this endpoint (the earlier header comment
//   claiming a "plaintext consent step" was inaccurate — the handler goes
//   session-check -> issue code -> redirect, with no consent branch at all).
//   Because of that, only VERIFIED clients — the static first-party
//   allowlist entry and origin-verified CIMD clients (both resolved with
//   `trusted: true`/`firstParty: true`) — may reach code issuance. Any other
//   client (including any DCR-registered row, which is always persisted
//   `trusted: false`, see src/lib/oauth/clients.ts) is refused outright with
//   an OAuth error response — never silently downgraded to a narrower scope
//   and issued a code anyway, which is what previously allowed a
//   confused-deputy attack: an attacker could register an arbitrary client
//   via the open /register endpoint and phish an authorization code for a
//   logged-in user to an attacker-controlled redirect_uri. Re-introducing
//   trust for a new client class requires shipping a real consent screen
//   first.
//
// FLOW:
//   1. Parse and validate request params.
//   2. Resolve client_id and validate redirect_uri (exact/loopback match).
//   3. Refuse the request outright if the client is not verified/trusted.
//   4. Check the session_token cookie → resolve current User.
//   5. If not logged in: redirect to /login?redirect=<original authorize URL>.
//   6. Require code_challenge + code_challenge_method=S256.
//   7. Issue a short-lived authorization code bound to all grant params.
//   8. Redirect to redirect_uri?code=<code>&state=<state>.

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/authorize')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // All imports are dynamic: server-only modules must not be bundled
        // into the client. See src/routes/api/auth.ts for the same pattern.
        const url = new URL(request.url)
        const params = url.searchParams

        const clientId = params.get('client_id') ?? ''
        const redirectUri = params.get('redirect_uri') ?? ''
        const responseType = params.get('response_type') ?? ''
        // Note: the client's requested `scope` param is intentionally not read
        // here — only trusted clients reach code issuance (see the trust gate
        // below) and always receive the full supported scope set.
        const state = params.get('state') ?? ''
        const codeChallenge = params.get('code_challenge') ?? ''
        const codeChallengeMethod = params.get('code_challenge_method') ?? ''
        const resource = params.get('resource') ?? ''

        // --- Validate required params ---
        const errors: Array<string> = []
        if (responseType !== 'code') errors.push('response_type must be "code"')
        if (!clientId) errors.push('client_id is required')
        if (!redirectUri) errors.push('redirect_uri is required')
        if (!codeChallenge) errors.push('code_challenge is required (PKCE)')
        if (codeChallengeMethod !== 'S256')
          errors.push('code_challenge_method must be "S256"')

        if (errors.length > 0) {
          return new Response(
            JSON.stringify({ error: 'invalid_request', details: errors }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // --- Load config and resolve client ---
        // resolveClient() tries, in order: CIMD (https URL client_id) → static
        // allowlist → OauthClient DB row (DCR). See src/lib/oauth/resolve-client.ts.
        const { getOAuthConfig } = await import('@/lib/oauth/config')
        const { resolveClient } = await import('@/lib/oauth/resolve-client')
        const config = getOAuthConfig()

        const client = await resolveClient(clientId)
        if (!client) {
          return new Response(
            JSON.stringify({
              error: 'unauthorized_client',
              description: 'Unknown client_id',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // RFC 8252 §7.3 any-port loopback matching + exact match otherwise.
        const { redirectUriAllowed } = await import('@/lib/oauth/config')
        if (!redirectUriAllowed(client.redirectUris, redirectUri)) {
          return new Response(
            JSON.stringify({
              error: 'invalid_request',
              description: 'redirect_uri mismatch',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // --- Trust gate (BLOCKER fix: confused-deputy takeover) ---
        // No consent UI exists (see header comment). Until one ships, a
        // client that isn't verified — static first-party or
        // origin-verified CIMD — is refused outright rather than silently
        // issued a code with a narrower scope. This is the key invariant:
        // it makes the earlier open-DCR takeover impossible even if a
        // future bug or config change ever resolved an untrusted client_id
        // successfully, because no untrusted client can get past this
        // check to receive a code. Returned as a JSON OAuth error (NOT a
        // redirect) — an untrusted client must not receive anything that
        // looks like a successful step in the flow, including an
        // error-carrying redirect to its (unverified) redirect_uri.
        const isTrustedClient = client.firstParty || client.trusted === true
        if (!isTrustedClient) {
          console.warn(
            `[oauth/authorize] Refused untrusted client=${clientId} (no consent UI; only verified clients may authorize)`,
          )
          return new Response(
            JSON.stringify({
              error: 'unauthorized_client',
              error_description:
                'This client is not verified for this authorization server.',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Scope: every client reaching this point is trusted (see gate
        // above) — always grant the full supported scope regardless of what
        // was requested. This tolerates OAuth client bugs that truncate or
        // mangle scope strings (e.g. Claude Code sends "whiteboa" instead of
        // "whiteboard" due to an off-by-two parsing bug in the go-sdk
        // WWW-Authenticate scope extractor).
        const effectiveScope = config.scopes.join(' ')

        // Validate resource (RFC 8707) — optional for first increment; warn if absent
        const effectiveResource = resource || config.mcpResourceUri

        // --- Validate session ---
        const { parseSessionCookie } = await import('@/lib/auth/cookies')
        const { validateSessionToken } = await import('@/lib/auth/session')

        const cookieHeader = request.headers.get('cookie')
        const sessionToken = parseSessionCookie(cookieHeader)

        if (!sessionToken) {
          // Not logged in → redirect to /login, then back here after login
          const loginUrl = new URL('/login', url.origin)
          loginUrl.searchParams.set('redirect', url.pathname + url.search)
          return Response.redirect(loginUrl.toString(), 302)
        }

        const authResult = await validateSessionToken(sessionToken)
        if (!authResult) {
          const loginUrl = new URL('/login', url.origin)
          loginUrl.searchParams.set('redirect', url.pathname + url.search)
          return Response.redirect(loginUrl.toString(), 302)
        }

        const { user } = authResult

        // --- Issue authorization code ---
        const { issueAuthCode } = await import('@/lib/oauth/codes')
        const code = issueAuthCode(
          {
            clientId,
            redirectUri,
            userId: user.id,
            codeChallenge,
            codeChallengeMethod: 'S256',
            resource: effectiveResource,
            scope: effectiveScope,
          },
          config,
        )

        console.log(
          `[oauth/authorize] Issued code for user=${user.id} client=${clientId}`,
        )

        // Mark the DCR client row (if any) as authorized — drives orphan GC in
        // sweepOrphanClients(). No-op (0 rows updated) for CIMD/static clients,
        // which never have an OauthClient row.
        const { markAuthorized } = await import('@/lib/oauth/clients')
        markAuthorized(clientId)

        // --- Redirect back to client with code ---
        const callbackUrl = new URL(redirectUri)
        callbackUrl.searchParams.set('code', code)
        if (state) callbackUrl.searchParams.set('state', state)

        return Response.redirect(callbackUrl.toString(), 302)
      },
    },
  },
})

// src/routes/authorize.ts
// OAuth 2.1 /authorize endpoint — auth-code + PKCE flow
//
// CONSENT POLICY (first increment):
//   For first-party clients (firstParty: true in the allowlist) this endpoint
//   auto-approves without a consent UI. For third-party clients a simple
//   plaintext consent step is shown (TODO: real consent page in a later slice).
//
// FLOW:
//   1. Parse and validate request params.
//   2. Check the session_token cookie → resolve current User.
//   3. If not logged in: redirect to /login?redirect=<original authorize URL>.
//   4. Validate client_id (allowlist), redirect_uri (exact match).
//   5. Require code_challenge + code_challenge_method=S256.
//   6. Issue a short-lived authorization code bound to all grant params.
//   7. Redirect to redirect_uri?code=<code>&state=<state>.

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
        const scope = params.get('scope') ?? ''
        const state = params.get('state') ?? ''
        const codeChallenge = params.get('code_challenge') ?? ''
        const codeChallengeMethod = params.get('code_challenge_method') ?? ''
        const resource = params.get('resource') ?? ''

        // --- Validate required params ---
        const errors: string[] = []
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

        // --- Load config and validate client ---
        const { getOAuthConfig, findClient } = await import(
          '@/lib/oauth/config'
        )
        const config = getOAuthConfig()

        const client = findClient(clientId, config)
        if (!client) {
          return new Response(
            JSON.stringify({ error: 'unauthorized_client', description: 'Unknown client_id' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Exact redirect_uri match (RFC 6749 §4.1.2.1)
        if (!client.redirectUris.includes(redirectUri)) {
          return new Response(
            JSON.stringify({ error: 'invalid_request', description: 'redirect_uri mismatch' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        console.log(`[authorize] client_id=${clientId} scope=${JSON.stringify(scope)} redirect_uri=${redirectUri}`)

        // Validate scope
        // RFC 6749 §3.3: the AS may grant a narrower set of scopes than requested.
        // Grant the intersection of requested scopes and supported scopes.
        // Return invalid_scope only when the client requests scopes but NONE of
        // them are supported (e.g. scope=offline_access with no whiteboard).
        // This makes the AS tolerant of clients that append OIDC scopes like
        // offline_access alongside the supported whiteboard scope.
        const requestedScopes = scope.split(' ').filter(Boolean)
        const grantedScopes = requestedScopes.filter(
          (s) => config.scopes.includes(s),
        )
        if (requestedScopes.length > 0 && grantedScopes.length === 0) {
          // Client requested specific scopes but none are supported by this AS.
          const redirectError = new URL(redirectUri)
          redirectError.searchParams.set('error', 'invalid_scope')
          if (state) redirectError.searchParams.set('state', state)
          return Response.redirect(redirectError.toString(), 302)
        }

        const effectiveScope =
          grantedScopes.length > 0 ? grantedScopes.join(' ') : 'whiteboard'

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

        // --- Redirect back to client with code ---
        const callbackUrl = new URL(redirectUri)
        callbackUrl.searchParams.set('code', code)
        if (state) callbackUrl.searchParams.set('state', state)

        return Response.redirect(callbackUrl.toString(), 302)
      },
    },
  },
})

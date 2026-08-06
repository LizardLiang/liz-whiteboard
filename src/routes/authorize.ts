// src/routes/authorize.ts
// OAuth 2.1 /authorize endpoint — auth-code + PKCE flow
//
// CONSENT POLICY (mcp-oauth-dcr-consent, 2026-08-06 — supersedes the
// 2026-07-18 BLOCKER-fix policy below): the trust gate is now THREE-way,
// not two-way, and DCR is safe to re-open because a real consent screen
// exists:
//   - VERIFIED clients (static first-party allowlist entry, or
//     origin-verified CIMD, both resolved with `trusted: true`/
//     `firstParty: true`) → unchanged auto-approve path, full scope, no
//     consent UI. This branch is BYTE-FOR-BYTE identical to the prior
//     BLOCKER-fix version — see src/routes/authorize.test.ts, which pins its
//     Response shapes and must keep passing unmodified. Git history shows
//     two prior shipped fixes that broke a live client by touching scope
//     handling here (2413aa3, 0be340f) — do not touch this branch.
//   - UNTRUSTED clients (always DCR-registered, always persisted
//     `trusted: false` — see src/lib/oauth/clients.ts) with an existing
//     OauthGrant row that covers the requested scope → issue a code with the
//     granted scope, no consent prompt (the user already approved this
//     client). See src/lib/oauth/grants.ts.
//   - UNTRUSTED clients with no covering grant → compute
//     requested ∩ config.scopes; `invalid_scope` if empty; otherwise store a
//     pending request (src/lib/oauth/pending-consent.ts) and 302 to
//     /oauth/consent?request_id=<id>, which is a pure server-rendered React
//     route (src/routes/oauth/consent.tsx) that lets the user approve/deny.
//
// The trust gate now runs AFTER session validation (moved down from before
// it) so consent — like a login redirect — is never shown to a logged-out
// user: an anonymous request for ANY client (trusted or not) is bounced to
// /login first, then re-enters this same handler with a valid session on the
// way back (same `?redirect=` round trip already used for trusted clients).
//
// FLOW:
//   1. Parse and validate request params.
//   2. Resolve client_id and validate redirect_uri (exact/loopback match).
//   3. Check the session_token cookie → resolve current User; redirect to
//      /login if absent, regardless of trust.
//   4. Three-way trust gate (see above).
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
        // Read for the untrusted-client scope-intersection path (see the
        // trust gate below). Trusted clients still ignore this entirely and
        // always receive the full supported scope set — see that branch.
        const requestedScopeParam = params.get('scope') ?? ''
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

        // Validate resource (RFC 8707) — optional for first increment; warn if absent
        const effectiveResource = resource || config.mcpResourceUri

        // --- Validate session (moved before the trust gate: consent, like a
        // login redirect, must never be shown to a logged-out user) ---
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

        // --- Trust gate (three-way; mcp-oauth-dcr-consent) ---
        const isTrustedClient = client.firstParty || client.trusted === true

        if (isTrustedClient) {
          // Scope: every client reaching this branch is trusted — always
          // grant the full supported scope regardless of what was requested.
          // This tolerates OAuth client bugs that truncate or mangle scope
          // strings (e.g. Claude Code sends "whiteboa" instead of
          // "whiteboard" due to an off-by-two parsing bug in the go-sdk
          // WWW-Authenticate scope extractor). BYTE-FOR-BYTE unchanged from
          // the prior BLOCKER-fix version — do not touch (see header comment).
          const effectiveScope = config.scopes.join(' ')

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

          // Mark the DCR client row (if any) as authorized — drives orphan GC
          // in sweepOrphanClients(). No-op (0 rows updated) for CIMD/static
          // clients, which never have an OauthClient row.
          const { markAuthorized } = await import('@/lib/oauth/clients')
          markAuthorized(clientId)

          const callbackUrl = new URL(redirectUri)
          callbackUrl.searchParams.set('code', code)
          if (state) callbackUrl.searchParams.set('state', state)
          return Response.redirect(callbackUrl.toString(), 302)
        }

        // --- Untrusted client: intersection scope + grant/consent branch ---
        const requestedScopes = requestedScopeParam
          ? requestedScopeParam.split(' ').filter(Boolean)
          : config.scopes // no scope requested -> ask for everything supported
        const intersectionScopes = requestedScopes.filter((s) =>
          config.scopes.includes(s),
        )

        if (intersectionScopes.length === 0) {
          // Post-redirect_uri-validation error: safe to deliver via redirect
          // to the client's own (already-verified) redirect_uri per RFC 6749
          // §4.1.2.1, unlike the pre-validation errors above.
          const errorUrl = new URL(redirectUri)
          errorUrl.searchParams.set('error', 'invalid_scope')
          errorUrl.searchParams.set(
            'error_description',
            'No requested scope is supported by this authorization server.',
          )
          if (state) errorUrl.searchParams.set('state', state)
          return Response.redirect(errorUrl.toString(), 302)
        }

        const intersectionScopeStr = intersectionScopes.join(' ')

        const { getGrant, scopeCovers } = await import('@/lib/oauth/grants')
        const existingGrant = getGrant(user.id, clientId)

        if (existingGrant && scopeCovers(existingGrant.scope, intersectionScopes)) {
          // Already consented to at least this much — skip the prompt and
          // issue a code with the full previously-granted scope.
          const { issueAuthCode } = await import('@/lib/oauth/codes')
          const code = issueAuthCode(
            {
              clientId,
              redirectUri,
              userId: user.id,
              codeChallenge,
              codeChallengeMethod: 'S256',
              resource: effectiveResource,
              scope: existingGrant.scope,
            },
            config,
          )

          console.log(
            `[oauth/authorize] Issued code (existing grant) for user=${user.id} client=${clientId}`,
          )

          const { markAuthorized } = await import('@/lib/oauth/clients')
          markAuthorized(clientId)

          const callbackUrl = new URL(redirectUri)
          callbackUrl.searchParams.set('code', code)
          if (state) callbackUrl.searchParams.set('state', state)
          return Response.redirect(callbackUrl.toString(), 302)
        }

        // No covering grant — show the consent screen. The browser only ever
        // carries the opaque request_id; every grant param (redirect_uri,
        // PKCE, resource, state) is held server-side, so nothing about the
        // flow can be tampered with between here and the approve/deny POST.
        const { createPendingConsent } = await import(
          '@/lib/oauth/pending-consent'
        )
        const requestId = createPendingConsent({
          clientId,
          clientName: client.name,
          redirectUri,
          scope: intersectionScopeStr,
          codeChallenge,
          codeChallengeMethod: 'S256',
          resource: effectiveResource,
          state,
          userId: user.id,
        })

        console.log(
          `[oauth/authorize] Untrusted client=${clientId} user=${user.id} -> consent (request_id=${requestId})`,
        )

        const consentUrl = new URL('/oauth/consent', url.origin)
        consentUrl.searchParams.set('request_id', requestId)
        return Response.redirect(consentUrl.toString(), 302)
      },
    },
  },
})

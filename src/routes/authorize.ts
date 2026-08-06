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
import type { AuthUser } from '@/lib/auth/session'
import type { OAuthClient, OAuthConfig } from '@/lib/oauth/config'

// ─────────────────────────────────────────────────────────────────────────────
// W6/W7 fix: the GET handler below was one ~220-line function; it's now an
// orchestrator over the helpers in this section. All server-only imports
// stay dynamic (inside these functions, not at module top level) — server-
// only modules must not be bundled into the client. See src/routes/api/auth.ts
// for the same pattern. Type-only imports above are erased at build time and
// carry no such risk.
// ─────────────────────────────────────────────────────────────────────────────

interface AuthorizeParams {
  clientId: string
  redirectUri: string
  responseType: string
  /** Read only by the untrusted-client branch — trusted clients ignore it. */
  requestedScopeParam: string
  state: string
  codeChallenge: string
  codeChallengeMethod: string
  resource: string
}

function parseAuthorizeParams(url: URL): AuthorizeParams {
  const params = url.searchParams
  return {
    clientId: params.get('client_id') ?? '',
    redirectUri: params.get('redirect_uri') ?? '',
    responseType: params.get('response_type') ?? '',
    requestedScopeParam: params.get('scope') ?? '',
    state: params.get('state') ?? '',
    codeChallenge: params.get('code_challenge') ?? '',
    codeChallengeMethod: params.get('code_challenge_method') ?? '',
    resource: params.get('resource') ?? '',
  }
}

/** RFC 6749 §4.1.1 + PKCE required-param validation. Empty array = valid. */
function validateRequiredParams(p: AuthorizeParams): Array<string> {
  const errors: Array<string> = []
  if (p.responseType !== 'code') errors.push('response_type must be "code"')
  if (!p.clientId) errors.push('client_id is required')
  if (!p.redirectUri) errors.push('redirect_uri is required')
  if (!p.codeChallenge) errors.push('code_challenge is required (PKCE)')
  if (p.codeChallengeMethod !== 'S256')
    errors.push('code_challenge_method must be "S256"')
  return errors
}

/**
 * Resolve client_id and validate redirect_uri (RFC 8252 §7.3 any-port
 * loopback matching + exact match otherwise). Returns the resolved client on
 * success, or the exact error Response to return on failure.
 */
async function resolveClientForAuthorize(
  clientId: string,
  redirectUri: string,
): Promise<{ client: OAuthClient } | { errorResponse: Response }> {
  // resolveClient() tries, in order: CIMD (https URL client_id) → static
  // allowlist → OauthClient DB row (DCR). See src/lib/oauth/resolve-client.ts.
  const { resolveClient } = await import('@/lib/oauth/resolve-client')
  const client = await resolveClient(clientId)
  if (!client) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'unauthorized_client',
          description: 'Unknown client_id',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  const { redirectUriAllowed } = await import('@/lib/oauth/config')
  if (!redirectUriAllowed(client.redirectUris, redirectUri)) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'invalid_request',
          description: 'redirect_uri mismatch',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }

  return { client }
}

/**
 * Validate the session_token cookie. Moved before the trust gate (consent,
 * like a login redirect, must never be shown to a logged-out user): an
 * anonymous request for ANY client (trusted or not) is bounced to /login
 * first, then re-enters this same handler with a valid session on the way
 * back. Returns the authenticated user, or the redirect-to-/login Response.
 */
async function requireSessionUser(
  request: Request,
  url: URL,
): Promise<{ user: AuthUser } | { redirectResponse: Response }> {
  const { parseSessionCookie } = await import('@/lib/auth/cookies')
  const { validateSessionToken } = await import('@/lib/auth/session')

  const toLoginRedirect = (): Response => {
    const loginUrl = new URL('/login', url.origin)
    loginUrl.searchParams.set('redirect', url.pathname + url.search)
    return Response.redirect(loginUrl.toString(), 302)
  }

  const cookieHeader = request.headers.get('cookie')
  const sessionToken = parseSessionCookie(cookieHeader)
  if (!sessionToken) {
    return { redirectResponse: toLoginRedirect() }
  }

  const authResult = await validateSessionToken(sessionToken)
  if (!authResult) {
    return { redirectResponse: toLoginRedirect() }
  }

  return { user: authResult.user }
}

interface IssueCodeParams {
  clientId: string
  redirectUri: string
  userId: string
  codeChallenge: string
  resource: string
  scope: string
  state: string
  config: OAuthConfig
  /** e.g. '' for the trusted path, ' (existing grant)' for the grant-skip path — the only line these two call sites ever differed on. */
  logSuffix: string
}

/**
 * W7 fix: shared by the trusted-client path and the untrusted-existing-grant
 * path — both issue an authorization code, mark the DCR client authorized,
 * and redirect with `code`(+`state`) attached; they only ever differed in
 * which scope value to issue and one word in the log line, both now params.
 */
async function issueCodeAndRedirect(p: IssueCodeParams): Promise<Response> {
  const { issueAuthCode } = await import('@/lib/oauth/codes')
  const code = issueAuthCode(
    {
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      userId: p.userId,
      codeChallenge: p.codeChallenge,
      codeChallengeMethod: 'S256',
      resource: p.resource,
      scope: p.scope,
    },
    p.config,
  )

  console.log(
    `[oauth/authorize] Issued code${p.logSuffix} for user=${p.userId} client=${p.clientId}`,
  )

  // Mark the DCR client row (if any) as authorized — drives orphan GC in
  // sweepOrphanClients(). No-op (0 rows updated) for CIMD/static clients,
  // which never have an OauthClient row.
  const { markAuthorized } = await import('@/lib/oauth/clients')
  markAuthorized(p.clientId)

  const callbackUrl = new URL(p.redirectUri)
  callbackUrl.searchParams.set('code', code)
  if (p.state) callbackUrl.searchParams.set('state', p.state)
  return Response.redirect(callbackUrl.toString(), 302)
}

interface TrustedClientParams {
  clientId: string
  redirectUri: string
  userId: string
  codeChallenge: string
  resource: string
  state: string
  config: OAuthConfig
}

/**
 * Trusted (first-party or origin-verified CIMD) branch. BYTE-FOR-BYTE
 * identical observable behavior to the prior inline version — see
 * src/routes/authorize.test.ts, which pins this Response shape and must
 * keep passing unmodified. Git history shows two prior shipped fixes that
 * broke a live client by touching scope handling here (2413aa3, 0be340f) —
 * do not touch the scope line below.
 */
async function handleTrustedClient(p: TrustedClientParams): Promise<Response> {
  // Scope: every client reaching this branch is trusted — always grant the
  // full supported scope regardless of what was requested. This tolerates
  // OAuth client bugs that truncate or mangle scope strings (e.g. Claude
  // Code sends "whiteboa" instead of "whiteboard" due to an off-by-two
  // parsing bug in the go-sdk WWW-Authenticate scope extractor).
  const effectiveScope = p.config.scopes.join(' ')

  return issueCodeAndRedirect({
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    userId: p.userId,
    codeChallenge: p.codeChallenge,
    resource: p.resource,
    scope: effectiveScope,
    state: p.state,
    config: p.config,
    logSuffix: '',
  })
}

interface UntrustedClientParams {
  clientId: string
  clientName: string
  redirectUri: string
  userId: string
  codeChallenge: string
  resource: string
  state: string
  requestedScopeParam: string
  config: OAuthConfig
  origin: string
}

/**
 * Untrusted (DCR-registered) branch: requested ∩ config.scopes; invalid_scope
 * if empty; an existing covering OauthGrant skips the prompt; otherwise
 * stores a pending request and redirects to /oauth/consent.
 */
async function handleUntrustedClient(
  p: UntrustedClientParams,
): Promise<Response> {
  const requestedScopes = p.requestedScopeParam
    ? p.requestedScopeParam.split(' ').filter(Boolean)
    : p.config.scopes // no scope requested -> ask for everything supported
  const intersectionScopes = requestedScopes.filter((s) =>
    p.config.scopes.includes(s),
  )

  if (intersectionScopes.length === 0) {
    // Post-redirect_uri-validation error: safe to deliver via redirect to
    // the client's own (already-verified) redirect_uri per RFC 6749
    // §4.1.2.1, unlike the pre-validation errors in the caller.
    const errorUrl = new URL(p.redirectUri)
    errorUrl.searchParams.set('error', 'invalid_scope')
    errorUrl.searchParams.set(
      'error_description',
      'No requested scope is supported by this authorization server.',
    )
    if (p.state) errorUrl.searchParams.set('state', p.state)
    return Response.redirect(errorUrl.toString(), 302)
  }

  const intersectionScopeStr = intersectionScopes.join(' ')

  const { getGrant, scopeCovers } = await import('@/lib/oauth/grants')
  const existingGrant = getGrant(p.userId, p.clientId)

  if (existingGrant && scopeCovers(existingGrant.scope, intersectionScopes)) {
    // Already consented to at least this much — skip the prompt and issue a
    // code. S1 fix: issue the requested intersection (what was actually
    // asked for this time), not the full previously-granted scope, which
    // may be broader — latent only while config.scopes is a single
    // hardcoded value ['whiteboard'], since intersectionScopeStr and
    // existingGrant.scope necessarily coincide in that case.
    return issueCodeAndRedirect({
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      userId: p.userId,
      codeChallenge: p.codeChallenge,
      resource: p.resource,
      scope: intersectionScopeStr,
      state: p.state,
      config: p.config,
      logSuffix: ' (existing grant)',
    })
  }

  // No covering grant — show the consent screen. The browser only ever
  // carries the opaque request_id; every grant param (redirect_uri, PKCE,
  // resource, state) is held server-side, so nothing about the flow can be
  // tampered with between here and the approve/deny POST.
  const { createPendingConsent } = await import('@/lib/oauth/pending-consent')
  const requestId = createPendingConsent({
    clientId: p.clientId,
    clientName: p.clientName,
    redirectUri: p.redirectUri,
    scope: intersectionScopeStr,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: 'S256',
    resource: p.resource,
    state: p.state,
    userId: p.userId,
  })

  // S3 fix: request_id is a flow-control secret (single-use bearer token for
  // the pending consent record) — log only a short, non-actionable prefix,
  // not the full value.
  console.log(
    `[oauth/authorize] Untrusted client=${p.clientId} user=${p.userId} -> consent (request_id=${requestId.slice(0, 8)}…)`,
  )

  const consentUrl = new URL('/oauth/consent', p.origin)
  consentUrl.searchParams.set('request_id', requestId)
  return Response.redirect(consentUrl.toString(), 302)
}

export const Route = createFileRoute('/authorize')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const parsed = parseAuthorizeParams(url)

        const errors = validateRequiredParams(parsed)
        if (errors.length > 0) {
          return new Response(
            JSON.stringify({ error: 'invalid_request', details: errors }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const { getOAuthConfig } = await import('@/lib/oauth/config')
        const config = getOAuthConfig()

        const resolved = await resolveClientForAuthorize(
          parsed.clientId,
          parsed.redirectUri,
        )
        if ('errorResponse' in resolved) return resolved.errorResponse
        const { client } = resolved

        // Validate resource (RFC 8707) — optional for first increment.
        const effectiveResource = parsed.resource || config.mcpResourceUri

        const session = await requireSessionUser(request, url)
        if ('redirectResponse' in session) return session.redirectResponse
        const { user } = session

        // --- Trust gate (three-way; mcp-oauth-dcr-consent) ---
        const isTrustedClient = client.firstParty || client.trusted === true

        if (isTrustedClient) {
          return handleTrustedClient({
            clientId: parsed.clientId,
            redirectUri: parsed.redirectUri,
            userId: user.id,
            codeChallenge: parsed.codeChallenge,
            resource: effectiveResource,
            state: parsed.state,
            config,
          })
        }

        return handleUntrustedClient({
          clientId: parsed.clientId,
          clientName: client.name,
          redirectUri: parsed.redirectUri,
          userId: user.id,
          codeChallenge: parsed.codeChallenge,
          resource: effectiveResource,
          state: parsed.state,
          requestedScopeParam: parsed.requestedScopeParam,
          config,
          origin: url.origin,
        })
      },
    },
  },
})

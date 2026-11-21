// src/lib/oauth/token-endpoint.ts
// Request handling for the OAuth 2.1 /token endpoint (src/routes/token.ts is a
// thin wrapper), kept here so it can be tested without a server runtime.
//
// AUTHORIZATION CODE GRANT:
//   1. Verify grant_type, client_id, code, redirect_uri, code_verifier.
//   2. Prove the client is known BEFORE resolveClient (which may fetch a CIMD
//      URL): the code must exist, be unused/unexpired, and carry this client_id.
//   3. Consume the auth code (single-use), verify PKCE and redirect_uri.
//   4. Issue RS256 access token + rotating refresh token.
//
// REFRESH TOKEN GRANT:
//   1. Verify grant_type, client_id, refresh_token.
//   2. Prove the client is known: a refresh-token row must exist for that token
//      with this client_id. Only then resolveClient (forRefresh).
//   3. Rotate: old refresh token superseded, new issued.
//
// Every request is first limited per IP (src/lib/auth/auth-limits.ts).

import { randomUUID } from 'node:crypto'

export async function handleTokenPost(request: Request): Promise<Response> {
  const { checkTokenIpRateLimit } = await import('@/lib/auth/auth-limits')
  const { extractClientIp } = await import('@/lib/rate-limit')
  if (!checkTokenIpRateLimit(extractClientIp(request))) {
    const res = tokenError(
      'temporarily_unavailable',
      'Too many token requests; retry later',
      429,
    )
    res.headers.set('Retry-After', '60')
    return res
  }

  // Parse form-encoded body (OAuth 2.1 §4.1.3 requires this content-type)
  let body: URLSearchParams
  try {
    const text = await request.text()
    body = new URLSearchParams(text)
  } catch {
    return tokenError('invalid_request', 'Could not parse request body', 400)
  }

  const grantType = body.get('grant_type') ?? ''

  if (grantType === 'authorization_code') {
    return handleAuthCodeGrant(body)
  } else if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(body)
  } else {
    return tokenError(
      'unsupported_grant_type',
      `Unsupported grant_type: ${grantType}`,
      400,
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenError(
  error: string,
  description?: string,
  status = 400,
): Response {
  return new Response(
    JSON.stringify({
      error,
      ...(description ? { error_description: description } : {}),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}

async function handleAuthCodeGrant(body: URLSearchParams): Promise<Response> {
  const code = body.get('code') ?? ''
  const clientId = body.get('client_id') ?? ''
  const redirectUri = body.get('redirect_uri') ?? ''
  const codeVerifier = body.get('code_verifier') ?? ''

  if (!code) return tokenError('invalid_request', 'code is required')
  if (!clientId) return tokenError('invalid_request', 'client_id is required')
  if (!redirectUri)
    return tokenError('invalid_request', 'redirect_uri is required')
  if (!codeVerifier)
    return tokenError('invalid_request', 'code_verifier is required')
  // RFC 7636 §4.1: 43-128 characters from the unreserved set.
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier))
    return tokenError('invalid_request', 'code_verifier has an invalid format')

  // Prove the client is known BEFORE resolveClient: resolving a CIMD client_id
  // makes the server fetch an attacker-chosen URL. A live code bound to this
  // exact client_id was issued by /authorize after a session and a successful
  // resolve, so the client is known. A code that exists but belongs to another
  // client is burned, exactly as the consume-then-compare order did before.
  const {
    peekAuthCode,
    consumeAuthCode,
    findReplayedCodeFamily,
    setAuthCodeFamily,
  } = await import('@/lib/oauth/codes')
  const pending = peekAuthCode(code)
  if (!pending) {
    // A replayed code revokes the tokens its first use produced (RFC 6749 §4.1.2).
    const replayedFamily = findReplayedCodeFamily(code)
    if (replayedFamily) {
      const { revokeRefreshFamily } = await import('@/lib/oauth/tokens')
      revokeRefreshFamily(replayedFamily)
      console.warn(
        `[oauth/token] auth code replay: revoked family=${replayedFamily}`,
      )
    }
    return tokenError(
      'invalid_grant',
      'Authorization code is invalid, expired, or already used',
    )
  }
  if (pending.clientId !== clientId) {
    consumeAuthCode(code)
    return tokenError('invalid_grant', 'client_id mismatch')
  }

  // Resolve client — same resolver used at /authorize (CIMD → static → DCR DB).
  const { getOAuthConfig } = await import('@/lib/oauth/config')
  const { resolveClient } = await import('@/lib/oauth/resolve-client')
  const config = getOAuthConfig()
  const client = await resolveClient(clientId)
  if (!client) {
    return tokenError('invalid_client', 'Unknown client_id', 401)
  }

  // RFC 8707: only the MCP resource is a valid target.
  const { isAllowedResource } = await import('@/lib/oauth/resource')
  const requestedResource = body.get('resource')
  if (requestedResource && !isAllowedResource(requestedResource, config)) {
    return tokenError('invalid_target', 'resource is not a valid target')
  }

  // Consume the authorization code
  const authCode = consumeAuthCode(code)
  if (!authCode) {
    return tokenError(
      'invalid_grant',
      'Authorization code is invalid, expired, or already used',
    )
  }

  if (!isAllowedResource(authCode.resource, config)) {
    return tokenError('invalid_target', 'resource is not a valid target')
  }

  // Verify client_id matches what was used at /authorize
  if (authCode.clientId !== clientId) {
    return tokenError('invalid_grant', 'client_id mismatch')
  }

  // Verify redirect_uri matches the value bound to the code at /authorize
  // (RFC 6749 §4.1.3 anti-injection check). This is an exact match against the
  // SAME request's own value stored in the auth code — not against the
  // client's registered redirectUris list — so redirectUriAllowed()'s any-port
  // loopback tolerance doesn't apply here (both sides come from one flow).
  if (authCode.redirectUri !== redirectUri) {
    return tokenError('invalid_grant', 'redirect_uri mismatch')
  }

  // Verify PKCE code_verifier against stored challenge
  const { verifyS256 } = await import('@/lib/oauth/pkce')
  if (!verifyS256(codeVerifier, authCode.codeChallenge)) {
    return tokenError(
      'invalid_grant',
      'PKCE code_verifier does not match code_challenge',
    )
  }

  // Issue tokens
  const { issueTokens } = await import('@/lib/oauth/tokens')
  const familyId = randomUUID()
  setAuthCodeFamily(code, familyId)
  const result = await issueTokens(
    {
      userId: authCode.userId,
      clientId,
      scope: authCode.scope,
      resource: authCode.resource,
    },
    config,
    familyId,
  )

  console.log(
    `[oauth/token] Issued access token for user=${authCode.userId} client=${clientId}`,
  )

  return new Response(
    JSON.stringify({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}

async function handleRefreshTokenGrant(
  body: URLSearchParams,
): Promise<Response> {
  const refreshToken = body.get('refresh_token') ?? ''
  const clientId = body.get('client_id') ?? ''

  if (!refreshToken)
    return tokenError('invalid_request', 'refresh_token is required')
  if (!clientId) return tokenError('invalid_request', 'client_id is required')

  // Prove the client is known BEFORE resolveClient (which may fetch a CIMD
  // URL): a live refresh-token row must exist for this token and carry this
  // client_id. Unknown token or another client's token gets no fetch.
  const { getRefreshTokenClientId } = await import('@/lib/oauth/tokens')
  if (getRefreshTokenClientId(refreshToken) !== clientId) {
    return tokenError('invalid_grant', 'Refresh token is invalid or expired')
  }

  const { getOAuthConfig } = await import('@/lib/oauth/config')
  const { resolveClient } = await import('@/lib/oauth/resolve-client')
  const config = getOAuthConfig()

  // forRefresh: true (W4 fix) — a transient CIMD-origin outage (e.g. claude.ai
  // blip) must not reject an otherwise-valid refresh token; falls back to the
  // last-known-good resolved client. Never set for /authorize or the
  // authorization_code grant (see handleAuthCodeGrant above).
  const client = await resolveClient(clientId, { forRefresh: true })
  if (!client) {
    return tokenError('invalid_client', 'Unknown client_id', 401)
  }

  // RFC 8707: reject an explicit non-MCP resource, and any refresh token whose
  // stored grant resource is not the MCP resource (e.g. issued before the
  // allowlist existed).
  const { isAllowedResource } = await import('@/lib/oauth/resource')
  const requestedResource = body.get('resource')
  if (requestedResource && !isAllowedResource(requestedResource, config)) {
    return tokenError('invalid_target', 'resource is not a valid target')
  }

  const { rotateRefreshToken, getRefreshTokenResource } =
    await import('@/lib/oauth/tokens')
  const storedResource = getRefreshTokenResource(refreshToken)
  if (storedResource !== null && !isAllowedResource(storedResource, config)) {
    return tokenError('invalid_target', 'resource is not a valid target')
  }
  const result = await rotateRefreshToken(refreshToken, clientId, config)

  if (!result) {
    return tokenError('invalid_grant', 'Refresh token is invalid or expired')
  }

  console.log(`[oauth/token] Rotated refresh token for client=${clientId}`)

  return new Response(
    JSON.stringify({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}

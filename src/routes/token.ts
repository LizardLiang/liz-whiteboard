// src/routes/token.ts
// OAuth 2.1 /token endpoint — authorization_code and refresh_token grants
//
// AUTHORIZATION CODE GRANT:
//   1. Parse application/x-www-form-urlencoded body.
//   2. Verify grant_type, client_id, code, redirect_uri, code_verifier.
//   3. Consume the auth code (single-use).
//   4. Verify PKCE: SHA-256(code_verifier) === stored code_challenge.
//   5. Verify client_id and redirect_uri match what the code was issued with.
//   6. Issue RS256 access token + rotating refresh token.
//
// REFRESH TOKEN GRANT:
//   1. Verify grant_type, client_id, refresh_token.
//   2. Rotate: old refresh token deleted, new issued.
//   3. Return new access token + new refresh token.

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
          return tokenError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`, 400)
        }
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenError(
  error: string,
  description?: string,
  status = 400,
): Response {
  return new Response(
    JSON.stringify({ error, ...(description ? { error_description: description } : {}) }),
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
  if (!redirectUri) return tokenError('invalid_request', 'redirect_uri is required')
  if (!codeVerifier) return tokenError('invalid_request', 'code_verifier is required')

  // Validate client exists
  const { getOAuthConfig, findClient } = await import('@/lib/oauth/config')
  const config = getOAuthConfig()
  const client = findClient(clientId, config)
  if (!client) {
    return tokenError('invalid_client', 'Unknown client_id', 401)
  }

  // Consume the authorization code
  const { consumeAuthCode } = await import('@/lib/oauth/codes')
  const authCode = consumeAuthCode(code)
  if (!authCode) {
    return tokenError('invalid_grant', 'Authorization code is invalid, expired, or already used')
  }

  // Verify client_id matches what was used at /authorize
  if (authCode.clientId !== clientId) {
    return tokenError('invalid_grant', 'client_id mismatch')
  }

  // Verify redirect_uri matches (RFC 6749 §4.1.3)
  if (authCode.redirectUri !== redirectUri) {
    return tokenError('invalid_grant', 'redirect_uri mismatch')
  }

  // Verify PKCE code_verifier against stored challenge
  const { verifyS256 } = await import('@/lib/oauth/pkce')
  if (!verifyS256(codeVerifier, authCode.codeChallenge)) {
    return tokenError('invalid_grant', 'PKCE code_verifier does not match code_challenge')
  }

  // Issue tokens
  const { issueTokens } = await import('@/lib/oauth/tokens')
  const result = await issueTokens(
    {
      userId: authCode.userId,
      clientId,
      scope: authCode.scope,
      resource: authCode.resource,
    },
    config,
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

async function handleRefreshTokenGrant(body: URLSearchParams): Promise<Response> {
  const refreshToken = body.get('refresh_token') ?? ''
  const clientId = body.get('client_id') ?? ''

  if (!refreshToken) return tokenError('invalid_request', 'refresh_token is required')
  if (!clientId) return tokenError('invalid_request', 'client_id is required')

  const { getOAuthConfig, findClient } = await import('@/lib/oauth/config')
  const config = getOAuthConfig()

  const client = findClient(clientId, config)
  if (!client) {
    return tokenError('invalid_client', 'Unknown client_id', 401)
  }

  const { rotateRefreshToken } = await import('@/lib/oauth/tokens')
  const result = await rotateRefreshToken(refreshToken, clientId, config)

  if (!result) {
    return tokenError('invalid_grant', 'Refresh token is invalid or expired')
  }

  console.log(
    `[oauth/token] Rotated refresh token for client=${clientId}`,
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

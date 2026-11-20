// src/lib/oauth/revoke-endpoint.ts
// OAuth 2.0 Token Revocation endpoint — RFC 7009
//
// POST /revoke
// Content-Type: application/x-www-form-urlencoded
// Body: token=<refresh_token>&client_id=<id>
//
// Per RFC 7009 §2.2:
//   - The server MUST respond with HTTP 200 whether or not the token was found.
//     This prevents oracle attacks (leaking whether a token is valid).
//   - Unknown or already-expired tokens: silently return 200 {}.
//   - Valid token belonging to the given client: DELETE entire grant family.
//   - The presented token must have been issued to the request's client_id;
//     the token row's stored client_id is the proof, so no client lookup
//     (resolveClient would fetch CIMD URLs for an unauthenticated caller) is
//     needed, and DCR/CIMD clients can revoke like static ones.

export async function handleRevokePost(request: Request): Promise<Response> {
  let body: URLSearchParams
  try {
    const text = await request.text()
    body = new URLSearchParams(text)
  } catch {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        error_description: 'Could not parse request body',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const token = body.get('token') ?? ''
  const clientId = body.get('client_id') ?? ''

  if (!token) {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        error_description: 'token is required',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (!clientId) {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        error_description: 'client_id is required',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // revokeRefreshToken returns false if the token is unknown or was issued to a
  // different client_id; per RFC 7009 §2.2 we always return 200.
  const { revokeRefreshToken } = await import('@/lib/oauth/tokens')
  const revoked = revokeRefreshToken(token, clientId)

  if (revoked) {
    console.log(`[oauth/revoke] Revoked token family for client=${clientId}`)
  }

  // RFC 7009 §2.2: always 200, empty JSON body.
  return new Response('{}', {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

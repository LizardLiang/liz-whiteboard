// src/routes/api/collab-token.ts
// Server-to-server endpoint: issues a short-lived JWT with aud=collabResourceUri
// for use by the MCP backend when authenticating to the collab Socket.IO server.
//
// SECURITY MODEL:
//   - Caller must be the trusted MCP confidential client.
//   - Auth: client_id + client_secret in the JSON body (not a public client).
//   - The returned JWT has: iss=AS issuer, aud=collabResourceUri, sub=userId,
//     exp=now+collabTokenTtl (120s), signed with the AS RS256 key.
//   - The collab server validates the JWT via the AS public key (same process).
//   - No session token is created; no DB write occurs for auth.
//
// NOT a standard OAuth grant type — this is an internal backend-to-backend
// endpoint. It satisfies the "confused deputy" constraint: the MCP server never
// forwards the client's access token (aud=MCP server) to the collab server.
// Instead it obtains a separate credential whose audience is the collab server.

import { createFileRoute } from '@tanstack/react-router'

// ─────────────────────────────────────────────────────────────────────────────
// Per-IP fixed-window rate limiter (in-process; resets on restart).
// 15 attempts per 60-second window per IP.
// ─────────────────────────────────────────────────────────────────────────────
interface RateLimitEntry {
  count: number
  windowStart: number
}

const _ipRateLimitMap = new Map<string, RateLimitEntry>()
const RATE_LIMIT_MAX = 15
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Returns true if the request is within the rate limit, false if it exceeds it.
 * Exported for unit testing; do not call from outside this module in production.
 */
export function checkIpRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = _ipRateLimitMap.get(ip)
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    _ipRateLimitMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  entry.count += 1
  return entry.count <= RATE_LIMIT_MAX
}

/** Clears the in-process rate-limit map. For tests only. */
export function _resetIpRateLimitForTests(): void {
  _ipRateLimitMap.clear()
}

export const Route = createFileRoute('/api/collab-token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ── Rate limiting (per-IP, fixed window) ──────────────────────────────
        // Applied before body parsing to avoid resource exhaustion on the body
        // decode path.
        const clientIp =
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          request.headers.get('x-real-ip') ??
          'unknown'
        if (!checkIpRateLimit(clientIp)) {
          return new Response(
            JSON.stringify({
              error: 'too_many_requests',
              error_description:
                'Rate limit exceeded. Try again in 60 seconds.',
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'Retry-After': '60',
              },
            },
          )
        }

        let rawBody: unknown
        try {
          const contentType = request.headers.get('content-type') ?? ''
          if (!contentType.includes('application/json')) {
            return collabTokenError(
              'invalid_request',
              'Content-Type must be application/json',
              400,
            )
          }
          rawBody = await request.json()
        } catch {
          return collabTokenError(
            'invalid_request',
            'Could not parse request body',
            400,
          )
        }

        // ── Type validation ────────────────────────────────────────────────────
        // Prevents Buffer.from(<non-string>) from throwing an uncaught 500 and
        // enforces a predictable contract before any secret comparison.
        const body = rawBody as Record<string, unknown>
        if (typeof body.client_id !== 'string') {
          return collabTokenError(
            'invalid_request',
            'client_id must be a string',
          )
        }
        if (typeof body.client_secret !== 'string') {
          return collabTokenError(
            'invalid_request',
            'client_secret must be a string',
          )
        }
        if (typeof body.user_id !== 'string') {
          return collabTokenError('invalid_request', 'user_id must be a string')
        }

        const client_id: string = body.client_id
        const client_secret: string = body.client_secret
        const user_id: string = body.user_id

        if (!client_id)
          return collabTokenError('invalid_request', 'client_id is required')
        if (!client_secret)
          return collabTokenError(
            'invalid_request',
            'client_secret is required',
          )
        if (!user_id)
          return collabTokenError('invalid_request', 'user_id is required')

        // Load config and validate client credentials
        const { getOAuthConfig } = await import('@/lib/oauth/config')
        const config = getOAuthConfig()

        // Reject empty secrets even in dev (forces explicit config for this endpoint)
        if (!config.mcpClientSecret) {
          return collabTokenError(
            'server_error',
            'MCP_CLIENT_SECRET is not configured',
            500,
          )
        }

        if (client_id !== config.mcpClientId) {
          return collabTokenError('invalid_client', 'Unknown client_id', 401)
        }

        // ── Constant-time secret comparison ───────────────────────────────────
        // HMAC-SHA256 both strings under the configured secret as the HMAC key,
        // then compare the two fixed-size (32-byte) digests with timingSafeEqual.
        // This eliminates the early exit on length mismatch that previously leaked
        // the expected secret's byte-length to timing-side-channel attackers.
        const { timingSafeEqual, createHmac } = await import('node:crypto')
        const hmacKey = config.mcpClientSecret
        const expectedDigest = createHmac('sha256', hmacKey)
          .update(config.mcpClientSecret)
          .digest()
        const providedDigest = createHmac('sha256', hmacKey)
          .update(client_secret)
          .digest()
        if (!timingSafeEqual(expectedDigest, providedDigest)) {
          return collabTokenError(
            'invalid_client',
            'Invalid client_secret',
            401,
          )
        }

        // Verify the user_id exists in the database (prevents forgery of unknown users)
        const { db } = await import('@/db')
        const userRow = db
          .prepare('SELECT id FROM "User" WHERE id = ?')
          .get(user_id) as { id: string } | undefined
        if (!userRow) {
          return collabTokenError('invalid_request', 'user_id not found', 404)
        }

        // Issue the collab-audience JWT
        const { getSigningKeyPair } = await import('@/lib/oauth/keys')
        const { SignJWT } = await import('jose')

        const { kid, privateKey } = await getSigningKeyPair()
        const now = Math.floor(Date.now() / 1000)
        const exp = now + config.collabTokenTtl

        const token = await new SignJWT({ sub: user_id })
          .setProtectedHeader({ alg: 'RS256', kid })
          .setIssuer(config.issuer)
          .setAudience(config.collabResourceUri)
          .setIssuedAt(now)
          .setNotBefore(now)
          .setExpirationTime(exp)
          .sign(privateKey)

        // Debug-gated log: only emits when DEBUG or VERBOSE env var is set.
        // Suppressed in production to avoid logging actor identity on every issuance.
        if (process.env.DEBUG || process.env.VERBOSE) {
          console.log(
            `[collab-token] Issued collab JWT for user=${user_id} client=${client_id} aud=${config.collabResourceUri}`,
          )
        }

        return new Response(
          JSON.stringify({
            token,
            token_type: 'Bearer',
            expires_in: config.collabTokenTtl,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          },
        )
      },
    },
  },
})

function collabTokenError(
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

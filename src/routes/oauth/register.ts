// src/routes/oauth/register.ts
// OAuth 2.0 Dynamic Client Registration — RFC 7591 (hardened fallback path)
//
// POST /oauth/register
// Content-Type: application/json
// Body: { redirect_uris: string[], client_name?, grant_types?, response_types?,
//         scope?, software_id? }
//
// This is the fallback for MCP clients that don't support CIMD (the primary,
// more secure path for Claude Code — see src/lib/oauth/cimd.ts). Per RFC 7591
// §3, DCR is unauthenticated by spec (no initial access token requirement
// here), so this endpoint cannot itself be gated by auth. Registering a
// client_id grants NO elevated trust: DCR rows are always persisted with
// trusted=0 (see src/lib/oauth/clients.ts), and /authorize refuses any
// untrusted client outright (no consent UI exists yet — see
// src/routes/authorize.ts) rather than issuing it a code. Public clients
// only — token_endpoint_auth_method is forced to "none", no client_secret is
// ever issued or accepted.
//
// DISABLED BY DEFAULT (security review BLOCKER fix, 2026-07-18): an open,
// unauthenticated /register endpoint combined with the (now-fixed) trust bug
// enabled a confused-deputy account takeover. Even with the trust fix, an
// open registration endpoint is unnecessary attack surface while CIMD covers
// the only client we currently need to support (Claude Code/claude.ai). This
// endpoint is gated behind OAUTH_ALLOW_DCR=true (off by default) and returns
// 404 otherwise. The DCR store/table/route are kept dormant rather than
// deleted so a future consent-gated re-enable (e.g. if live testing shows a
// client that only speaks DCR, not CIMD) is cheap.
//
// NOTE: this lives at /oauth/register, not /register — /register is already
// the user-facing signup page (src/routes/register.tsx). RFC 7591 doesn't fix
// a path name; when enabled, clients would discover this URL via
// registration_endpoint in AS metadata — which is currently NOT advertised
// (src/lib/oauth/handlers/as-metadata.ts).

import { createFileRoute } from '@tanstack/react-router'
import { createFixedWindowRateLimiter, extractClientIp } from '@/lib/rate-limit'

// ─────────────────────────────────────────────────────────────────────────────
// Per-IP fixed-window rate limiter (in-process; resets on restart).
// Shared implementation with src/routes/api/collab-token.ts (W5 fix); see
// src/lib/rate-limit.ts for the trusted-proxy IP extraction rationale (W2).
// Registration is unauthenticated, so this is the main abuse control besides
// orphan GC — moot while OAUTH_ALLOW_DCR is unset, but kept in place for
// when it's re-enabled.
// ─────────────────────────────────────────────────────────────────────────────
const _rateLimiter = createFixedWindowRateLimiter({
  max: 10,
  windowMs: 60_000,
})

/**
 * Returns true if the request is within the rate limit, false if it exceeds it.
 * Exported for unit testing; do not call from outside this module in production.
 */
export function checkIpRateLimit(ip: string): boolean {
  return _rateLimiter.check(ip)
}

/** Clears the in-process rate-limit map. For tests only. */
export function _resetIpRateLimitForTests(): void {
  _rateLimiter.reset()
}

/**
 * Whether the open DCR endpoint is enabled. Off by default — see the
 * DISABLED BY DEFAULT header comment above for the security rationale.
 * Exported for unit testing.
 */
export function isDcrEnabled(): boolean {
  return process.env.OAUTH_ALLOW_DCR === 'true'
}

function registerError(
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
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  )
}

/**
 * Validate a candidate redirect_uris array: must be a non-empty array of
 * strings, each of which is either https or loopback-http (never a
 * non-loopback http:// URI). Reuses redirectUriAllowed() by matching each URI
 * against itself — its non-loopback-http rejection and URL-parse validation
 * apply the same way whether checking a presented value against a registered
 * list, or checking a candidate value against itself.
 */
async function validateRedirectUris(
  value: unknown,
): Promise<Array<string> | null> {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((v) => typeof v === 'string')) return null
  const { redirectUriAllowed } = await import('@/lib/oauth/config')
  const allValid = value.every((uri) => redirectUriAllowed([uri], uri))
  return allValid ? value : null
}

export const Route = createFileRoute('/oauth/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ── DCR kill switch (BLOCKER fix) ───────────────────────────────────
        // Off by default; see the header comment for rationale. Checked
        // before rate limiting / body parsing so a disabled endpoint does
        // the minimum possible work.
        if (!isDcrEnabled()) {
          return new Response(
            JSON.stringify({
              error: 'not_found',
              error_description: 'Dynamic client registration is disabled.',
            }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              },
            },
          )
        }

        // ── Rate limiting (per-IP, fixed window) ──────────────────────────
        const clientIp = extractClientIp(request)
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

        // ── Parse body ──────────────────────────────────────────────────
        let rawBody: unknown
        try {
          const contentType = request.headers.get('content-type') ?? ''
          if (!contentType.includes('application/json')) {
            return registerError(
              'invalid_client_metadata',
              'Content-Type must be application/json',
            )
          }
          rawBody = await request.json()
        } catch {
          return registerError(
            'invalid_client_metadata',
            'Could not parse request body',
          )
        }

        const body = rawBody as Record<string, unknown>

        const redirectUris = await validateRedirectUris(body.redirect_uris)
        if (!redirectUris) {
          return registerError(
            'invalid_redirect_uri',
            'redirect_uris must be a non-empty array of https or loopback-http URIs',
          )
        }

        const clientName =
          typeof body.client_name === 'string' ? body.client_name : undefined
        const scope = typeof body.scope === 'string' ? body.scope : undefined
        const softwareId =
          typeof body.software_id === 'string' ? body.software_id : undefined

        // grant_types / response_types: accept the client's request only if it
        // matches what this AS actually supports; otherwise fall back to
        // defaults. Never let the client widen its own grant beyond what
        // /token and /authorize implement.
        const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token']
        const SUPPORTED_RESPONSE_TYPES = ['code']
        const grantTypes =
          Array.isArray(body.grant_types) &&
          body.grant_types.every(
            (g) => typeof g === 'string' && SUPPORTED_GRANT_TYPES.includes(g),
          ) &&
          body.grant_types.length > 0
            ? (body.grant_types as Array<string>)
            : SUPPORTED_GRANT_TYPES
        const responseTypes =
          Array.isArray(body.response_types) &&
          body.response_types.every(
            (r) =>
              typeof r === 'string' && SUPPORTED_RESPONSE_TYPES.includes(r),
          ) &&
          body.response_types.length > 0
            ? (body.response_types as Array<string>)
            : SUPPORTED_RESPONSE_TYPES

        // token_endpoint_auth_method is ALWAYS forced to "none" — public
        // clients only, no client_secret is ever issued.
        const { registerClient } = await import('@/lib/oauth/clients')
        const client = registerClient({
          redirectUris,
          clientName,
          grantTypes,
          responseTypes,
          scope,
          softwareId,
        })

        console.log(
          `[oauth/register] Registered DCR client=${client.clientId} name=${clientName ?? '(none)'}`,
        )

        return new Response(
          JSON.stringify({
            client_id: client.clientId,
            client_id_issued_at: Math.floor(client.clientIdIssuedAt / 1000),
            redirect_uris: client.redirectUris,
            client_name: clientName,
            grant_types: client.grantTypes,
            response_types: client.responseTypes,
            token_endpoint_auth_method: 'none',
            scope: client.scope,
            software_id: client.softwareId,
          }),
          {
            status: 201,
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

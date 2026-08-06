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
// trusted=0 (see src/lib/oauth/clients.ts), and /authorize now shows a real
// consent screen (src/routes/oauth/consent.tsx) before ever issuing an
// untrusted client a code — see the mcp-oauth-dcr-consent header comment in
// src/routes/authorize.ts. Public clients only — token_endpoint_auth_method
// is forced to "none", no client_secret is ever issued or accepted.
//
// ENABLED BY DEFAULT (mcp-oauth-dcr-consent, 2026-08-06 — supersedes the
// 2026-07-18 BLOCKER-fix default-off policy): the original DISABLED BY
// DEFAULT posture existed because open, unauthenticated DCR combined with NO
// consent UI at /authorize enabled a confused-deputy account takeover. That
// gap is now closed — every untrusted client (including every DCR
// registration) must clear a consent screen and a persisted per-user grant
// before it can receive a code, so leaving this endpoint open no longer
// reproduces the takeover. `OAUTH_ALLOW_DCR=false` remains the kill switch
// (checked as `!== 'false'`, so unset/anything-else defaults to enabled) for
// operators who want to fall back to CIMD-only onboarding.
//
// NOTE: this lives at /oauth/register, not /register — /register is already
// the user-facing signup page (src/routes/register.tsx). RFC 7591 doesn't fix
// a path name; clients discover this URL via registration_endpoint in AS
// metadata, advertised whenever isDcrEnabled() is true (kept in lockstep —
// see src/lib/oauth/handlers/as-metadata.ts).

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createFixedWindowRateLimiter, extractClientIp } from '@/lib/rate-limit'

// ─────────────────────────────────────────────────────────────────────────────
// Request body validation (W3 fix). DCR is unauthenticated (see header
// comment), so the body schema is the only thing standing between an
// attacker and unbounded strings/arrays being persisted to OauthClient
// (src/lib/oauth/clients.ts) and later rendered on the consent screen
// (src/routes/oauth/consent.tsx) and /settings/connections. `.max(255)`
// matches this project's Zod convention for user-facing string fields (see
// src/data/schema.ts:114,131,151); redirect_uris entries get the same cap
// plus a bound on the array length itself so a single request can't persist
// an arbitrarily large row.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_REDIRECT_URIS = 10

const dcrRegisterBodySchema = z.object({
  redirect_uris: z.array(z.string().max(255)).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().max(255).optional(),
  grant_types: z.array(z.string().max(255)).optional(),
  response_types: z.array(z.string().max(255)).optional(),
  scope: z.string().max(255).optional(),
  software_id: z.string().max(255).optional(),
})

/**
 * Body-size guard (W3 fix), checked before `request.json()` buffers the
 * body into memory. Mirrors the 32KB cap CIMD document fetches enforce
 * (src/lib/oauth/cimd.ts:30) — DCR registration bodies are far smaller than
 * that in every legitimate case (a handful of short strings), so the same
 * cap comfortably covers real clients while bounding an attacker's payload.
 * `Content-Length` is attacker-controlled but browsers/fetch clients always
 * set it accurately for a JSON.stringify'd body; a request that lies about
 * it either fails at the transport layer or still hits the schema's
 * `.max(255)` per-field caps above.
 */
const MAX_REGISTER_BODY_BYTES = 32 * 1024 // 32KB

function isBodyTooLarge(request: Request): boolean {
  const contentLength = request.headers.get('content-length')
  if (contentLength === null) return false
  const bytes = Number(contentLength)
  return Number.isFinite(bytes) && bytes > MAX_REGISTER_BODY_BYTES
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-IP fixed-window rate limiter (in-process; resets on restart).
// Shared implementation with src/routes/api/collab-token.ts (W5 fix); see
// src/lib/rate-limit.ts for the trusted-proxy IP extraction rationale (W2).
// Registration is unauthenticated, so this is the main abuse control besides
// orphan GC — DCR defaults to enabled, so this limiter is live in the
// default configuration, not just kept in reserve.
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
 * Whether the open DCR endpoint is enabled. On by default — see the
 * ENABLED BY DEFAULT header comment above for the security rationale.
 * Set OAUTH_ALLOW_DCR=false to disable. Exported for unit testing.
 */
export function isDcrEnabled(): boolean {
  return process.env.OAUTH_ALLOW_DCR !== 'false'
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
        // ── DCR kill switch ──────────────────────────────────────────────
        // On by default; see the header comment for rationale. Set
        // OAUTH_ALLOW_DCR=false to disable. Checked before rate limiting /
        // body parsing so a disabled endpoint does the minimum possible work.
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

        // ── Body-size guard (W3 fix) ────────────────────────────────────
        // Checked before request.json() buffers the body — see the
        // isBodyTooLarge doc comment for rationale.
        if (isBodyTooLarge(request)) {
          return registerError(
            'invalid_client_metadata',
            `Request body exceeds ${MAX_REGISTER_BODY_BYTES} bytes`,
            413,
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

        // ── Schema validation (W3 fix) ──────────────────────────────────
        // Length-caps and array-size caps on every client-supplied field —
        // see the dcrRegisterBodySchema doc comment for rationale.
        const parsed = dcrRegisterBodySchema.safeParse(rawBody)
        if (!parsed.success) {
          return registerError(
            'invalid_client_metadata',
            parsed.error.issues[0]?.message ?? 'Invalid request body',
          )
        }
        const body = parsed.data

        const redirectUris = await validateRedirectUris(body.redirect_uris)
        if (!redirectUris) {
          return registerError(
            'invalid_redirect_uri',
            'redirect_uris must be a non-empty array of https or loopback-http URIs',
          )
        }

        const clientName = body.client_name
        const scope = body.scope
        const softwareId = body.software_id

        // grant_types / response_types: accept the client's request only if it
        // matches what this AS actually supports; otherwise fall back to
        // defaults. Never let the client widen its own grant beyond what
        // /token and /authorize implement.
        const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token']
        const SUPPORTED_RESPONSE_TYPES = ['code']
        const grantTypes =
          body.grant_types &&
          body.grant_types.every((g) => SUPPORTED_GRANT_TYPES.includes(g)) &&
          body.grant_types.length > 0
            ? body.grant_types
            : SUPPORTED_GRANT_TYPES
        const responseTypes =
          body.response_types &&
          body.response_types.every((r) =>
            SUPPORTED_RESPONSE_TYPES.includes(r),
          ) &&
          body.response_types.length > 0
            ? body.response_types
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

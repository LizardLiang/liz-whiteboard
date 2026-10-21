// src/routes/api/render-token.ts
// Server-to-server endpoint: mints a short-lived render token so the MCP
// server's headless browser can open /render/<kind>/<token> and screenshot a
// board.
//
// SECURITY MODEL:
//   - Auth: `Authorization: Bearer <collab-audience JWT>`, validated by
//     `validateCollabToken` — the same verifier /api/canvas-boards uses. The
//     MCP server's own access token is NOT accepted (confused deputy).
//   - The acting user is the JWT `sub`. Never a body field.
//   - Authorization: VIEWER role on the board's project. A render is a read.
//   - Rate limit: two buckets, per IP pre-auth and per subject post-auth, for
//     the reason documented in src/routes/api/canvas-boards.ts (every MCP call
//     shares one IP, so a single per-IP bucket starves all users).
//   - 404 for an unknown board is returned BEFORE the role check, matching
//     /api/canvas-boards: board ids are random UUIDv4, so the existence oracle
//     is negligible and the MCP needs to tell a typo from a permission error.

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createFixedWindowRateLimiter, extractClientIp } from '@/lib/rate-limit'

const _ipRateLimiter = createFixedWindowRateLimiter({
  max: 600,
  windowMs: 60_000,
})

const _userRateLimiter = createFixedWindowRateLimiter({
  max: 120,
  windowMs: 60_000,
})

/** Pre-auth flood guard. Exported for unit tests. */
export function checkIpRateLimit(ip: string): boolean {
  return _ipRateLimiter.check(ip)
}

/** Per-actor budget keyed on the JWT subject. Exported for unit tests. */
export function checkUserRateLimit(userId: string): boolean {
  return _userRateLimiter.check(userId)
}

/** Clears both in-process rate-limit maps. For tests only. */
export function _resetRateLimitsForTests(): void {
  _ipRateLimiter.reset()
  _userRateLimiter.reset()
}

const bodySchema = z.object({
  kind: z.enum(['whiteboard', 'canvas']),
  boardId: z.string().uuid(),
})

/** Handle one render-token request. Exported so tests run the real path. */
export async function handleRenderTokenRequest(
  request: Request,
): Promise<Response> {
  if (!checkIpRateLimit(extractClientIp(request))) {
    return jsonError(
      'too_many_requests',
      'Rate limit exceeded. Try again in 60 seconds.',
      429,
      { 'Retry-After': '60' },
    )
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const [scheme, token] = authHeader.split(' ')
  if (scheme.toLowerCase() !== 'bearer' || !token) {
    return jsonError(
      'invalid_token',
      'Authorization: Bearer <collab token> is required.',
      401,
    )
  }

  const { validateCollabToken } = await import('@/lib/oauth/collab-verify')
  let userId: string
  try {
    userId = (await validateCollabToken(token)).sub
  } catch {
    return jsonError(
      'invalid_token',
      'The collaboration token is not valid.',
      401,
    )
  }

  if (!checkUserRateLimit(userId)) {
    return jsonError(
      'too_many_requests',
      'Rate limit exceeded for this user. Try again in 60 seconds.',
      429,
      { 'Retry-After': '60' },
    )
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return jsonError(
      'invalid_request',
      'Content-Type must be application/json',
      400,
    )
  }
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return jsonError('invalid_request', 'Could not parse request body', 400)
  }
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue.path.join('.')
    return jsonError(
      'invalid_request',
      path ? `${path}: ${issue.message}` : issue.message,
      400,
    )
  }
  const { kind, boardId } = parsed.data

  const { getCanvasBoardProjectId, getWhiteboardProjectId } = await import(
    '@/data/resolve-project'
  )
  const projectId =
    kind === 'canvas'
      ? await getCanvasBoardProjectId(boardId)
      : await getWhiteboardProjectId(boardId)
  if (!projectId) {
    return jsonError('NOT_FOUND', 'Board not found.', 404)
  }

  const { requireServerFnRole } = await import('@/lib/auth/require-role')
  try {
    await requireServerFnRole(userId, projectId, 'VIEWER')
  } catch {
    // Same body as an unknown board: a caller without access learns nothing
    // beyond what the 404 above already told a holder of a valid collab JWT.
    return jsonError('NOT_FOUND', 'Board not found.', 404)
  }

  const { signRenderToken } = await import('@/lib/render/render-token')
  const signed = await signRenderToken({ sub: userId, kind, boardId })
  return jsonOk({ token: signed.token, expiresAt: signed.expiresAt })
}

export const Route = createFileRoute('/api/render-token')({
  server: {
    handlers: {
      POST: async ({ request }) => handleRenderTokenRequest(request),
    },
  },
})

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function jsonError(
  error: string,
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error, error_description: message, message }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...extraHeaders,
      },
    },
  )
}

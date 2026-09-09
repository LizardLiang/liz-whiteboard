// src/routes/api/canvas-boards.ts
// Server-to-server endpoint: canvas board lifecycle (create / rename / delete)
// for the MCP backend, which has no session cookie.
//
// WHY THIS ROUTE EXISTS:
//   Canvas board CRUD otherwise lives only in TanStack `createServerFn`
//   handlers behind `requireAuth` — the session-cookie path. The MCP server
//   holds no session cookie, so an agent could add elements to a canvas board
//   but never create one, and a human had to click "new canvas board" first.
//
// WHY HTTP AND NOT A SOCKET NAMESPACE:
//   Element writes ride Socket.IO so co-viewing clients re-render without a
//   reload. Board *creation* has no co-viewing client: the navigator reads the
//   board list on load, not through a subscription. A namespace whose only job
//   is board lifecycle would broadcast into an empty room and add a third
//   handshake to keep in sync — exactly the drift src/lib/socket-handshake.ts
//   warns about.
//
// SECURITY MODEL:
//   - Auth: `Authorization: Bearer <collab-audience JWT>`, validated by
//     `validateCollabToken` — the SAME verifier `authenticateSocketHandshake`
//     calls, so the socket and HTTP paths cannot drift.
//   - The credential is the one /api/collab-token mints. The MCP server's own
//     access token (aud = the MCP resource URI) is deliberately NOT accepted:
//     forwarding it would re-open the confused-deputy hole that endpoint exists
//     to close.
//   - The acting user is the JWT `sub`. Never a body field.
//   - Authorization: `requireServerFnRole(sub, projectId, 'EDITOR')`, the same
//     guard and the same role model the session-cookie server functions use.
//   - Rate limit: 600/60s per IP pre-auth (flood guard) plus 120/60s per
//     JWT subject post-auth (the real per-actor budget). See the block
//     above the limiters.
//
// KNOWN WIDENING (flagged for security review): a collab-audience JWT used to
// mean "may join a collaboration namespace". It now also means "may create or
// delete a canvas board". No new credential was introduced, but the blast
// radius of that audience grew.
//
// NOTE ON 404 vs 403: `requireServerFnRole` deliberately conflates not-found
// with unauthorized (SEC-ERR-03). This route returns 404 for an unknown board
// id BEFORE the role check, because the MCP needs to distinguish a typo from a
// permission problem to report a useful error. Board ids are random UUIDv4, so
// the existence oracle this opens to a holder of a valid collab JWT is
// negligible; the usability gain is not.

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createFixedWindowRateLimiter, extractClientIp } from '@/lib/rate-limit'

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting: two buckets, not the single per-IP bucket this route shipped
// with. That bucket was a 15 / 60s copy of src/routes/api/collab-token.ts, and
// it was wrong here for the reason /api/mcp-lifecycle documents at length:
// `extractClientIp` reads x-forwarded-for, the MCP server calls this route
// DIRECTLY (no proxy, no such header), so every request keyed on the literal
// string 'unknown'. One bucket of 15 writes a minute, shared by every user of
// the MCP server — an agent creating a handful of boards starved everyone else.
//
// The split matches /api/mcp-lifecycle so a future fix lands on both:
//
//   PRE-AUTH, per IP, 600/60s. Only job is to stop an unauthenticated flood
//   from reaching JWT verification and body decode. Not a business limit, and
//   deliberately not the binding constraint on legitimate work.
//
//   POST-AUTH, per JWT subject, 120/60s. The real budget: a bound on one
//   actor, which is what the original 15/60s was trying to express.
//
// Both are in-process and reset on restart, like the ones they replace.
// ─────────────────────────────────────────────────────────────────────────────
const _ipRateLimiter = createFixedWindowRateLimiter({
  max: 600,
  windowMs: 60_000,
})

const _userRateLimiter = createFixedWindowRateLimiter({
  max: 120,
  windowMs: 60_000,
})

/**
 * Pre-auth flood guard. Returns true if the request is within the limit.
 * Exported for unit testing; do not call from outside this module in production.
 */
export function checkIpRateLimit(ip: string): boolean {
  return _ipRateLimiter.check(ip)
}

/**
 * The real per-actor budget, keyed on the authenticated JWT subject.
 * Exported for unit testing; do not call from outside this module in production.
 */
export function checkUserRateLimit(userId: string): boolean {
  return _userRateLimiter.check(userId)
}

/** Clears both in-process rate-limit maps. For tests only. */
export function _resetIpRateLimitForTests(): void {
  _ipRateLimiter.reset()
  _userRateLimiter.reset()
}

// ─────────────────────────────────────────────────────────────────────────────
// Request body: a discriminated union on `op`.
//
// The field schemas mirror createCanvasBoardSchema / updateCanvasBoardSchema in
// @/data/schema rather than importing them, because the union needs `op` and
// `canvasBoardId` alongside them. The data layer re-parses with the real
// schemas before writing, so these are a fail-fast front door, not the
// authority.
// ─────────────────────────────────────────────────────────────────────────────

const nameSchema = z.string().min(1).max(255)

const bodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    name: nameSchema,
    projectId: z.string().uuid(),
    folderId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal('update'),
    canvasBoardId: z.string().uuid(),
    name: nameSchema.optional(),
    folderId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal('delete'),
    canvasBoardId: z.string().uuid(),
  }),
])

/**
 * Handle one canvas-board lifecycle request.
 *
 * Exported so the unit tests exercise the real code path rather than a copy of
 * it. `server.handlers.POST` below is a one-line delegation.
 */
export async function handleCanvasBoardRequest(
  request: Request,
): Promise<Response> {
  // ── Rate limiting (per-IP, fixed window) ───────────────────────────────────
  // Applied before body parsing to avoid resource exhaustion on the body decode
  // path.
  if (!checkIpRateLimit(extractClientIp(request))) {
    return jsonError(
      'too_many_requests',
      'Rate limit exceeded. Try again in 60 seconds.',
      429,
      {
        'Retry-After': '60',
      },
    )
  }

  // ── Authentication ─────────────────────────────────────────────────────────
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
    const payload = await validateCollabToken(token)
    userId = payload.sub
  } catch {
    // The verifier's message names the failing claim; it is not returned to the
    // caller, which is an unauthenticated party at this point.
    return jsonError(
      'invalid_token',
      'The collaboration token is not valid.',
      401,
    )
  }

  // ── Per-actor budget (per JWT subject) ─────────────────────────────────────
  // The real limit. Keyed on the authenticated user rather than the IP, because
  // every request from the MCP server shares one IP — see the header block.
  if (!checkUserRateLimit(userId)) {
    return jsonError(
      'too_many_requests',
      'Rate limit exceeded for this user. Try again in 60 seconds.',
      429,
      { 'Retry-After': '60' },
    )
  }

  // ── Body ───────────────────────────────────────────────────────────────────
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
    return jsonError('invalid_request', formatZodIssue(parsed.error), 400)
  }
  const body = parsed.data

  // ── Resolve the project the operation targets ──────────────────────────────
  const { getCanvasBoardProjectId } = await import('@/data/resolve-project')

  let projectId: string
  if (body.op === 'create') {
    projectId = body.projectId
  } else {
    const resolved = await getCanvasBoardProjectId(body.canvasBoardId)
    if (!resolved) {
      return jsonError('NOT_FOUND', 'Canvas board not found.', 404)
    }
    projectId = resolved
  }

  // ── EDITOR+ gate ───────────────────────────────────────────────────────────
  const { requireServerFnRole } = await import('@/lib/auth/require-role')
  try {
    await requireServerFnRole(userId, projectId, 'EDITOR')
  } catch {
    return jsonError(
      'FORBIDDEN',
      'You do not have access to perform this action.',
      403,
    )
  }

  // ── Perform ────────────────────────────────────────────────────────────────
  const { createCanvasBoard, deleteCanvasBoard, updateCanvasBoard } =
    await import('@/data/canvas-board')
  try {
    if (body.op === 'create') {
      const board = await createCanvasBoard({
        name: body.name,
        projectId: body.projectId,
        folderId: body.folderId ?? null,
      })
      return jsonOk({ board })
    }
    if (body.op === 'update') {
      const board = await updateCanvasBoard(body.canvasBoardId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      })
      return jsonOk({ board })
    }
    const board = await deleteCanvasBoard(body.canvasBoardId)
    return jsonOk({ board })
  } catch (error) {
    // The data layer wraps driver errors in its own message; log it server-side
    // and return a generic failure so no SQL detail reaches the caller.
    console.error('[canvas-boards] operation failed', error)
    return jsonError('server_error', 'The canvas board operation failed.', 500)
  }
}

export const Route = createFileRoute('/api/canvas-boards')({
  server: {
    handlers: {
      POST: async ({ request }) => handleCanvasBoardRequest(request),
    },
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Responses
// ─────────────────────────────────────────────────────────────────────────────

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

/** First Zod issue, rendered as "<path>: <message>" without echoing the value. */
function formatZodIssue(error: z.ZodError): string {
  const rendered = error.issues
    .slice(0, 1)
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('')
  return rendered || 'Invalid request body'
}

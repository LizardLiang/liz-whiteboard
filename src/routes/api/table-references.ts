// src/routes/api/table-references.ts
// Server-to-server endpoint: cross-file table reference lifecycle
// (create / re-target / delete / list) for the MCP backend, which has no
// session cookie. LizMeter #83.
//
// WHY THIS ROUTE EXISTS:
//   Reference CRUD otherwise lives only in TanStack `createServerFn` handlers
//   behind `requireAuth` — the session-cookie path. The MCP server holds no
//   session cookie, so an agent could see a board's references but never make
//   one.
//
// WHY A ROUTE OF ITS OWN:
//   Mirrors /api/canvas-boards rather than joining a shared lifecycle route:
//   the request shape is its own (a reference is addressed by the board it
//   lives on plus the source it points at, not by a single entity id), and a
//   `list` op has no analogue in the lifecycle entities.
//
// SECURITY MODEL — identical to /api/canvas-boards:
//   - Auth: `Authorization: Bearer <collab-audience JWT>`, the same credential
//     /api/collab-token mints and the same verifier the socket handshake uses.
//     The MCP server's own access token is deliberately NOT accepted.
//   - The acting user is the JWT `sub`. Never a body field.
//   - Authorization: `requireServerFnRole(sub, projectId, 'EDITOR')` for the
//     writes, VIEWER for `list` — the same role model the session path uses.
//   - Per-IP rate limit: 15 requests / 60s.
//
// SAME-PROJECT SCOPE: enforced in the data layer, not here. The role check
// below only proves the caller may write to the board they named; it says
// nothing about the board they point AT. `createTableReference` re-checks that
// both live in one project and rejects otherwise.

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createFixedWindowRateLimiter, extractClientIp } from '@/lib/rate-limit'

// Same 15 / 60s budget as /api/canvas-boards and /api/collab-token.
const _rateLimiter = createFixedWindowRateLimiter({
  max: 15,
  windowMs: 60_000,
})

/** Exported for unit testing; do not call from outside this module. */
export function checkIpRateLimit(ip: string): boolean {
  return _rateLimiter.check(ip)
}

/** Clears the in-process rate-limit map. For tests only. */
export function _resetIpRateLimitForTests(): void {
  _rateLimiter.reset()
}

const bodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    whiteboardId: z.string().uuid(),
    sourceWhiteboardId: z.string().uuid(),
    sourceTableId: z.string().uuid(),
    sourceColumnIds: z.array(z.string().uuid()).min(1).max(100),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
  }),
  z.object({
    op: z.literal('update'),
    tableId: z.string().uuid(),
    sourceWhiteboardId: z.string().uuid().optional(),
    sourceTableId: z.string().uuid().optional(),
    sourceColumnIds: z.array(z.string().uuid()).max(100).optional(),
  }),
  z.object({
    op: z.literal('delete'),
    tableId: z.string().uuid(),
  }),
  z.object({
    op: z.literal('list'),
    whiteboardId: z.string().uuid(),
  }),
])

/**
 * Handle one table-reference request.
 *
 * Exported so the unit tests exercise the real code path rather than a copy.
 */
export async function handleTableReferenceRequest(
  request: Request,
): Promise<Response> {
  // Rate limiting runs before body parsing, to avoid resource exhaustion on
  // the decode path.
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
    const payload = await validateCollabToken(token)
    userId = payload.sub
  } catch {
    return jsonError(
      'invalid_token',
      'The collaboration token is not valid.',
      401,
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
    return jsonError('invalid_request', formatZodIssue(parsed.error), 400)
  }
  const body = parsed.data

  // Resolve the project the operation targets. `create` and `list` name the
  // board directly; `update` and `delete` name the reference row, which is a
  // DiagramTable row, so the table resolver finds its project.
  const { getTableProjectId, getWhiteboardProjectId } = await import(
    '@/data/resolve-project'
  )
  let projectId: string
  if (body.op === 'create' || body.op === 'list') {
    const resolved = await getWhiteboardProjectId(body.whiteboardId)
    if (!resolved) {
      return jsonError('NOT_FOUND', 'Whiteboard not found.', 404)
    }
    projectId = resolved
  } else {
    const resolved = await getTableProjectId(body.tableId)
    if (!resolved) {
      return jsonError('NOT_FOUND', 'Table reference not found.', 404)
    }
    projectId = resolved
  }

  const { requireServerFnRole } = await import('@/lib/auth/require-role')
  try {
    await requireServerFnRole(
      userId,
      projectId,
      body.op === 'list' ? 'VIEWER' : 'EDITOR',
    )
  } catch {
    return jsonError(
      'FORBIDDEN',
      'You do not have access to perform this action.',
      403,
    )
  }

  const {
    createTableReference,
    deleteTableReference,
    resolveTableReferences,
    updateTableReference,
  } = await import('@/data/table-reference')

  try {
    if (body.op === 'create') {
      const reference = await createTableReference({
        whiteboardId: body.whiteboardId,
        sourceWhiteboardId: body.sourceWhiteboardId,
        sourceTableId: body.sourceTableId,
        sourceColumnIds: body.sourceColumnIds,
        positionX: body.positionX,
        positionY: body.positionY,
      })
      return jsonOk({ reference })
    }
    if (body.op === 'update') {
      const result = await updateTableReference(body.tableId, {
        ...(body.sourceWhiteboardId !== undefined
          ? { sourceWhiteboardId: body.sourceWhiteboardId }
          : {}),
        ...(body.sourceTableId !== undefined
          ? { sourceTableId: body.sourceTableId }
          : {}),
        ...(body.sourceColumnIds !== undefined
          ? { sourceColumnIds: body.sourceColumnIds }
          : {}),
      })
      return jsonOk({
        reference: result.reference,
        deletedRelationships: result.deletedRelationships,
      })
    }
    if (body.op === 'delete') {
      const reference = await deleteTableReference(body.tableId)
      return jsonOk({ reference })
    }
    const references = await resolveTableReferences(body.whiteboardId)
    return jsonOk({ references })
  } catch (error) {
    // A validation failure from the data layer (cross-project source, a column
    // that belongs to another table, a row that is not a reference) is the
    // caller's mistake, and its message is written for them — pass it through
    // as a 400. Anything else is logged and generalised.
    const message = error instanceof Error ? error.message : ''
    if (isCallerError(message)) {
      return jsonError('invalid_request', message, 400)
    }
    console.error('[table-references] operation failed', error)
    return jsonError(
      'server_error',
      'The table reference operation failed.',
      500,
    )
  }
}

/**
 * True for the data layer's own validation messages, which are safe and useful
 * to return. Matched by their distinctive phrasing rather than an error class,
 * because the data layer throws plain Errors.
 */
function isCallerError(message: string): boolean {
  return [
    'same project',
    'same whiteboard it lives on',
    'does not belong',
    'not a table reference',
    'not found',
    'at least one column',
  ].some((fragment) => message.includes(fragment))
}

export const Route = createFileRoute('/api/table-references')({
  server: {
    handlers: {
      POST: async ({ request }) => handleTableReferenceRequest(request),
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

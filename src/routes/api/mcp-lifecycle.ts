// src/routes/api/mcp-lifecycle.ts
// Server-to-server endpoint: project, folder and ER whiteboard lifecycle
// (create / update / delete) for the MCP backend, which has no session cookie.
//
// WHY THIS ROUTE EXISTS:
//   Project, folder and whiteboard CRUD otherwise lives only in TanStack
//   `createServerFn` handlers behind `requireAuth` — the session-cookie path.
//   The MCP server holds no session cookie, so an agent could add tables to an
//   ER whiteboard but never create one, and could not create the project to put
//   it in. Cold start required a human to click "new project" first. This is the
//   same hole /api/canvas-boards closed for canvas boards, widened to the three
//   entities that were still missing.
//
// WHY ONE ROUTE AND NOT THREE:
//   The three entities share one credential, one rate limiter, one error shape
//   and one authorization model; only the resolver and the required role differ.
//   Three files would be three copies of that boilerplate, and boilerplate
//   copied three times is how a fix lands on one path and not the others.
//   /api/canvas-boards is deliberately NOT folded in here — it ships today and
//   moving a working security-sensitive route is a separate decision.
//
// SECURITY MODEL (identical to /api/canvas-boards):
//   - Auth: `Authorization: Bearer <collab-audience JWT>`, validated by
//     `validateCollabToken` — the SAME verifier `authenticateSocketHandshake`
//     calls, so the socket and HTTP paths cannot drift.
//   - The credential is the one /api/collab-token mints. The MCP server's own
//     access token (aud = the MCP resource URI) is deliberately NOT accepted:
//     forwarding it would re-open the confused-deputy hole that endpoint exists
//     to close.
//   - The acting user is the JWT `sub`. Never a body field. In particular
//     `ownerId` on project creation comes from `sub`; an `ownerId` in the body
//     is ignored, not honoured.
//   - Authorization: `requireServerFnRole(sub, projectId, <role>)`, the same
//     guard and role model the session-cookie server functions use. The role
//     table below mirrors those handlers exactly:
//
//       entity      create           update    delete
//       project     authenticated    ADMIN+    OWNER only
//       folder      EDITOR+          EDITOR+   EDITOR+
//       whiteboard  EDITOR+          EDITOR+   EDITOR+
//
//   - Rate limit: two buckets, NOT the single per-IP bucket the other
//     routes use. 600/60s per IP pre-auth as a flood guard, 120/60s per
//     JWT subject post-auth as the real per-actor budget. See the block
//     above the limiters for why the single bucket is wrong here.
//
// KNOWN WIDENING (flagged for security review): a collab-audience JWT already
// meant "may join a collaboration namespace" and, since the canvas board wave,
// "may create or delete a canvas board". It now also means "may delete an
// entire project and everything in it". No new credential was introduced, but
// the blast radius of that audience grew again. The mitigating facts: the JWT
// is minted only from the MCP's confidential client secret, lives 120 seconds,
// and never reaches a browser — browsers authenticate to the same namespaces by
// session cookie (see src/lib/auth/socket-handshake.ts).
//
// NOTE ON 404 vs 403: `requireServerFnRole` deliberately conflates not-found
// with unauthorized (SEC-ERR-03). Like /api/canvas-boards, this route returns
// 404 for an unknown id on the ops that address an EXISTING row, before the
// role check, because the MCP needs to distinguish a typo from a permission
// problem to report a useful error. Ids are random UUIDv4, so the existence
// oracle this opens to a holder of a valid collab JWT is negligible.
//
// NOTE ON ID VALIDATION: `projectId` on the ops that address an existing
// project is `z.string().min(1)`, not `.uuid()`. That is not an oversight — it
// mirrors projects.ts, which accepts non-UUID seed/legacy ids such as
// "test-project-id" so those projects stay operable. Child-entity creation
// keeps `.uuid()` because the app's own createFolderSchema and
// createWhiteboardSchema do.

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createFixedWindowRateLimiter, extractClientIp } from '@/lib/rate-limit'

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting: two buckets, because the obvious single per-IP bucket is
// wrong here in a way that only shows up in production.
//
// /api/collab-token and /api/canvas-boards limit per IP at 15 / 60s. Copying
// that verbatim looked right and was not: `extractClientIp` reads
// x-forwarded-for, the MCP server calls this route DIRECTLY (no proxy, no such
// header), so every lifecycle request keys on the literal string 'unknown'.
// One bucket, shared by every user of the MCP server — 15 writes a minute for
// everyone at once. An agent organising one project starves every other user.
//
// So the buckets are split by what each is actually for:
//
//   PRE-AUTH, per IP, generous. Its only job is to stop an unauthenticated
//   flood from reaching JWT verification and body decode. It is not a business
//   limit, and it must not be the binding constraint on legitimate work.
//
//   POST-AUTH, per JWT subject, the real budget. This is what "15 per minute"
//   was always trying to express: a bound on one actor. 120/60s allows the
//   bulk organisation an agent legitimately does — creating a folder tree and
//   filing boards into it is dozens of calls in seconds — while still bounding
//   a runaway loop, which is the abuse case that matters now that project
//   creation needs no pre-existing role.
//
// Both are in-process and reset on restart, like the ones they are modelled on.
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
// Request body.
//
// Zod discriminates on a single key, and this route keys on two (entity × op),
// so the body is parsed in two steps: an envelope that validates the pair, then
// the one schema that pair selects. The alternative — a nine-arm z.union —
// reports "no union member matched" for every mistake, which is useless to an
// agent trying to fix its own call.
//
// The field schemas mirror the app's create/update schemas in @/data/schema
// rather than importing them, because each arm needs its own id field
// alongside. The data layer re-parses with the real schemas before writing, so
// these are a fail-fast front door, not the authority.
// ─────────────────────────────────────────────────────────────────────────────

const nameSchema = z.string().min(1).max(255)
const descriptionSchema = z.string().max(1000)

/** Ids of rows that already exist: permissive, matching projects.ts. */
const existingProjectIdSchema = z.string().min(1)

const envelopeSchema = z.object({
  entity: z.enum(['project', 'folder', 'whiteboard']),
  op: z.enum(['create', 'update', 'delete']),
})

const AT_LEAST_ONE = 'Supply at least one field to update.'

const bodySchemas = {
  'project:create': z.object({
    entity: z.literal('project'),
    op: z.literal('create'),
    name: nameSchema,
    description: descriptionSchema.optional(),
  }),
  'project:update': z
    .object({
      entity: z.literal('project'),
      op: z.literal('update'),
      projectId: existingProjectIdSchema,
      name: nameSchema.optional(),
      description: descriptionSchema.optional(),
    })
    .refine((v) => v.name !== undefined || v.description !== undefined, {
      message: AT_LEAST_ONE,
    }),
  'project:delete': z.object({
    entity: z.literal('project'),
    op: z.literal('delete'),
    projectId: existingProjectIdSchema,
  }),

  'folder:create': z.object({
    entity: z.literal('folder'),
    op: z.literal('create'),
    projectId: z.string().uuid(),
    name: nameSchema,
    parentFolderId: z.string().uuid().optional(),
  }),
  // updateFolderSchema in @/data/schema exposes `name` only — a folder cannot
  // be re-parented through the app either, so this route does not invent it.
  'folder:update': z.object({
    entity: z.literal('folder'),
    op: z.literal('update'),
    folderId: z.string().uuid(),
    name: nameSchema,
  }),
  'folder:delete': z.object({
    entity: z.literal('folder'),
    op: z.literal('delete'),
    folderId: z.string().uuid(),
  }),

  'whiteboard:create': z.object({
    entity: z.literal('whiteboard'),
    op: z.literal('create'),
    projectId: z.string().uuid(),
    name: nameSchema,
    folderId: z.string().uuid().optional(),
  }),
  // Deliberately narrower than updateWhiteboardSchema: `projectId` is not
  // accepted, because moving a board to another project would apply the role
  // check to the SOURCE project and write into the destination. `canvasState`
  // and `textSource` have their own server functions and are not board
  // lifecycle.
  'whiteboard:update': z
    .object({
      entity: z.literal('whiteboard'),
      op: z.literal('update'),
      whiteboardId: z.string().uuid(),
      name: nameSchema.optional(),
      folderId: z.string().uuid().nullable().optional(),
    })
    .refine((v) => v.name !== undefined || v.folderId !== undefined, {
      message: AT_LEAST_ONE,
    }),
  'whiteboard:delete': z.object({
    entity: z.literal('whiteboard'),
    op: z.literal('delete'),
    whiteboardId: z.string().uuid(),
  }),
} as const

type BodyKey = keyof typeof bodySchemas
type Body = {
  [K in BodyKey]: z.infer<(typeof bodySchemas)[K]>
}[BodyKey]

/**
 * Handle one MCP lifecycle request.
 *
 * Exported so the unit tests exercise the real code path rather than a copy of
 * it. `server.handlers.POST` below is a one-line delegation.
 */
export async function handleMcpLifecycleRequest(
  request: Request,
): Promise<Response> {
  // ── Pre-auth flood guard (per IP, fixed window) ────────────────────────────
  // Runs before JWT verification and body parsing, so an unauthenticated flood
  // cannot burn CPU on either.
  if (!checkIpRateLimit(extractClientIp(request))) {
    return jsonError(
      'too_many_requests',
      'Rate limit exceeded. Try again in 60 seconds.',
      429,
      { 'Retry-After': '60' },
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

  const envelope = envelopeSchema.safeParse(rawBody)
  if (!envelope.success) {
    return jsonError('invalid_request', formatZodIssue(envelope.error), 400)
  }
  const key: BodyKey = `${envelope.data.entity}:${envelope.data.op}`
  const parsed = bodySchemas[key].safeParse(rawBody)
  if (!parsed.success) {
    return jsonError('invalid_request', formatZodIssue(parsed.error), 400)
  }
  const body: Body = parsed.data

  // ── Resolve the project the operation targets, and the role it needs ───────
  const resolved = await resolveTarget(body)
  if (resolved.notFound) {
    return jsonError('NOT_FOUND', resolved.notFound, 404)
  }

  // ── Role gate ──────────────────────────────────────────────────────────────
  // `project:create` has no project to gate on: any authenticated user may
  // create one, exactly as createProjectFn allows. Every other op resolves a
  // project first and is checked against it.
  if (resolved.projectId !== null) {
    const { requireServerFnRole } = await import('@/lib/auth/require-role')
    try {
      await requireServerFnRole(userId, resolved.projectId, resolved.minRole)
    } catch {
      return jsonError(
        'FORBIDDEN',
        'You do not have access to perform this action.',
        403,
      )
    }
  }

  // ── Perform ────────────────────────────────────────────────────────────────
  try {
    return await perform(body, userId)
  } catch (error) {
    // The data layer wraps driver errors in its own message; log it server-side
    // and return a generic failure so no SQL detail reaches the caller.
    console.error('[mcp-lifecycle] operation failed', error)
    return jsonError('server_error', 'The lifecycle operation failed.', 500)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Target resolution
// ─────────────────────────────────────────────────────────────────────────────

type EffectiveRole = 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER'

interface ResolvedTarget {
  /** null only for `project:create`, which has no project to check. */
  projectId: string | null
  minRole: EffectiveRole
  /** Set when the addressed row does not exist; the caller returns 404. */
  notFound?: string
}

/**
 * Map one request to the project it touches and the role that op requires.
 *
 * Create ops take the project id from the body and let the role check reject an
 * unknown project as 403 — the same choice /api/canvas-boards makes, since a
 * caller naming a project it cannot see should not learn whether it exists.
 * Ops that address an existing row resolve through that row and report 404 when
 * it is missing, so the MCP can tell a typo from a permission problem.
 */
async function resolveTarget(body: Body): Promise<ResolvedTarget> {
  if (body.entity === 'project') {
    if (body.op === 'create') {
      return { projectId: null, minRole: 'OWNER' }
    }
    const { findProjectById } = await import('@/data/project')
    const project = await findProjectById(body.projectId)
    if (!project) {
      return {
        projectId: null,
        minRole: 'OWNER',
        notFound: 'Project not found.',
      }
    }
    return {
      projectId: body.projectId,
      minRole: body.op === 'delete' ? 'OWNER' : 'ADMIN',
    }
  }

  if (body.entity === 'folder') {
    if (body.op === 'create') {
      return { projectId: body.projectId, minRole: 'EDITOR' }
    }
    const { getFolderProjectId } = await import('@/data/resolve-project')
    const projectId = await getFolderProjectId(body.folderId)
    if (!projectId) {
      return {
        projectId: null,
        minRole: 'EDITOR',
        notFound: 'Folder not found.',
      }
    }
    return { projectId, minRole: 'EDITOR' }
  }

  if (body.op === 'create') {
    return { projectId: body.projectId, minRole: 'EDITOR' }
  }
  const { getWhiteboardProjectId } = await import('@/data/resolve-project')
  const projectId = await getWhiteboardProjectId(body.whiteboardId)
  if (!projectId) {
    return {
      projectId: null,
      minRole: 'EDITOR',
      notFound: 'Whiteboard not found.',
    }
  }
  return { projectId, minRole: 'EDITOR' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution — every arm delegates to the same data-layer function the
// session-cookie server functions call. Nothing is reimplemented here.
// ─────────────────────────────────────────────────────────────────────────────

async function perform(body: Body, userId: string): Promise<Response> {
  if (body.entity === 'project') {
    const { createProject, deleteProject, updateProject } = await import(
      '@/data/project'
    )
    if (body.op === 'create') {
      // ownerId comes from the JWT subject. An ownerId in the body is not read.
      const project = await createProject({
        name: body.name,
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ownerId: userId,
      })
      return jsonOk({ project })
    }
    if (body.op === 'update') {
      const project = await updateProject(body.projectId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
      })
      return jsonOk({ project })
    }
    const project = await deleteProject(body.projectId)
    return jsonOk({ project })
  }

  if (body.entity === 'folder') {
    const { createFolder, deleteFolder, updateFolder } = await import(
      '@/data/folder'
    )
    if (body.op === 'create') {
      const folder = await createFolder({
        name: body.name,
        projectId: body.projectId,
        ...(body.parentFolderId !== undefined
          ? { parentFolderId: body.parentFolderId }
          : {}),
      })
      return jsonOk({ folder })
    }
    if (body.op === 'update') {
      const folder = await updateFolder(body.folderId, { name: body.name })
      return jsonOk({ folder })
    }
    const folder = await deleteFolder(body.folderId)
    return jsonOk({ folder })
  }

  const { createWhiteboard, deleteWhiteboard, updateWhiteboard } = await import(
    '@/data/whiteboard'
  )
  if (body.op === 'create') {
    const whiteboard = await createWhiteboard({
      name: body.name,
      projectId: body.projectId,
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
    })
    return jsonOk({ whiteboard })
  }
  if (body.op === 'update') {
    const whiteboard = await updateWhiteboard(body.whiteboardId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.folderId !== undefined
        ? { folderId: body.folderId ?? undefined }
        : {}),
    })
    return jsonOk({ whiteboard })
  }
  const whiteboard = await deleteWhiteboard(body.whiteboardId)
  return jsonOk({ whiteboard })
}

export const Route = createFileRoute('/api/mcp-lifecycle')({
  server: {
    handlers: {
      POST: async ({ request }) => handleMcpLifecycleRequest(request),
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

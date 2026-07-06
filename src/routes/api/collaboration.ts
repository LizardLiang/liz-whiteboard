// src/routes/api/collaboration.ts
// Socket.IO server integration for real-time collaboration

import { Server as SocketIOServer } from 'socket.io'
import { z } from 'zod'
import type { Server as HTTPServer } from 'node:http'
import type { CursorPosition } from '@/data/schema'
import type { EffectiveRole } from '@/data/permission'
import {
  createCollaborationSession,
  deleteCollaborationSession,
  deleteStaleSession,
  findActiveCollaborators,
  updateCollaborationSession,
  updateSessionActivity,
} from '@/data/collaboration'
import {
  areaMoveBroadcastSchema,
  createAreaSchema,
  createColumnSchema,
  createRelationshipSchema,
  createTableSchema,
  reorderColumnsSchema,
  tableMoveBulkBroadcastSchema,
  updateAreaSchema,
  updateColumnSchema,
  updateRelationshipSchema,
  updateTableSchema,
} from '@/data/schema'
import {
  createDiagramTable,
  deleteDiagramTable,
  findDiagramTableById,
  findDiagramTablesByWhiteboardId,
  initDiagramTablePosition,
  updateDiagramTable,
  updateDiagramTablePosition,
} from '@/data/diagram-table'
import { findWhiteboardByIdWithDiagram } from '@/data/whiteboard'
import {
  createArea,
  deleteArea,
  findAreaById,
  moveAreaAndMembers,
  removeTableFromAreas,
  updateArea,
} from '@/data/area'
import {
  createColumn,
  deleteColumn,
  duplicateColumn,
  findColumnById,
  findColumnsByTableId,
  reorderColumns,
  updateColumn,
} from '@/data/column'
import {
  assertRelationshipEndpointsValid,
  createRelationship,
  deleteRelationship,
  findRelationshipById,
  updateRelationship,
} from '@/data/relationship'
import { parseSessionCookie } from '@/lib/auth/cookies'
import { validateSessionToken } from '@/lib/auth/session'
import { validateCollabToken } from '@/lib/oauth/collab-verify'
import { requireRole } from '@/lib/auth/require-role'
import { db } from '@/db'

// ---------------------------------------------------------------------------
// FR-022 — Sender acknowledgement type
// ---------------------------------------------------------------------------

/**
 * Ack callback payload for MCP write tools.
 * Passed as the trailing callback argument when a client emits with emitWithAck.
 * Browser clients emit without a callback (cb is undefined) — always use cb?.().
 */
type AckResult =
  | {
      ok: true
      entity: unknown
      cascade?: { relationships?: number; columns?: number }
    }
  | {
      ok: false
      code:
        | 'VALIDATION_ERROR'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'SESSION_EXPIRED'
        | 'INTERNAL_ERROR'
      message: string
    }

/**
 * Ack callback payload for the area:move atomic-drag handler
 * (area-atomic-move fix). Unlike AckResult, the success case carries no
 * `entity` — the client already applied the move optimistically during the
 * drag and only needs pass/fail plus a failure reason to roll back on.
 */
type MoveAckResult =
  | { ok: true }
  | {
      ok: false
      code:
        | 'VALIDATION_ERROR'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'SESSION_EXPIRED'
        | 'INTERNAL_ERROR'
      message: string
    }

/**
 * Socket.IO server instance
 * Initialized on first HTTP server creation
 */
let io: SocketIOServer | null = null

/**
 * Initialize Socket.IO server with HTTP server
 * @param httpServer - Node.js HTTP server instance
 * @returns Socket.IO server instance
 */
export function initializeSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (io) {
    return io
  }

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || true,
      methods: ['GET', 'POST'],
      credentials: true, // Required for cookies to be sent with handshake
    },
    transports: ['websocket', 'polling'],
  })

  // Setup namespace pattern for whiteboards (auth middleware applied inside)
  setupWhiteboardNamespace(io)

  // Cleanup stale sessions every 5 minutes
  setInterval(
    async () => {
      try {
        const deletedCount = await deleteStaleSession()
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} stale collaboration sessions`)
        }
      } catch (error) {
        console.error('Failed to cleanup stale sessions:', error)
      }
    },
    5 * 60 * 1000,
  )

  console.log('Socket.IO server initialized')
  return io
}

/**
 * Get Socket.IO server instance
 * @returns Socket.IO server instance or null if not initialized
 */
export function getSocketIO(): SocketIOServer | null {
  return io
}

/**
 * Setup whiteboard namespace with connection handlers
 * Namespace pattern: /whiteboard/:whiteboardId
 */
function setupWhiteboardNamespace(ioServer: SocketIOServer): void {
  // Dynamic namespace for whiteboards
  const whiteboardNsp = ioServer.of(/^\/whiteboard\/[\w-]+$/)

  // Auth middleware: runs on EVERY connection attempt to this namespace.
  //
  // Two auth paths (in priority order):
  //
  // 1. JWT path (MCP server): the MCP backend sends a short-lived collab-audience
  //    JWT in socket.handshake.auth.token (set via socket.io SetAuth on the Go
  //    socket.io-client-go). The JWT was issued by /api/collab-token and has:
  //      iss=AS issuer, aud=COLLAB_RESOURCE_URI, sub=User.id, exp=now+120s.
  //    On success: socket.data.userId=sub, socket.data.sessionExpiresAt=exp*1000.
  //
  // 2. Cookie path (browser app, existing): reads session_token cookie from
  //    handshake headers and validates via validateSessionToken. Unchanged.
  //
  // The two paths are mutually exclusive per connection; JWT path is tried first.
  whiteboardNsp.use(async (socket, next) => {
    try {
      // --- JWT path (MCP server) ---
      const authToken = (socket.handshake.auth as Record<string, unknown>)
        ?.token
      if (authToken && typeof authToken === 'string') {
        try {
          const payload = await validateCollabToken(authToken)
          socket.data.userId = payload.sub
          socket.data.sessionId = '' // no DB session for JWT auth path
          socket.data.sessionExpiresAt = payload.exp * 1000
          return next()
        } catch (jwtErr) {
          // JWT present but invalid — reject immediately rather than falling
          // through to cookie path. A caller that sends auth.token but has an
          // invalid JWT should not silently succeed via cookie.
          console.warn('[collab] JWT auth failed:', jwtErr)
          return next(new Error('UNAUTHORIZED'))
        }
      }

      // --- Cookie path (browser app) ---
      const cookieHeader = socket.handshake.headers.cookie ?? ''
      const token = parseSessionCookie(cookieHeader)
      if (!token) {
        return next(new Error('UNAUTHORIZED'))
      }

      const authResult = await validateSessionToken(token)
      if (!authResult) {
        return next(new Error('UNAUTHORIZED'))
      }

      // Attach auth data to socket for use in event handlers
      socket.data.userId = authResult.user.id
      socket.data.sessionId = authResult.session.id
      socket.data.sessionExpiresAt = authResult.session.expiresAt.getTime()
      next()
    } catch (error) {
      next(new Error('UNAUTHORIZED'))
    }
  })

  whiteboardNsp.on('connection', async (socket) => {
    // Extract whiteboard ID from namespace
    const namespace = socket.nsp.name
    const whiteboardId = namespace.replace('/whiteboard/', '')

    // userId is set by the io.use() handshake middleware (authenticated)
    const userId = socket.data.userId as string

    if (!userId) {
      socket.disconnect(true)
      return
    }

    console.log(
      `User ${userId} connected to whiteboard ${whiteboardId} (socket: ${socket.id})`,
    )

    // Authorization check: verify the user has at least VIEWER access to this
    // whiteboard's project before creating any session or emitting any data.
    // The io.use() handshake middleware only validates authentication, not
    // project-level RBAC — any authenticated user could otherwise join any
    // whiteboard's live collab namespace. Reuses requireRole (AD-1) so the
    // emitted payload matches the canonical SEC-ERR-02 shape the client expects
    // ({ code: 'FORBIDDEN', event, message }) and fail-closed behavior is shared
    // with every other gated event.
    if (await requireRole(socket, whiteboardId, 'connection', 'VIEWER')) {
      socket.disconnect(true)
      return
    }

    try {
      // Create collaboration session
      const session = await createCollaborationSession({
        whiteboardId,
        userId,
        socketId: socket.id,
      })

      // Get active collaborators
      const activeUsers = await findActiveCollaborators(whiteboardId)

      // Send connection acknowledgment with active users
      socket.emit('connected', {
        sessionId: session.id,
        activeUsers: activeUsers
          .filter((s) => s.socketId !== socket.id)
          .map((s) => ({
            userId: s.userId,
            cursor: s.cursor as CursorPosition | null,
            lastActivityAt: s.lastActivityAt.toISOString(),
          })),
      })

      // Notify other users of new connection
      socket.broadcast.emit('user:connected', {
        userId,
        sessionId: session.id,
      })

      // Setup event handlers
      setupCollaborationEventHandlers(socket, whiteboardId, userId)

      // Handle disconnection
      socket.on('disconnect', async () => {
        console.log(
          `User ${userId} disconnected from whiteboard ${whiteboardId}`,
        )

        try {
          await deleteCollaborationSession(socket.id)
          socket.broadcast.emit('user:disconnected', { userId })
        } catch (error) {
          console.error('Failed to cleanup session on disconnect:', error)
        }
      })
    } catch (error) {
      console.error('Failed to setup collaboration session:', error)
      socket.emit('error', {
        event: 'connection',
        error: 'SETUP_FAILED',
        message: 'Failed to establish collaboration session',
      })
      socket.disconnect(true)
    }
  })
}

async function safeUpdateSessionActivity(socketId: string): Promise<void> {
  try {
    await updateSessionActivity(socketId)
  } catch {
    // stale session — non-fatal
  }
}

/**
 * Check if the session is still valid (in-memory comparison, no DB round-trip).
 * Returns true if expired.
 */
function isSessionExpired(socket: any): boolean {
  return Date.now() > (socket.data.sessionExpiresAt as number)
}

/**
 * Check that the socket user has at least `minRole` on the whiteboard's project
 * (default: EDITOR, for schema-mutating handlers). Returns true if access was
 * denied (caller should return immediately). On denial, emits the canonical
 * SEC-ERR-02 error event on the socket. Wraps requireRole from
 * src/lib/auth/require-role.ts (AD-1).
 */
async function denyIfInsufficientPermission(
  socket: { data: { userId: string }; emit: (e: string, p: any) => void },
  whiteboardId: string,
  eventName: string,
  minRole: EffectiveRole = 'EDITOR',
): Promise<boolean> {
  return requireRole(socket, whiteboardId, eventName, minRole)
}

/**
 * Setup event handlers for collaboration events
 */
function setupCollaborationEventHandlers(
  socket: any,
  whiteboardId: string,
  userId: string,
): void {
  // Cursor update (throttled by client to 60Hz)
  socket.on('cursor:update', async (data: { x: number; y: number }) => {
    try {
      // Update cursor position in session
      await updateCollaborationSession(socket.id, {
        cursor: { x: data.x, y: data.y },
      })

      // Broadcast to other users
      socket.broadcast.emit('cursor:moved', {
        userId,
        x: data.x,
        y: data.y,
      })
    } catch (error) {
      console.error('Failed to update cursor:', error)
    }
  })

  // Activity heartbeat
  socket.on('activity:heartbeat', async (data: { action: string }) => {
    try {
      await updateSessionActivity(socket.id)
    } catch (error) {
      console.error('Failed to update activity:', error)
    }
  })

  // Sync request (when client reconnects and needs full state).
  // Re-checks role on every call (not just at connection time) so a member
  // whose access is revoked mid-session loses read access before disconnect.
  // VIEWER minimum — sync is a read, not a mutation.
  socket.on('sync:request', async () => {
    if (
      await denyIfInsufficientPermission(
        socket,
        whiteboardId,
        'sync:request',
        'VIEWER',
      )
    ) {
      return
    }

    try {
      const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId)

      if (!whiteboard) {
        socket.emit('error', {
          event: 'sync:request',
          error: 'NOT_FOUND',
          message: 'Whiteboard not found',
        })
        return
      }

      socket.emit('sync:data', { whiteboard })
    } catch (error) {
      console.error('Failed to sync whiteboard data:', error)
      socket.emit('error', {
        event: 'sync:request',
        error: 'SYNC_FAILED',
        message: 'Failed to sync whiteboard data',
      })
    }
  })

  // ========================================================================
  // Table mutation events
  // ========================================================================

  // Table creation
  socket.on(
    'table:create',
    async (data: any, cb?: (res: AckResult) => void) => {
      // Check session expiry
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      // Check permission
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'table:create')
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        // Validate input
        const validated = createTableSchema.parse({
          ...data,
          whiteboardId,
        })

        // Create table in database
        const table = await createDiagramTable(validated)

        // Broadcast to other users
        socket.broadcast.emit('table:created', {
          ...table,
          createdBy: userId,
        })

        // FR-022: ack to sender (MCP or any emitWithAck caller)
        cb?.({ ok: true, entity: table })
      } catch (error) {
        console.error('Failed to create table:', error)
        const message =
          error instanceof Error ? error.message : 'Failed to create table'
        socket.emit('error', {
          event: 'table:create',
          error: 'VALIDATION_ERROR',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Table position update (dragging)
  socket.on(
    'table:move',
    async (
      data: {
        tableId: string
        positionX: number
        positionY: number
        isInit?: boolean
      },
      cb?: (res: AckResult) => void,
    ) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'table:move')
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        // Ownership check: verify table belongs to this whiteboard (IDOR prevention)
        const table = await findDiagramTableById(data.tableId)
        if (!table) {
          socket.emit('error', {
            event: 'table:move',
            error: 'NOT_FOUND',
            message: 'Table not found',
            tableId: data.tableId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Table not found' })
          return
        }
        if (table.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'table:move',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId: data.tableId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
          })
          return
        }

        // First-write-wins guard for client-side position initialization.
        //
        // When isInit=true the client is writing the first non-overlapping
        // position it computed after measuring the rendered node. We use an
        // atomic conditional UPDATE (WHERE positionX IS NULL) to eliminate the
        // TOCTOU race that exists with a read-then-write pattern: two concurrent
        // handlers could both observe positionX=null on the earlier read and
        // both write, making it last-write-wins instead of first-write-wins.
        //
        // initDiagramTablePosition returns { changes, row }:
        //   changes=1 → this caller won; broadcast and ack the written position.
        //   changes=0 → another client already set the position; ack the current
        //               DB value without broadcasting, so all clients converge.
        const isInit = Boolean(data.isInit)
        if (isInit) {
          const { changes, row } = await initDiagramTablePosition(
            data.tableId,
            data.positionX,
            data.positionY,
          )
          if (changes > 0) {
            // This client won the race — broadcast so other clients update.
            socket.broadcast.emit('table:moved', {
              tableId: data.tableId,
              positionX: data.positionX,
              positionY: data.positionY,
              updatedBy: userId,
            })
            cb?.({
              ok: true,
              entity: {
                id: data.tableId,
                positionX: data.positionX,
                positionY: data.positionY,
              },
            })
          } else {
            // Another client already initialized — ack the authoritative DB value.
            cb?.({
              ok: true,
              entity: {
                id: data.tableId,
                positionX: row?.positionX ?? null,
                positionY: row?.positionY ?? null,
              },
            })
          }
          await safeUpdateSessionActivity(socket.id)
          return
        }

        // Regular (non-init) move — unconditional update + broadcast.
        await updateDiagramTablePosition(
          data.tableId,
          data.positionX,
          data.positionY,
        )

        // Broadcast to other users
        socket.broadcast.emit('table:moved', {
          tableId: data.tableId,
          positionX: data.positionX,
          positionY: data.positionY,
          updatedBy: userId,
        })

        // FR-022: ack to sender
        cb?.({
          ok: true,
          entity: {
            id: data.tableId,
            positionX: data.positionX,
            positionY: data.positionY,
          },
        })
      } catch (error) {
        console.error('Failed to move table:', error)
        const message = 'Failed to update table position'
        socket.emit('error', {
          event: 'table:move',
          error: 'UPDATE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Bulk table position update (Auto Layout broadcast re-emit).
  // Persistence already happened via the updateTablePositionsBulk server function;
  // this handler only fans out the event to other clients in the same whiteboard
  // namespace. The originator's client emits this event after the server function
  // resolves successfully (mirrors the existing single-table table:move pattern).
  // Apollo R2-1: includes the standard auth prelude used by all other handlers.
  socket.on(
    'table:move:bulk',
    async (data: {
      positions: Array<{
        tableId: string
        positionX: number
        positionY: number
      }>
      userId: string
    }) => {
      // Standard auth prelude — matches every other handler in this file (Apollo R2-1).
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'table:move:bulk',
        )
      )
        return

      // Full schema validation before re-broadcasting.
      // Rejects NaN/Infinity coordinates and non-UUID IDs that would corrupt
      // every collaborator's React Flow canvas (B1 security fix).
      const parsed = tableMoveBulkBroadcastSchema.safeParse(data)
      if (!parsed.success) {
        socket.emit('error', {
          event: 'table:move:bulk',
          error: 'VALIDATION_ERROR',
          message: 'Invalid table:move:bulk payload',
        })
        return
      }

      // Re-broadcast to every OTHER client in this whiteboard namespace.
      // broadcastToWhiteboard excludes the sender by socketId, so the originator
      // does not receive a copy of its own emit.
      // WARNING-5 fix: override the client-supplied userId with the server-validated
      // socket.data.userId (the `userId` in scope here is set from socket.data.userId
      // by the connection handler before setupCollaborationEventHandlers is called).
      broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', {
        ...parsed.data,
        userId,
      })

      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Table update (name, description, etc.)
  socket.on(
    'table:update',
    async (
      data: { tableId: string; [key: string]: any },
      cb?: (res: AckResult) => void,
    ) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'table:update')
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        const { tableId, ...updateData } = data

        // Ownership check: verify table belongs to this whiteboard (IDOR prevention)
        const tableRecord = await findDiagramTableById(tableId)
        if (!tableRecord) {
          socket.emit('error', {
            event: 'table:update',
            error: 'NOT_FOUND',
            message: 'Table not found',
            tableId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Table not found' })
          return
        }
        if (tableRecord.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'table:update',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
          })
          return
        }

        // Validate input
        const validated = updateTableSchema.parse(updateData)

        // Update table in database
        const updatedTable = await updateDiagramTable(tableId, validated)

        // Broadcast to other users
        socket.broadcast.emit('table:updated', {
          tableId,
          ...validated,
          updatedBy: userId,
        })

        // FR-022: ack to sender
        cb?.({ ok: true, entity: updatedTable })
      } catch (error) {
        console.error('Failed to update table:', error)
        const message =
          error instanceof Error ? error.message : 'Failed to update table'
        socket.emit('error', {
          event: 'table:update',
          error: 'UPDATE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Table deletion
  socket.on(
    'table:delete',
    async (data: { tableId: string }, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'table:delete')
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        // Validate input (HIGH-002: missing UUID validation)
        const { tableId } = z.object({ tableId: z.string().uuid() }).parse(data)

        // Ownership check: verify table belongs to this whiteboard (HIGH-001: IDOR)
        const table = await findDiagramTableById(tableId)
        if (!table) {
          socket.emit('error', {
            event: 'table:delete',
            error: 'NOT_FOUND',
            message: 'Table not found',
            tableId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Table not found' })
          return
        }
        if (table.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'table:delete',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
          })
          return
        }

        // FR-022: count cascade entities before delete (for ack payload)
        const relationshipCount = Number(
          (
            db
              .prepare(
                'SELECT count(*) AS c FROM "Relationship" WHERE "sourceTableId" = ? OR "targetTableId" = ?',
              )
              .get(tableId, tableId) as { c: number }
          ).c,
        )
        const columnCount = Number(
          (
            db
              .prepare('SELECT count(*) AS c FROM "Column" WHERE "tableId" = ?')
              .get(tableId) as { c: number }
          ).c,
        )

        // Delete table from database (cascade deletes columns and relationships)
        await deleteDiagramTable(tableId)

        // GH #106: drop the deleted table from any subject area's membership so
        // no area keeps a dangling member id, and tell peers about the change.
        const affectedAreas = await removeTableFromAreas(whiteboardId, tableId)
        for (const area of affectedAreas) {
          socket.broadcast.emit('area:updated', {
            areaId: area.id,
            memberTableIds: area.memberTableIds,
            updatedBy: userId,
          })
        }

        // Broadcast to other users
        socket.broadcast.emit('table:deleted', {
          tableId,
          deletedBy: userId,
        })

        // FR-022: ack to sender with cascade counts
        cb?.({
          ok: true,
          entity: { id: tableId },
          cascade: { relationships: relationshipCount, columns: columnCount },
        })
      } catch (error) {
        console.error('Failed to delete table:', error)
        const message = 'Failed to delete table'
        socket.emit('error', {
          event: 'table:delete',
          error: 'DELETE_FAILED',
          message,
          tableId: data.tableId,
        })
        cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // ========================================================================
  // Area (subject area) mutation events — GH #106
  // ========================================================================

  // Area creation
  socket.on(
    'area:create',
    async (data: any, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'area:create')
      ) {
        cb?.({ ok: false, code: 'FORBIDDEN', message: 'Insufficient permission' })
        return
      }

      try {
        const validated = createAreaSchema.parse({ ...data, whiteboardId })
        const area = await createArea(validated)
        socket.broadcast.emit('area:created', { ...area, createdBy: userId })
        cb?.({ ok: true, entity: area })
      } catch (error) {
        console.error('Failed to create area:', error)
        const message =
          error instanceof Error ? error.message : 'Failed to create area'
        socket.emit('error', {
          event: 'area:create',
          error: 'VALIDATION_ERROR',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Area update (rename, recolor, resize/move, membership change)
  socket.on(
    'area:update',
    async (
      data: { areaId: string; [key: string]: any },
      cb?: (res: AckResult) => void,
    ) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'area:update')
      ) {
        cb?.({ ok: false, code: 'FORBIDDEN', message: 'Insufficient permission' })
        return
      }

      try {
        const { areaId, ...updateData } = data

        // Ownership check: verify area belongs to this whiteboard (IDOR guard)
        const areaRecord = await findAreaById(areaId)
        if (!areaRecord) {
          socket.emit('error', {
            event: 'area:update',
            error: 'NOT_FOUND',
            message: 'Area not found',
            areaId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Area not found' })
          return
        }
        if (areaRecord.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'area:update',
            error: 'FORBIDDEN',
            message: 'Area does not belong to this whiteboard',
            areaId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Area does not belong to this whiteboard',
          })
          return
        }

        const validated = updateAreaSchema.parse(updateData)
        const updatedArea = await updateArea(areaId, validated)
        socket.broadcast.emit('area:updated', {
          areaId,
          ...validated,
          updatedBy: userId,
        })
        cb?.({ ok: true, entity: updatedArea })
      } catch (error) {
        console.error('Failed to update area:', error)
        const message =
          error instanceof Error ? error.message : 'Failed to update area'
        socket.emit('error', {
          event: 'area:update',
          error: 'UPDATE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Area atomic move (drag) — area-atomic-move fix for collaborator
  // detachment. Persists the area's new position AND every member table's
  // new position in a single transaction, then rebroadcasts one area:moved
  // event, so peers apply the whole move in one render tick. Replaces the
  // old drag path (area:update + updateTablePositionsBulk HTTP call +
  // table:move:bulk broadcast), which had two separate peer-facing timings
  // and a silent partial-persist-failure gap. area:update remains the event
  // for rename/recolor/resize/membership changes — NOT for drag position.
  socket.on(
    'area:move',
    async (
      data: {
        areaId: string
        positionX: number
        positionY: number
        members: Array<{
          tableId: string
          positionX: number
          positionY: number
        }>
      },
      cb?: (res: MoveAckResult) => void,
    ) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (await denyIfInsufficientPermission(socket, whiteboardId, 'area:move')) {
        cb?.({ ok: false, code: 'FORBIDDEN', message: 'Insufficient permission' })
        return
      }

      try {
        // Full schema validation before persisting — rejects NaN/Infinity
        // coordinates and non-UUID ids that would corrupt every
        // collaborator's canvas (mirrors tableMoveBulkBroadcastSchema).
        const parsed = areaMoveBroadcastSchema.safeParse(data)
        if (!parsed.success) {
          const message = 'Invalid area:move payload'
          socket.emit('error', {
            event: 'area:move',
            error: 'VALIDATION_ERROR',
            message,
          })
          cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
          return
        }
        const { areaId, positionX, positionY, members } = parsed.data

        // IDOR guard: the area must belong to this whiteboard, and every
        // member table id must also belong to this whiteboard — mirrors
        // updateTablePositionsBulk's owned-set check (src/lib/server-functions.ts).
        const [areaRecord, ownedTables] = await Promise.all([
          findAreaById(areaId),
          findDiagramTablesByWhiteboardId(whiteboardId),
        ])
        if (!areaRecord) {
          const message = 'Area not found'
          socket.emit('error', {
            event: 'area:move',
            error: 'NOT_FOUND',
            message,
            areaId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message })
          return
        }
        if (areaRecord.whiteboardId !== whiteboardId) {
          const message = 'Area does not belong to this whiteboard'
          socket.emit('error', {
            event: 'area:move',
            error: 'FORBIDDEN',
            message,
            areaId,
          })
          cb?.({ ok: false, code: 'FORBIDDEN', message })
          return
        }
        const ownedIds = new Set(ownedTables.map((t) => t.id))
        const hasForeignMember = members.some((m) => !ownedIds.has(m.tableId))
        if (hasForeignMember) {
          const message = 'Member table does not belong to this whiteboard'
          socket.emit('error', {
            event: 'area:move',
            error: 'FORBIDDEN',
            message,
            areaId,
          })
          cb?.({ ok: false, code: 'FORBIDDEN', message })
          return
        }

        // Persist area + all members atomically (one transaction).
        await moveAreaAndMembers(areaId, { positionX, positionY }, members)

        // Broadcast to peers only AFTER the write succeeds — one event,
        // one render tick, no detachment window.
        socket.broadcast.emit('area:moved', {
          areaId,
          positionX,
          positionY,
          members,
          movedBy: userId,
        })
        cb?.({ ok: true })
      } catch (error) {
        console.error('Failed to move area:', error)
        const message = 'Failed to move area'
        socket.emit('error', {
          event: 'area:move',
          error: 'UPDATE_FAILED',
          message,
          areaId: data.areaId,
        })
        cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Area deletion — removes the grouping only; member tables are untouched
  socket.on(
    'area:delete',
    async (data: { areaId: string }, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(socket, whiteboardId, 'area:delete')
      ) {
        cb?.({ ok: false, code: 'FORBIDDEN', message: 'Insufficient permission' })
        return
      }

      try {
        const { areaId } = z.object({ areaId: z.string().uuid() }).parse(data)

        const area = await findAreaById(areaId)
        if (!area) {
          socket.emit('error', {
            event: 'area:delete',
            error: 'NOT_FOUND',
            message: 'Area not found',
            areaId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Area not found' })
          return
        }
        if (area.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'area:delete',
            error: 'FORBIDDEN',
            message: 'Area does not belong to this whiteboard',
            areaId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Area does not belong to this whiteboard',
          })
          return
        }

        await deleteArea(areaId)
        socket.broadcast.emit('area:deleted', { areaId, deletedBy: userId })
        cb?.({ ok: true, entity: { id: areaId } })
      } catch (error) {
        console.error('Failed to delete area:', error)
        const message = 'Failed to delete area'
        socket.emit('error', {
          event: 'area:delete',
          error: 'DELETE_FAILED',
          message,
          areaId: data.areaId,
        })
        cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // ========================================================================
  // Column mutation events
  // ========================================================================

  // Column creation
  socket.on(
    'column:create',
    async (data: any, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'column:create',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      let validated: ReturnType<typeof createColumnSchema.parse> | undefined
      try {
        // Validate input
        validated = createColumnSchema.parse(data)

        // Ownership check: verify the target table belongs to this whiteboard (IDOR prevention)
        const ownerTable = await findDiagramTableById(validated.tableId)
        if (!ownerTable || ownerTable.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'column:create',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId: validated.tableId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
          })
          return
        }

        // Create column in database
        const column = await createColumn(validated)

        // Broadcast to other users
        socket.broadcast.emit('column:created', {
          ...column,
          createdBy: userId,
        })

        // Also confirm creation back to the originating socket so the client
        // can replace its optimistic temp ID with the real database ID.
        socket.emit('column:created', {
          ...column,
          createdBy: userId,
        })

        // FR-022: ack callback for MCP write tools
        cb?.({ ok: true, entity: column })
      } catch (error) {
        console.error('Failed to create column:', error)
        socket.emit('error', {
          event: 'column:create',
          error: 'VALIDATION_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to create column',
          name: validated?.name,
          tableId: validated?.tableId,
        })
        cb?.({
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to create column',
        })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Column update
  socket.on(
    'column:update',
    async (
      data: { columnId: string; [key: string]: unknown },
      cb?: (res: AckResult) => void,
    ) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'column:update',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        const { columnId, ...updateData } = data

        // Ownership check: verify column's table belongs to this whiteboard (IDOR prevention)
        const columnRecord = await findColumnById(columnId)
        if (!columnRecord) {
          socket.emit('error', {
            event: 'column:update',
            error: 'NOT_FOUND',
            message: 'Column not found',
            columnId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Column not found' })
          return
        }
        const ownerTable = await findDiagramTableById(columnRecord.tableId)
        if (!ownerTable || ownerTable.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'column:update',
            error: 'FORBIDDEN',
            message: 'Column does not belong to this whiteboard',
            columnId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Column does not belong to this whiteboard',
          })
          return
        }

        // Validate input
        const validated = updateColumnSchema.parse(updateData)

        // Update column in database
        const column = await updateColumn(columnId, validated)

        // Broadcast to other users
        socket.broadcast.emit('column:updated', {
          columnId,
          tableId: column.tableId,
          ...validated,
          updatedBy: userId,
        })

        // FR-022: ack to sender
        cb?.({ ok: true, entity: column })
      } catch (error) {
        console.error('Failed to update column:', error)
        const message =
          error instanceof Error ? error.message : 'Failed to update column'
        socket.emit('error', {
          event: 'column:update',
          error: 'UPDATE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Column deletion
  socket.on(
    'column:delete',
    async (data: { columnId: string }, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'column:delete',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        // Get column before deletion to know tableId
        const column = await findColumnById(data.columnId)
        if (!column) {
          socket.emit('error', {
            event: 'column:delete',
            error: 'NOT_FOUND',
            message: 'Column not found',
            columnId: data.columnId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Column not found' })
          return
        }

        // Ownership check: verify column's table belongs to this whiteboard (IDOR prevention)
        const ownerTable = await findDiagramTableById(column.tableId)
        if (!ownerTable || ownerTable.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'column:delete',
            error: 'FORBIDDEN',
            message: 'Column does not belong to this whiteboard',
            columnId: data.columnId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Column does not belong to this whiteboard',
          })
          return
        }

        // FR-022: count cascade relationships before delete
        const relationshipCount = Number(
          (
            db
              .prepare(
                'SELECT count(*) AS c FROM "Relationship" WHERE "sourceColumnId" = ? OR "targetColumnId" = ?',
              )
              .get(data.columnId, data.columnId) as { c: number }
          ).c,
        )

        // Delete column from database (cascade deletes relationships)
        await deleteColumn(data.columnId)

        // Broadcast to other users
        socket.broadcast.emit('column:deleted', {
          columnId: data.columnId,
          tableId: column.tableId,
          deletedBy: userId,
        })

        // FR-022: ack to sender with cascade count
        cb?.({
          ok: true,
          entity: { id: data.columnId },
          cascade: { relationships: relationshipCount },
        })
      } catch (error) {
        console.error('Failed to delete column:', error)
        const message =
          error instanceof Error ? error.message : 'Failed to delete column'
        socket.emit('error', {
          event: 'column:delete',
          error: 'DELETE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Column reorder
  socket.on(
    'column:reorder',
    async (data: unknown, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'column:reorder',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        // Validate input with Zod schema
        const validated = reorderColumnsSchema.parse(data)
        const { tableId, orderedColumnIds } = validated

        // W5 (M6): parallelise the two independent reads — ownership check and
        // column fetch do not depend on each other's result.
        // Trade-off: one wasted column query when ownership fails (rare path).
        // This halves p50 latency on the happy path.
        const [table, currentColumns] = await Promise.all([
          findDiagramTableById(tableId),
          findColumnsByTableId(tableId),
        ])

        // IDOR check: tableId must belong to this whiteboard
        if (!table) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'FORBIDDEN',
            message: 'Table not found',
            tableId,
          })
          cb?.({ ok: false, code: 'NOT_FOUND', message: 'Table not found' })
          return
        }
        if (table.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
          })
          return
        }
        const currentColumnIds = new Set(currentColumns.map((c) => c.id))

        // Validate: every supplied ID must belong to this table
        const seenIds = new Set<string>()
        for (const id of orderedColumnIds) {
          if (!currentColumnIds.has(id)) {
            socket.emit('error', {
              event: 'column:reorder',
              error: 'VALIDATION_FAILED',
              message: `Column ${id} does not belong to table ${tableId}`,
              tableId,
            })
            cb?.({
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `Column ${id} does not belong to table ${tableId}`,
            })
            return
          }
          if (seenIds.has(id)) {
            socket.emit('error', {
              event: 'column:reorder',
              error: 'VALIDATION_FAILED',
              message: `Duplicate column ID ${id} in orderedColumnIds`,
              tableId,
            })
            cb?.({
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `Duplicate column ID ${id} in orderedColumnIds`,
            })
            return
          }
          seenIds.add(id)
        }

        // FM-07 merge: append any columns the client omitted, in ascending existing-order
        const suppliedSet = new Set(orderedColumnIds)
        const missingColumns = currentColumns
          .filter((c) => !suppliedSet.has(c.id))
          .sort((a, b) => a.order - b.order)
        const mergedOrderedIds = [
          ...orderedColumnIds,
          ...missingColumns.map((c) => c.id),
        ]

        // Persist via single Prisma transaction (REQ-03)
        await reorderColumns(tableId, mergedOrderedIds)

        // Broadcast the merged order to all other clients
        socket.broadcast.emit('column:reordered', {
          tableId,
          orderedColumnIds: mergedOrderedIds,
          reorderedBy: userId,
        })

        // Ack to originating socket only (not broadcast)
        socket.emit('column:reorder:ack', {
          tableId,
          orderedColumnIds: mergedOrderedIds,
        })

        // FR-022: ack callback for MCP write tools
        cb?.({
          ok: true,
          entity: { tableId, orderedColumnIds: mergedOrderedIds },
        })
      } catch (error) {
        console.error('Failed to reorder columns:', error)
        socket.emit('error', {
          event: 'column:reorder',
          error: 'UPDATE_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to reorder columns',
        })
        cb?.({
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to reorder columns',
        })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Column duplicate
  socket.on('column:duplicate', async (data: { columnId: string }) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (
      await denyIfInsufficientPermission(
        socket,
        whiteboardId,
        'column:duplicate',
      )
    )
      return

    try {
      // Validate input
      const { columnId } = z.object({ columnId: z.string().uuid() }).parse(data)

      // Load source column to verify ownership (IDOR prevention)
      const sourceColumn = await findColumnById(columnId)
      if (!sourceColumn) {
        socket.emit('error', {
          event: 'column:duplicate',
          error: 'NOT_FOUND',
          message: 'Column not found',
          columnId,
        })
        return
      }
      const ownerTable = await findDiagramTableById(sourceColumn.tableId)
      if (!ownerTable || ownerTable.whiteboardId !== whiteboardId) {
        socket.emit('error', {
          event: 'column:duplicate',
          error: 'FORBIDDEN',
          message: 'Column does not belong to this whiteboard',
          columnId,
        })
        return
      }

      // Perform the duplicate (shifts siblings + creates new column)
      const newColumn = await duplicateColumn(columnId)

      // The payload broadcast includes the siblings that shifted so clients can
      // re-sort without a full refetch.  We embed the new column and the
      // sourceOrder so clients know where to insert it.
      const broadcastPayload = {
        column: { ...newColumn, createdBy: userId },
        sourceColumnId: columnId,
        tableId: newColumn.tableId,
        createdBy: userId,
      }

      // Broadcast to all other users
      socket.broadcast.emit('column:duplicated', broadcastPayload)

      // Confirm back to originating socket so it can replace the optimistic entry
      socket.emit('column:duplicated', broadcastPayload)
    } catch (error) {
      console.error('Failed to duplicate column:', error)
      socket.emit('error', {
        event: 'column:duplicate',
        error: 'DUPLICATE_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to duplicate column',
        columnId: data.columnId,
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // ========================================================================
  // Relationship mutation events
  // ========================================================================

  // Relationship creation
  socket.on(
    'relationship:create',
    async (data: any, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'relationship:create',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        // Validate input
        const validated = createRelationshipSchema.parse({
          ...data,
          whiteboardId,
        })

        // Create relationship in database
        const relationship = await createRelationship(validated)

        // Broadcast to other users
        socket.broadcast.emit('relationship:created', {
          ...relationship,
          createdBy: userId,
        })

        // FR-022: ack to sender
        cb?.({ ok: true, entity: relationship })
      } catch (error) {
        console.error('Failed to create relationship:', error)
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to create relationship'
        socket.emit('error', {
          event: 'relationship:create',
          error: 'VALIDATION_ERROR',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Relationship update
  socket.on(
    'relationship:update',
    async (
      data: { relationshipId: string; [key: string]: any },
      cb?: (res: AckResult) => void,
    ) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'relationship:update',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      try {
        const { relationshipId, ...updateData } = data

        // Ownership check: verify relationship belongs to this whiteboard (IDOR prevention)
        const relationship = await findRelationshipById(relationshipId)
        if (!relationship) {
          socket.emit('error', {
            event: 'relationship:update',
            error: 'NOT_FOUND',
            message: 'Relationship not found',
            relationshipId,
          })
          cb?.({
            ok: false,
            code: 'NOT_FOUND',
            message: 'Relationship not found',
          })
          return
        }
        if (relationship.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'relationship:update',
            error: 'FORBIDDEN',
            message: 'Relationship does not belong to this whiteboard',
            relationshipId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Relationship does not belong to this whiteboard',
          })
          return
        }

        // Validate input
        const validated = updateRelationshipSchema.parse(updateData)

        // Apollo SA-2: Merged-endpoint referential-integrity validation
        // Run whenever any endpoint field is present in the update.
        const endpointFields = [
          'sourceTableId',
          'targetTableId',
          'sourceColumnId',
          'targetColumnId',
        ] as const
        const hasEndpointChange = endpointFields.some(
          (f) => validated[f] !== undefined,
        )
        if (hasEndpointChange) {
          // Compute merged endpoints (patch overrides current values)
          const mergedEndpoints = {
            sourceTableId:
              validated.sourceTableId ?? relationship.sourceTableId,
            targetTableId:
              validated.targetTableId ?? relationship.targetTableId,
            sourceColumnId:
              validated.sourceColumnId ?? relationship.sourceColumnId,
            targetColumnId:
              validated.targetColumnId ?? relationship.targetColumnId,
            whiteboardId: relationship.whiteboardId,
          }
          try {
            await assertRelationshipEndpointsValid(mergedEndpoints)
          } catch (integrityError) {
            const message =
              integrityError instanceof Error
                ? integrityError.message
                : 'Referential integrity violation'
            socket.emit('error', {
              event: 'relationship:update',
              error: 'VALIDATION_ERROR',
              message,
              relationshipId,
            })
            cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
            return
          }
        }

        // Update relationship in database
        const updatedRelationship = await updateRelationship(
          relationshipId,
          validated,
        )

        // Broadcast to other users
        socket.broadcast.emit('relationship:updated', {
          relationshipId,
          ...validated,
          updatedBy: userId,
        })

        // FR-022: ack to sender
        cb?.({ ok: true, entity: updatedRelationship })
      } catch (error) {
        console.error('Failed to update relationship:', error)
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to update relationship'
        socket.emit('error', {
          event: 'relationship:update',
          error: 'UPDATE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Relationship deletion
  socket.on(
    'relationship:delete',
    async (data: { relationshipId: string }, cb?: (res: AckResult) => void) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
        return
      }
      if (
        await denyIfInsufficientPermission(
          socket,
          whiteboardId,
          'relationship:delete',
        )
      ) {
        cb?.({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
        })
        return
      }

      let relationshipId: string | undefined
      try {
        // Validate input: UUID format required
        const parsed = z
          .object({ relationshipId: z.string().uuid() })
          .safeParse(data)
        if (!parsed.success) {
          socket.emit('error', {
            event: 'relationship:delete',
            error: 'VALIDATION_ERROR',
            message: 'Invalid relationshipId: must be a UUID',
            relationshipId: data.relationshipId,
          })
          cb?.({
            ok: false,
            code: 'VALIDATION_ERROR',
            message: 'Invalid relationshipId: must be a UUID',
          })
          return
        }
        relationshipId = parsed.data.relationshipId

        // Ownership check: verify relationship belongs to this whiteboard (IDOR prevention)
        const relationship = await findRelationshipById(relationshipId)
        if (!relationship) {
          socket.emit('error', {
            event: 'relationship:delete',
            error: 'NOT_FOUND',
            message: 'Relationship not found',
            relationshipId,
          })
          cb?.({
            ok: false,
            code: 'NOT_FOUND',
            message: 'Relationship not found',
          })
          return
        }
        if (relationship.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'relationship:delete',
            error: 'FORBIDDEN',
            message: 'Relationship does not belong to this whiteboard',
            relationshipId,
          })
          cb?.({
            ok: false,
            code: 'FORBIDDEN',
            message: 'Relationship does not belong to this whiteboard',
          })
          return
        }

        // Delete relationship from database
        await deleteRelationship(relationshipId)

        // Broadcast to other users
        socket.broadcast.emit('relationship:deleted', {
          relationshipId,
          deletedBy: userId,
        })

        // FR-022: ack to sender
        cb?.({ ok: true, entity: { id: relationshipId } })
      } catch (error) {
        console.error('Failed to delete relationship:', error)
        const message = 'Failed to delete relationship'
        socket.emit('error', {
          event: 'relationship:delete',
          error: 'DELETE_FAILED',
          message,
          relationshipId: relationshipId ?? data.relationshipId,
        })
        cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )
}

/**
 * Emit event to all users in a whiteboard namespace
 * @param whiteboardId - Whiteboard UUID
 * @param event - Event name
 * @param data - Event data
 */
export function emitToWhiteboard(
  whiteboardId: string,
  event: string,
  data: any,
): void {
  if (!io) {
    console.error('Socket.IO server not initialized')
    return
  }

  const namespace = io.of(`/whiteboard/${whiteboardId}`)
  namespace.emit(event, data)
}

/**
 * Emit event to all users in a whiteboard except sender
 * @param whiteboardId - Whiteboard UUID
 * @param socketId - Sender socket ID to exclude
 * @param event - Event name
 * @param data - Event data
 */
export function broadcastToWhiteboard(
  whiteboardId: string,
  socketId: string,
  event: string,
  data: any,
): void {
  if (!io) {
    console.error('Socket.IO server not initialized')
    return
  }

  const namespace = io.of(`/whiteboard/${whiteboardId}`)
  namespace.sockets.forEach((socket) => {
    if (socket.id !== socketId) {
      socket.emit(event, data)
    }
  })
}

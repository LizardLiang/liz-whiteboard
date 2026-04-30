// src/routes/api/collaboration.ts
// Socket.IO server integration for real-time collaboration

import { Server as SocketIOServer } from 'socket.io'
import { z } from 'zod'
import type { Server as HTTPServer } from 'node:http'
import type { CursorPosition } from '@/data/schema'
import {
  createCollaborationSession,
  deleteCollaborationSession,
  deleteStaleSession,
  findActiveCollaborators,
  updateCollaborationSession,
  updateSessionActivity,
} from '@/data/collaboration'
import {
  createColumnSchema,
  createRelationshipSchema,
  createTableSchema,
  reorderColumnsSchema,
  updateColumnSchema,
  updateRelationshipSchema,
  updateTableSchema,
} from '@/data/schema'
import {
  createDiagramTable,
  deleteDiagramTable,
  findDiagramTableById,
  updateDiagramTable,
  updateDiagramTablePosition,
} from '@/data/diagram-table'
import { findWhiteboardByIdWithDiagram } from '@/data/whiteboard'
import {
  createColumn,
  deleteColumn,
  findColumnById,
  findColumnsByTableId,
  reorderColumns,
  updateColumn,
} from '@/data/column'
import {
  createRelationship,
  deleteRelationship,
  findRelationshipById,
  updateRelationship,
} from '@/data/relationship'
import { parseSessionCookie } from '@/lib/auth/cookies'
import { validateSessionToken } from '@/lib/auth/session'
// TODO: restore this import when permission checks are re-enabled — temporarily disabled
// import { findEffectiveRole } from '@/data/permission'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { prisma } from '@/db'

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
  // Reads the session_token cookie from the handshake headers and validates it.
  whiteboardNsp.use(async (socket, next) => {
    try {
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
 * Resolve the projectId for a given whiteboardId.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-expect-error — unused after permission bypass; restore when checks are re-enabled
async function getProjectIdForWhiteboard(
  whiteboardId: string,
): Promise<string | null> {
  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: { projectId: true },
  })
  return whiteboard?.projectId ?? null
}

/**
 * Check that the socket user has EDITOR+ role on the whiteboard's project.
 * Emits permission_revoked and disconnects if not.
 * Returns true if access was denied (caller should return).
 *
 * TODO: restore permission check — temporarily disabled
 * All authenticated users are currently allowed to edit the whiteboard canvas.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function denyIfInsufficientPermission(
  _socket: any,
  _whiteboardId: string,
): Promise<boolean> {
  // TODO: restore permission check — temporarily disabled
  // const projectId = await getProjectIdForWhiteboard(_whiteboardId)
  // if (!projectId) return false
  // const role = await findEffectiveRole(_socket.data.userId, projectId)
  // const EDITOR_ROLES = ['EDITOR', 'ADMIN', 'OWNER']
  // if (!role || !EDITOR_ROLES.includes(role)) {
  //   _socket.emit('permission_revoked', { projectId })
  //   _socket.disconnect(true)
  //   return true
  // }
  return false
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

  // Sync request (when client reconnects and needs full state)
  socket.on('sync:request', async () => {
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
  socket.on('table:create', async (data: any) => {
    // Check session expiry
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    // Check permission
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
    } catch (error) {
      console.error('Failed to create table:', error)
      socket.emit('error', {
        event: 'table:create',
        error: 'VALIDATION_ERROR',
        message:
          error instanceof Error ? error.message : 'Failed to create table',
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // Table position update (dragging)
  socket.on(
    'table:move',
    async (data: { tableId: string; positionX: number; positionY: number }) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        return
      }
      if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
          return
        }
        if (table.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'table:move',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId: data.tableId,
          })
          return
        }

        // Update position in database
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
      } catch (error) {
        console.error('Failed to move table:', error)
        socket.emit('error', {
          event: 'table:move',
          error: 'UPDATE_FAILED',
          message: 'Failed to update table position',
        })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Table update (name, description, etc.)
  socket.on(
    'table:update',
    async (data: { tableId: string; [key: string]: any }) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        return
      }
      if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
          return
        }
        if (tableRecord.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'table:update',
            error: 'FORBIDDEN',
            message: 'Table does not belong to this whiteboard',
            tableId,
          })
          return
        }

        // Validate input
        const validated = updateTableSchema.parse(updateData)

        // Update table in database
        await updateDiagramTable(tableId, validated)

        // Broadcast to other users
        socket.broadcast.emit('table:updated', {
          tableId,
          ...validated,
          updatedBy: userId,
        })
      } catch (error) {
        console.error('Failed to update table:', error)
        socket.emit('error', {
          event: 'table:update',
          error: 'UPDATE_FAILED',
          message:
            error instanceof Error ? error.message : 'Failed to update table',
        })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Table deletion
  socket.on('table:delete', async (data: { tableId: string }) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
        return
      }
      if (table.whiteboardId !== whiteboardId) {
        socket.emit('error', {
          event: 'table:delete',
          error: 'FORBIDDEN',
          message: 'Table does not belong to this whiteboard',
          tableId,
        })
        return
      }

      // Delete table from database (cascade deletes columns and relationships)
      await deleteDiagramTable(tableId)

      // Broadcast to other users
      socket.broadcast.emit('table:deleted', {
        tableId,
        deletedBy: userId,
      })
    } catch (error) {
      console.error('Failed to delete table:', error)
      socket.emit('error', {
        event: 'table:delete',
        error: 'DELETE_FAILED',
        message: 'Failed to delete table',
        tableId: data.tableId,
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // ========================================================================
  // Column mutation events
  // ========================================================================

  // Column creation
  socket.on('column:create', async (data: any) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // Column update
  socket.on(
    'column:update',
    async (data: { columnId: string; [key: string]: unknown }) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        return
      }
      if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
      } catch (error) {
        console.error('Failed to update column:', error)
        socket.emit('error', {
          event: 'column:update',
          error: 'UPDATE_FAILED',
          message:
            error instanceof Error ? error.message : 'Failed to update column',
        })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Column deletion
  socket.on('column:delete', async (data: { columnId: string }) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
        return
      }

      // Delete column from database (cascade deletes relationships)
      await deleteColumn(data.columnId)

      // Broadcast to other users
      socket.broadcast.emit('column:deleted', {
        columnId: data.columnId,
        tableId: column.tableId,
        deletedBy: userId,
      })
    } catch (error) {
      console.error('Failed to delete column:', error)
      socket.emit('error', {
        event: 'column:delete',
        error: 'DELETE_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to delete column',
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // Column reorder
  socket.on('column:reorder', async (data: unknown) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    // V1: denyIfInsufficientPermission is a no-op stub per PRD OQ-3.
    // Wired here for forward-compatibility when RBAC is restored.
    // TODO(SA-L1): restore real permission check — update all column:* handlers in one pass.
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

    try {
      // Validate input with Zod schema
      const validated = reorderColumnsSchema.parse(data)
      const { tableId, orderedColumnIds } = validated

      // IDOR check: tableId must belong to this whiteboard
      const table = await findDiagramTableById(tableId)
      if (!table) {
        socket.emit('error', {
          event: 'column:reorder',
          error: 'FORBIDDEN',
          message: 'Table not found',
          tableId,
        })
        return
      }
      if (table.whiteboardId !== whiteboardId) {
        socket.emit('error', {
          event: 'column:reorder',
          error: 'FORBIDDEN',
          message: 'Table does not belong to this whiteboard',
          tableId,
        })
        return
      }

      // Fetch current columns to validate IDs and perform FM-07 merge
      const currentColumns = await findColumnsByTableId(tableId)
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
          return
        }
        if (seenIds.has(id)) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'VALIDATION_FAILED',
            message: `Duplicate column ID ${id} in orderedColumnIds`,
            tableId,
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
      const mergedOrderedIds = [...orderedColumnIds, ...missingColumns.map((c) => c.id)]

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
    } catch (error) {
      console.error('Failed to reorder columns:', error)
      socket.emit('error', {
        event: 'column:reorder',
        error: 'UPDATE_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to reorder columns',
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // ========================================================================
  // Relationship mutation events
  // ========================================================================

  // Relationship creation
  socket.on('relationship:create', async (data: any) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
    } catch (error) {
      console.error('Failed to create relationship:', error)
      socket.emit('error', {
        event: 'relationship:create',
        error: 'VALIDATION_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create relationship',
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })

  // Relationship update
  socket.on(
    'relationship:update',
    async (data: { relationshipId: string; [key: string]: any }) => {
      if (isSessionExpired(socket)) {
        socket.emit('session_expired')
        socket.disconnect(true)
        return
      }
      if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
          return
        }
        if (relationship.whiteboardId !== whiteboardId) {
          socket.emit('error', {
            event: 'relationship:update',
            error: 'FORBIDDEN',
            message: 'Relationship does not belong to this whiteboard',
            relationshipId,
          })
          return
        }

        // Validate input
        const validated = updateRelationshipSchema.parse(updateData)

        // Update relationship in database
        await updateRelationship(relationshipId, validated)

        // Broadcast to other users
        socket.broadcast.emit('relationship:updated', {
          relationshipId,
          ...validated,
          updatedBy: userId,
        })
      } catch (error) {
        console.error('Failed to update relationship:', error)
        socket.emit('error', {
          event: 'relationship:update',
          error: 'UPDATE_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to update relationship',
        })
        return
      }
      await safeUpdateSessionActivity(socket.id)
    },
  )

  // Relationship deletion
  socket.on('relationship:delete', async (data: { relationshipId: string }) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return

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
        return
      }
      if (relationship.whiteboardId !== whiteboardId) {
        socket.emit('error', {
          event: 'relationship:delete',
          error: 'FORBIDDEN',
          message: 'Relationship does not belong to this whiteboard',
          relationshipId,
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
    } catch (error) {
      console.error('Failed to delete relationship:', error)
      socket.emit('error', {
        event: 'relationship:delete',
        error: 'DELETE_FAILED',
        message: 'Failed to delete relationship',
        relationshipId: relationshipId ?? data.relationshipId,
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  })
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

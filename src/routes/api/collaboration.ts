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
  updateColumn,
} from '@/data/column'
import {
  createRelationship,
  deleteRelationship,
  updateRelationship,
} from '@/data/relationship'

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
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  // Setup namespace pattern for whiteboards
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
  ioServer.of(/^\/whiteboard\/[\w-]+$/).on('connection', async (socket) => {
    // Extract whiteboard ID from namespace
    const namespace = socket.nsp.name
    const whiteboardId = namespace.replace('/whiteboard/', '')

    // Get authentication from handshake
    const { userId } = socket.handshake.auth

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

      // Update session activity
      await updateSessionActivity(socket.id)
    } catch (error) {
      console.error('Failed to create table:', error)
      socket.emit('error', {
        event: 'table:create',
        error: 'VALIDATION_ERROR',
        message:
          error instanceof Error ? error.message : 'Failed to create table',
      })
    }
  })

  // Table position update (dragging)
  socket.on(
    'table:move',
    async (data: { tableId: string; positionX: number; positionY: number }) => {
      try {
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

        // Update session activity
        await updateSessionActivity(socket.id)
      } catch (error) {
        console.error('Failed to move table:', error)
        socket.emit('error', {
          event: 'table:move',
          error: 'UPDATE_FAILED',
          message: 'Failed to update table position',
        })
      }
    },
  )

  // Table update (name, description, etc.)
  socket.on(
    'table:update',
    async (data: { tableId: string; [key: string]: any }) => {
      try {
        const { tableId, ...updateData } = data

        // Validate input
        const validated = updateTableSchema.parse(updateData)

        // Update table in database
        const table = await updateDiagramTable(tableId, validated)

        // Broadcast to other users
        socket.broadcast.emit('table:updated', {
          tableId,
          ...validated,
          updatedBy: userId,
        })

        // Update session activity
        await updateSessionActivity(socket.id)
      } catch (error) {
        console.error('Failed to update table:', error)
        socket.emit('error', {
          event: 'table:update',
          error: 'UPDATE_FAILED',
          message:
            error instanceof Error ? error.message : 'Failed to update table',
        })
      }
    },
  )

  // Table deletion
  socket.on('table:delete', async (data: { tableId: string }) => {
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

      // Update session activity
      await updateSessionActivity(socket.id)
    } catch (error) {
      console.error('Failed to delete table:', error)
      socket.emit('error', {
        event: 'table:delete',
        error: 'DELETE_FAILED',
        message: 'Failed to delete table',
        tableId: data.tableId,
      })
    }
  })

  // ========================================================================
  // Column mutation events
  // ========================================================================

  // Column creation
  socket.on('column:create', async (data: any) => {
    try {
      // Validate input
      const validated = createColumnSchema.parse(data)

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

      // Update session activity
      await updateSessionActivity(socket.id)
    } catch (error) {
      console.error('Failed to create column:', error)
      socket.emit('error', {
        event: 'column:create',
        error: 'VALIDATION_ERROR',
        message:
          error instanceof Error ? error.message : 'Failed to create column',
      })
    }
  })

  // Column update
  socket.on(
    'column:update',
    async (data: { columnId: string; [key: string]: unknown }) => {
      try {
        const { columnId, ...updateData } = data

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

        // Update session activity
        await updateSessionActivity(socket.id)
      } catch (error) {
        console.error('Failed to update column:', error)
        socket.emit('error', {
          event: 'column:update',
          error: 'UPDATE_FAILED',
          message:
            error instanceof Error ? error.message : 'Failed to update column',
        })
      }
    },
  )

  // Column deletion
  socket.on('column:delete', async (data: { columnId: string }) => {
    try {
      // Get column before deletion to know tableId
      const column = await findColumnById(data.columnId)
      if (!column) {
        throw new Error('Column not found')
      }

      // Delete column from database (cascade deletes relationships)
      await deleteColumn(data.columnId)

      // Broadcast to other users
      socket.broadcast.emit('column:deleted', {
        columnId: data.columnId,
        tableId: column.tableId,
        deletedBy: userId,
      })

      // Update session activity
      await updateSessionActivity(socket.id)
    } catch (error) {
      console.error('Failed to delete column:', error)
      socket.emit('error', {
        event: 'column:delete',
        error: 'DELETE_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to delete column',
      })
    }
  })

  // ========================================================================
  // Relationship mutation events
  // ========================================================================

  // Relationship creation
  socket.on('relationship:create', async (data: any) => {
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

      // Update session activity
      await updateSessionActivity(socket.id)
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
    }
  })

  // Relationship update
  socket.on(
    'relationship:update',
    async (data: { relationshipId: string; [key: string]: any }) => {
      try {
        const { relationshipId, ...updateData } = data

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

        // Update session activity
        await updateSessionActivity(socket.id)
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
      }
    },
  )

  // Relationship deletion
  socket.on('relationship:delete', async (data: { relationshipId: string }) => {
    try {
      // Delete relationship from database
      await deleteRelationship(data.relationshipId)

      // Broadcast to other users
      socket.broadcast.emit('relationship:deleted', {
        relationshipId: data.relationshipId,
        deletedBy: userId,
      })

      // Update session activity
      await updateSessionActivity(socket.id)
    } catch (error) {
      console.error('Failed to delete relationship:', error)
      socket.emit('error', {
        event: 'relationship:delete',
        error: 'DELETE_FAILED',
        message: 'Failed to delete relationship',
      })
    }
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

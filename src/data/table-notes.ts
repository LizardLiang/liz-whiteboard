/**
 * TanStack Start server functions for table notes operations
 * Follows the builder pattern with proper validation
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { prisma } from '@/db'

// Validation schemas for table notes operations
export const updateTableNotesSchema = z.object({
  tableId: z.string().uuid(),
  description: z.string().max(10000),
  whiteboardId: z.string().uuid(),
  userId: z.string().uuid(),
})

export const getTableNotesSchema = z.object({
  tableId: z.string().uuid(),
})

export const bulkLoadNotesSchema = z.object({
  tableIds: z.array(z.string().uuid()),
})

/**
 * Update table notes - POST method using builder pattern
 * Updates DiagramTable.description field and emits WebSocket event
 */
export const updateTableNotes = createServerFn({
  method: 'POST',
})
  .inputValidator((data: z.infer<typeof updateTableNotesSchema>) =>
    updateTableNotesSchema.parse(data)
  )
  .handler(async ({ data }: { data: z.infer<typeof updateTableNotesSchema> }) => {
    const { tableId, description, whiteboardId, userId } = data

    try {
      // Update table description in database
      const updated = await prisma.diagramTable.update({
        where: { id: tableId },
        data: {
          description,
          updatedAt: new Date()
        }
      })

      // Emit WebSocket event for real-time sync (secondary operation)
      try {
        // Dynamic import to avoid build issues if socket not available
        const { getSocketIO } = await import('@/routes/api/collaboration')
        const io = getSocketIO()
        if (io) {
          io.to(`whiteboard:${whiteboardId}`).emit('table:notes:updated', {
            tableId,
            description,
            updatedBy: userId,
            timestamp: updated.updatedAt.toISOString(),
            whiteboardId
          })
        }
      } catch (socketError) {
        // Log error but don't fail the main operation
        console.warn('WebSocket notification failed:', socketError)
      }

      return {
        success: true,
        updatedAt: updated.updatedAt,
        description: updated.description
      }
    } catch (error) {
      console.error('Failed to update table notes:', error)
      throw new Error('Failed to update table notes')
    }
  })

/**
 * Get table notes - GET method
 * Retrieves description for a single table
 */
export const getTableNotes = createServerFn({
  method: 'GET',
})
  .inputValidator((data: z.infer<typeof getTableNotesSchema>) =>
    getTableNotesSchema.parse(data)
  )
  .handler(async ({ data }: { data: z.infer<typeof getTableNotesSchema> }) => {
    try {
      const table = await prisma.diagramTable.findUnique({
        where: { id: data.tableId },
        select: {
          description: true,
          updatedAt: true
        }
      })

      return {
        description: table?.description || null,
        updatedAt: table?.updatedAt
      }
    } catch (error) {
      console.error('Failed to get table notes:', error)
      throw new Error('Failed to get table notes')
    }
  })

/**
 * Bulk load notes for multiple tables - POST method
 * Used for loading notes for all visible tables efficiently
 */
export const bulkLoadNotes = createServerFn({
  method: 'POST',
})
  .inputValidator((data: z.infer<typeof bulkLoadNotesSchema>) =>
    bulkLoadNotesSchema.parse(data)
  )
  .handler(async ({ data }: { data: z.infer<typeof bulkLoadNotesSchema> }) => {
    try {
      const tables = await prisma.diagramTable.findMany({
        where: { id: { in: data.tableIds } },
        select: {
          id: true,
          description: true,
          updatedAt: true
        }
      })

      // Create a map for efficient lookup
      const notesMap = new Map(
        tables
          .filter(table => table.description)
          .map(table => [table.id, {
            description: table.description,
            updatedAt: table.updatedAt
          }])
      )

      return {
        notes: Object.fromEntries(notesMap)
      }
    } catch (error) {
      console.error('Failed to bulk load notes:', error)
      throw new Error('Failed to bulk load notes')
    }
  })

/**
 * Type definitions for server function responses
 */
export type UpdateTableNotesResponse = Awaited<ReturnType<typeof updateTableNotes>>
export type GetTableNotesResponse = Awaited<ReturnType<typeof getTableNotes>>
export type BulkLoadNotesResponse = Awaited<ReturnType<typeof bulkLoadNotes>>
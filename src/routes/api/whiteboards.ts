// src/routes/api/whiteboards.ts
// TanStack Start server functions for Whiteboard CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createWhiteboard,
  deleteWhiteboard,
  findRecentWhiteboards,
  findWhiteboardById,
  findWhiteboardByIdWithDiagram,
  findWhiteboardsByFolderId,
  findWhiteboardsByProjectId,
  updateWhiteboard,
  updateWhiteboardCanvasState,
  updateWhiteboardTextSource,
} from '@/data/whiteboard'
import {
  canvasStateSchema,
  createWhiteboardSchema,
  updateWhiteboardSchema,
} from '@/data/schema'
import { requireAuth } from '@/lib/auth/middleware'

/**
 * Get all whiteboards in a project
 * @param projectId - Project UUID
 */
export const getWhiteboardsByProject = createServerFn({ method: 'GET' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(
    requireAuth(async (_ctx, projectId) => {
      try {
        const whiteboards = await findWhiteboardsByProjectId(projectId)
        return whiteboards
      } catch (error) {
        throw new Error(
          `Failed to fetch whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get all whiteboards in a folder
 * @param folderId - Folder UUID
 */
export const getWhiteboardsByFolder = createServerFn({ method: 'GET' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async (_ctx, folderId) => {
      try {
        const whiteboards = await findWhiteboardsByFolderId(folderId)
        return whiteboards
      } catch (error) {
        throw new Error(
          `Failed to fetch whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single whiteboard by ID with full diagram data
 * Includes tables, columns, and relationships for rendering
 * @param whiteboardId - Whiteboard UUID
 */
export const getWhiteboard = createServerFn({ method: 'GET' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async (_ctx, whiteboardId) => {
      try {
        const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId)
        if (!whiteboard) {
          throw new Error('Whiteboard not found')
        }
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to fetch whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single whiteboard by ID (without diagram data)
 * @param whiteboardId - Whiteboard UUID
 */
export const getWhiteboardById = createServerFn({ method: 'GET' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async (_ctx, whiteboardId) => {
      try {
        const whiteboard = await findWhiteboardById(whiteboardId)
        if (!whiteboard) {
          throw new Error('Whiteboard not found')
        }
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to fetch whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Create a new whiteboard
 * @param data - Whiteboard creation data (name, projectId, optional folderId)
 */
export const createWhiteboardFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createWhiteboardSchema.parse(data))
  .handler(
    requireAuth(async (_ctx, data) => {
      try {
        const whiteboard = await createWhiteboard(data)
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to create whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update an existing whiteboard
 * @param params - Object with id and data fields
 */
export const updateWhiteboardFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateWhiteboardSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async (_ctx, params) => {
      try {
        const whiteboard = await updateWhiteboard(params.id, params.data)
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to update whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update whiteboard canvas state (zoom, pan)
 * @param params - Object with id and canvasState fields
 */
export const updateCanvasState = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      canvasState: canvasStateSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async (_ctx, params) => {
      try {
        const whiteboard = await updateWhiteboardCanvasState(
          params.id,
          params.canvasState,
        )
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to update canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update whiteboard text source
 * @param params - Object with id and textSource fields
 */
export const updateTextSource = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      textSource: z.string(),
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async (_ctx, params) => {
      try {
        const whiteboard = await updateWhiteboardTextSource(
          params.id,
          params.textSource,
        )
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to update text source: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Delete a whiteboard by ID
 * Cascade deletes all tables, columns, and relationships within the whiteboard
 * @param whiteboardId - Whiteboard UUID
 */
export const deleteWhiteboardFn = createServerFn({ method: 'POST' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async (_ctx, whiteboardId) => {
      try {
        const whiteboard = await deleteWhiteboard(whiteboardId)
        return whiteboard
      } catch (error) {
        throw new Error(
          `Failed to delete whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get recent whiteboards (ordered by last updated)
 * @param limit - Maximum number of whiteboards to return (default: 10)
 */
export const getRecentWhiteboards = createServerFn({ method: 'GET' })
  .inputValidator((limit: number = 10) => limit)
  .handler(
    requireAuth(async (_ctx, limit) => {
      try {
        const whiteboards = await findRecentWhiteboards(limit)
        return whiteboards
      } catch (error) {
        throw new Error(
          `Failed to fetch recent whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

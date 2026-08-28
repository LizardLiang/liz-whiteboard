// src/routes/api/whiteboards.ts
// TanStack Start server functions for Whiteboard CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createWhiteboard,
  deleteWhiteboard,
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
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import {
  getFolderProjectId,
  getWhiteboardProjectId,
} from '@/data/resolve-project'
import { db } from '@/db'
import { requireServerFnRole } from '@/lib/auth/require-role'

/**
 * Get all whiteboards in a project
 * Requires VIEWER+ role on the project.
 * @param projectId - Project UUID
 * @requires viewer
 */
export const getWhiteboardsByProject = createServerFn({ method: 'GET' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(
    requireAuth(async ({ user }, projectId) => {
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires VIEWER+ role on the folder's project.
 * @param folderId - Folder UUID
 * @requires viewer
 */
export const getWhiteboardsByFolder = createServerFn({ method: 'GET' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async ({ user }, folderId) => {
      const projectId = await getFolderProjectId(folderId)
      if (!projectId) {
        throw new Error('Folder not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires VIEWER+ role on the whiteboard's project.
 * @param whiteboardId - Whiteboard UUID
 * @requires viewer
 */
export const getWhiteboard = createServerFn({ method: 'GET' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async ({ user }, whiteboardId) => {
      const projectId = await getWhiteboardProjectId(whiteboardId)
      if (!projectId) {
        throw new Error('Whiteboard not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires VIEWER+ role on the whiteboard's project.
 * @param whiteboardId - Whiteboard UUID
 * @requires viewer
 */
export const getWhiteboardById = createServerFn({ method: 'GET' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async ({ user }, whiteboardId) => {
      const projectId = await getWhiteboardProjectId(whiteboardId)
      if (!projectId) {
        throw new Error('Whiteboard not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires EDITOR+ role on the project.
 * @param data - Whiteboard creation data (name, projectId, optional folderId)
 * @requires editor
 */
export const createWhiteboardFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createWhiteboardSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      await requireServerFnRole(user.id, data.projectId, 'EDITOR')
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
 * Requires EDITOR+ role on the whiteboard's project.
 * @param params - Object with id and data fields
 * @requires editor
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
    requireAuth(async ({ user }, params) => {
      const projectId = await getWhiteboardProjectId(params.id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * Requires EDITOR+ role on the whiteboard's project.
 * @param params - Object with id and canvasState fields
 * @requires editor
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
    requireAuth(async ({ user }, params) => {
      const projectId = await getWhiteboardProjectId(params.id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * Requires EDITOR+ role on the whiteboard's project.
 * @param params - Object with id and textSource fields
 * @requires editor
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
    requireAuth(async ({ user }, params) => {
      const projectId = await getWhiteboardProjectId(params.id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * Requires EDITOR+ role on the whiteboard's project.
 * Cascade deletes all tables, columns, and relationships within the whiteboard
 * @param whiteboardId - Whiteboard UUID
 * @requires editor
 */
export const deleteWhiteboardFn = createServerFn({ method: 'POST' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async ({ user }, whiteboardId) => {
      const projectId = await getWhiteboardProjectId(whiteboardId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * A recent-list row — either board kind, tagged so the home page can route
 * each entry to its own route (`/whiteboard/$whiteboardId` vs
 * `/canvas/$boardId`). Deliberately NOT the full `Whiteboard` shape: a
 * `CanvasBoard` has no `canvasState`/`textSource`, so the UNION below
 * selects only the columns both kinds share.
 */
export interface RecentBoardRow {
  id: string
  name: string
  updatedAt: Date
  kind: 'whiteboard' | 'canvas'
}

/**
 * Get recent boards — whiteboards AND canvas boards — ordered by last
 * updated across both kinds.
 * Only returns boards from projects the user has access to.
 * DB-level filter enforces user-scoped visibility — no additional per-resource RBAC needed.
 * @param limit - Maximum number of boards to return (default: 10)
 * @requires authenticated
 */
export const getRecentWhiteboards = createServerFn({ method: 'GET' })
  .inputValidator((limit: number = 10) => limit)
  .handler(
    requireAuth(async ({ user }, limit) => {
      try {
        // UNION ALL over Whiteboard and CanvasBoard, each carrying a literal
        // `kind` column and applying the SAME owner-or-member access filter,
        // then a single ORDER BY + LIMIT across the combined rows.
        const rows = db
          .prepare(
            `SELECT w."id" AS "id", w."name" AS "name", w."updatedAt" AS "updatedAt", 'whiteboard' AS "kind"
             FROM "Whiteboard" w
             JOIN "Project" p ON p."id" = w."projectId"
             WHERE p."ownerId" = ?
                OR EXISTS (
                  SELECT 1 FROM "ProjectMember" m
                  WHERE m."projectId" = p."id" AND m."userId" = ?
                )
             UNION ALL
             SELECT c."id" AS "id", c."name" AS "name", c."updatedAt" AS "updatedAt", 'canvas' AS "kind"
             FROM "CanvasBoard" c
             JOIN "Project" p ON p."id" = c."projectId"
             WHERE p."ownerId" = ?
                OR EXISTS (
                  SELECT 1 FROM "ProjectMember" m
                  WHERE m."projectId" = p."id" AND m."userId" = ?
                )
             ORDER BY "updatedAt" DESC
             LIMIT ?`,
          )
          .all(user.id, user.id, user.id, user.id, limit)
        const boards: Array<RecentBoardRow> = rows.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          updatedAt: new Date(Number(r.updatedAt)),
          kind: r.kind as 'whiteboard' | 'canvas',
        }))
        return boards
      } catch (error) {
        throw new Error(
          `Failed to fetch recent whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

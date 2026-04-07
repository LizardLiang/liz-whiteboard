// src/routes/api/tables.ts
// TanStack Start server functions for DiagramTable CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createDiagramTable,
  deleteDiagramTable,
  findDiagramTableById,
  findDiagramTableByIdWithRelations,
  findDiagramTablesByWhiteboardId,
  findDiagramTablesByWhiteboardIdWithRelations,
  updateDiagramTable,
  updateDiagramTablePosition,
} from '@/data/diagram-table'
import { createTableSchema, updateTableSchema } from '@/data/schema'
import { requireAuth } from '@/lib/auth/middleware'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { getWhiteboardProjectId, getTableProjectId } from '@/data/resolve-project'

/**
 * Get all tables in a whiteboard
 * Requires VIEWER+ role on the whiteboard's project.
 * @param whiteboardId - Whiteboard UUID
 */
export const getTablesByWhiteboardId = createServerFn({ method: 'GET' })
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
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const tables = await findDiagramTablesByWhiteboardId(whiteboardId)
        return tables
      } catch (error) {
        throw new Error(
          `Failed to fetch tables: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get all tables in a whiteboard with columns and relationships
 * Requires VIEWER+ role on the whiteboard's project.
 * @param whiteboardId - Whiteboard UUID
 */
export const getTablesByWhiteboardIdWithRelations = createServerFn({
  method: 'GET',
})
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
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const tables =
          await findDiagramTablesByWhiteboardIdWithRelations(whiteboardId)
        return tables
      } catch (error) {
        throw new Error(
          `Failed to fetch tables with relations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single table by ID
 * Requires VIEWER+ role on the table's project.
 * @param tableId - Table UUID
 */
export const getTable = createServerFn({ method: 'GET' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(
    requireAuth(async ({ user }, tableId) => {
      const projectId = await getTableProjectId(tableId)
      if (!projectId) {
        throw new Error('Table not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const table = await findDiagramTableById(tableId)
        if (!table) {
          throw new Error('Table not found')
        }
        return table
      } catch (error) {
        throw new Error(
          `Failed to fetch table: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single table by ID with columns and relationships
 * Requires VIEWER+ role on the table's project.
 * @param tableId - Table UUID
 */
export const getTableWithRelations = createServerFn({ method: 'GET' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(
    requireAuth(async ({ user }, tableId) => {
      const projectId = await getTableProjectId(tableId)
      if (!projectId) {
        throw new Error('Table not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const table = await findDiagramTableByIdWithRelations(tableId)
        if (!table) {
          throw new Error('Table not found')
        }
        return table
      } catch (error) {
        throw new Error(
          `Failed to fetch table with relations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Create a new table
 * Requires EDITOR+ role on the whiteboard's project.
 * @param data - Table creation data (name, position, etc.)
 */
export const createTableFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createTableSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) {
        throw new Error('Whiteboard not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const table = await createDiagramTable(data)
        return table
      } catch (error) {
        throw new Error(
          `Failed to create table: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update an existing table
 * Requires EDITOR+ role on the table's project.
 * @param params - Object with id and data fields
 */
export const updateTableFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateTableSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, params) => {
      const projectId = await getTableProjectId(params.id)
      if (!projectId) {
        throw new Error('Table not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const table = await updateDiagramTable(params.id, params.data)
        return table
      } catch (error) {
        throw new Error(
          `Failed to update table: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update table position (for drag-and-drop)
 * Requires EDITOR+ role on the table's project.
 * @param params - Object with id, positionX, positionY
 */
export const updateTablePositionFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      positionX: z.number().finite(),
      positionY: z.number().finite(),
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, params) => {
      const projectId = await getTableProjectId(params.id)
      if (!projectId) {
        throw new Error('Table not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const table = await updateDiagramTablePosition(
          params.id,
          params.positionX,
          params.positionY,
        )
        return table
      } catch (error) {
        throw new Error(
          `Failed to update table position: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Delete a table by ID
 * Requires EDITOR+ role on the table's project.
 * Cascade deletes all columns and relationships connected to this table
 * @param tableId - Table UUID
 */
export const deleteTableFn = createServerFn({ method: 'POST' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(
    requireAuth(async ({ user }, tableId) => {
      const projectId = await getTableProjectId(tableId)
      if (!projectId) {
        throw new Error('Table not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return { error: 'FORBIDDEN', status: 403, message: 'Access denied' } as const
      }
      try {
        const table = await deleteDiagramTable(tableId)
        return table
      } catch (error) {
        throw new Error(
          `Failed to delete table: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

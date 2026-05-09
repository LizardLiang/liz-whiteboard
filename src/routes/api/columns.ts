// src/routes/api/columns.ts
// TanStack Start server functions for Column CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createColumn,
  createColumns,
  deleteColumn,
  findColumnById,
  findColumnsByTableId,
  findForeignKeyColumnsByTableId,
  findPrimaryKeyColumnsByTableId,
  updateColumn,
  updateColumnOrder,
} from '@/data/column'
import { createColumnSchema, updateColumnSchema } from '@/data/schema'
import { requireAuth } from '@/lib/auth/middleware'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { getColumnProjectId, getTableProjectId } from '@/data/resolve-project'
import {
  requireServerFnRole,
  ForbiddenError,
  BatchDeniedError,
} from '@/lib/auth/require-role'
import { logSampledError } from '@/lib/auth/log-sample'

/**
 * Get all columns in a table
 * Requires VIEWER+ role on the table's project.
 * @param tableId - Table UUID
 * @requires viewer
 */
export const getColumnsByTableId = createServerFn({ method: 'GET' })
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
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
      try {
        const columns = await findColumnsByTableId(tableId)
        return columns
      } catch (error) {
        throw new Error(
          `Failed to fetch columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single column by ID
 * Requires VIEWER+ role on the column's project.
 * @param columnId - Column UUID
 * @requires viewer
 */
export const getColumn = createServerFn({ method: 'GET' })
  .inputValidator((columnId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(columnId)
  })
  .handler(
    requireAuth(async ({ user }, columnId) => {
      const projectId = await getColumnProjectId(columnId)
      if (!projectId) {
        throw new Error('Column not found')
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
        const column = await findColumnById(columnId)
        if (!column) {
          throw new Error('Column not found')
        }
        return column
      } catch (error) {
        throw new Error(
          `Failed to fetch column: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get primary key columns in a table
 * Requires VIEWER+ role on the table's project.
 * @param tableId - Table UUID
 * @requires viewer
 */
export const getPrimaryKeyColumnsByTableId = createServerFn({ method: 'GET' })
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
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
      try {
        const columns = await findPrimaryKeyColumnsByTableId(tableId)
        return columns
      } catch (error) {
        throw new Error(
          `Failed to fetch primary key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get foreign key columns in a table
 * Requires VIEWER+ role on the table's project.
 * @param tableId - Table UUID
 * @requires viewer
 */
export const getForeignKeyColumnsByTableId = createServerFn({ method: 'GET' })
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
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
      try {
        const columns = await findForeignKeyColumnsByTableId(tableId)
        return columns
      } catch (error) {
        throw new Error(
          `Failed to fetch foreign key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Create a new column
 * Requires EDITOR+ role on the table's project.
 * @param data - Column creation data (name, dataType, etc.)
 * @requires editor
 */
export const createColumnFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createColumnSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getTableProjectId(data.tableId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const column = await createColumn(data)
        return column
      } catch (error) {
        throw new Error(
          `Failed to create column: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Create multiple columns in a single transaction.
 * Pre-validate-then-write batch RBAC per AD-3 (GA-RBAC-BATCH-SHORT-CIRCUIT):
 * RBAC for every item is checked FIRST; if any item fails, the entire batch is
 * rejected with BatchDeniedError — no DB writes occur.
 * SEC-BATCH-03: item index and tableId are never leaked in the error response.
 * Apollo MEDIUM-1: getTableProjectId DB throws are caught here and converted to
 * BatchDeniedError (prevents raw error propagation that could leak tableId).
 *
 * @requires editor
 */
export const createColumnsFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    const schema = z.array(createColumnSchema)
    return schema.parse(data)
  })
  .handler(
    requireAuth(async ({ user }, data) => {
      if (data.length === 0) return []

      // Step 1: PRE-VALIDATE — RBAC for every unique tableId before any write.
      const uniqueTableIds = [...new Set(data.map((c) => c.tableId))]
      for (const tableId of uniqueTableIds) {
        let projectId: string | null
        try {
          projectId = await getTableProjectId(tableId)
        } catch (error) {
          // MEDIUM-1: DB throw during getTableProjectId must NOT leak tableId via raw error
          logSampledError({
            userId: user.id,
            errorClass: 'BATCH_RBAC_LOOKUP_FAILED',
            message: error instanceof Error ? error.message : String(error),
          })
          throw new BatchDeniedError()
        }
        try {
          await requireServerFnRole(user.id, projectId, 'EDITOR')
        } catch (error) {
          if (error instanceof ForbiddenError) {
            // SEC-BATCH-03: do NOT leak which tableId failed
            throw new BatchDeniedError()
          }
          throw error
        }
      }

      // Step 2: WRITE — only reached when every item passed RBAC.
      try {
        const columns = await createColumns(data)
        return columns
      } catch (error) {
        throw new Error(
          `Failed to create columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update an existing column
 * Requires EDITOR+ role on the column's project.
 * @param params - Object with id and data fields
 * @requires editor
 */
export const updateColumnFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateColumnSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, params) => {
      const projectId = await getColumnProjectId(params.id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const column = await updateColumn(params.id, params.data)
        return column
      } catch (error) {
        throw new Error(
          `Failed to update column: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update column order (for reordering)
 * Requires EDITOR+ role on the column's project.
 * @param params - Object with id and order
 * @requires editor
 */
export const updateColumnOrderFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      order: z.number().int().min(0),
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, params) => {
      const projectId = await getColumnProjectId(params.id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const column = await updateColumnOrder(params.id, params.order)
        return column
      } catch (error) {
        throw new Error(
          `Failed to update column order: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Delete a column by ID
 * Requires EDITOR+ role on the column's project.
 * Cascade deletes relationships referencing this column
 * @param columnId - Column UUID
 * @requires editor
 */
export const deleteColumnFn = createServerFn({ method: 'POST' })
  .inputValidator((columnId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(columnId)
  })
  .handler(
    requireAuth(async ({ user }, columnId) => {
      const projectId = await getColumnProjectId(columnId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const column = await deleteColumn(columnId)
        return column
      } catch (error) {
        throw new Error(
          `Failed to delete column: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

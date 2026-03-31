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

/**
 * Get all columns in a table
 * @param tableId - Table UUID
 */
export const getColumnsByTableId = createServerFn({ method: 'GET' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(async ({ data: tableId }) => {
    try {
      const columns = await findColumnsByTableId(tableId)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to fetch columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Get a single column by ID
 * @param columnId - Column UUID
 */
export const getColumn = createServerFn({ method: 'GET' })
  .inputValidator((columnId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(columnId)
  })
  .handler(async ({ data: columnId }) => {
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
  })

/**
 * Get primary key columns in a table
 * @param tableId - Table UUID
 */
export const getPrimaryKeyColumnsByTableId = createServerFn({ method: 'GET' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(async ({ data: tableId }) => {
    try {
      const columns = await findPrimaryKeyColumnsByTableId(tableId)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to fetch primary key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Get foreign key columns in a table
 * @param tableId - Table UUID
 */
export const getForeignKeyColumnsByTableId = createServerFn({ method: 'GET' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(async ({ data: tableId }) => {
    try {
      const columns = await findForeignKeyColumnsByTableId(tableId)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to fetch foreign key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Create a new column
 * @param data - Column creation data (name, dataType, etc.)
 */
export const createColumnFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createColumnSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const column = await createColumn(data)
      return column
    } catch (error) {
      throw new Error(
        `Failed to create column: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Create multiple columns in a single transaction
 * @param data - Array of column creation data
 */
export const createColumnsFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    const schema = z.array(createColumnSchema)
    return schema.parse(data)
  })
  .handler(async ({ data }) => {
    try {
      const columns = await createColumns(data)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to create columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Update an existing column
 * @param params - Object with id and data fields
 */
export const updateColumnFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateColumnSchema,
    })
    return schema.parse(params)
  })
  .handler(async ({ data: params }) => {
    try {
      const column = await updateColumn(params.id, params.data)
      return column
    } catch (error) {
      throw new Error(
        `Failed to update column: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Update column order (for reordering)
 * @param params - Object with id and order
 */
export const updateColumnOrderFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      order: z.number().int().min(0),
    })
    return schema.parse(params)
  })
  .handler(async ({ data: params }) => {
    try {
      const column = await updateColumnOrder(params.id, params.order)
      return column
    } catch (error) {
      throw new Error(
        `Failed to update column order: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Delete a column by ID
 * Cascade deletes relationships referencing this column
 * @param columnId - Column UUID
 */
export const deleteColumnFn = createServerFn({ method: 'POST' })
  .inputValidator((columnId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(columnId)
  })
  .handler(async ({ data: columnId }) => {
    try {
      const column = await deleteColumn(columnId)
      return column
    } catch (error) {
      throw new Error(
        `Failed to delete column: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

// src/routes/api/columns.ts
// TanStack Start server functions for Column CRUD operations

import { createServerFn } from '@tanstack/start'
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
export const getColumnsByTableId = createServerFn(
  'GET',
  async (tableId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(tableId)

    try {
      const columns = await findColumnsByTableId(tableId)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to fetch columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Get a single column by ID
 * @param columnId - Column UUID
 */
export const getColumn = createServerFn('GET', async (columnId: string) => {
  // Validate UUID format
  const idSchema = z.string().uuid()
  idSchema.parse(columnId)

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
export const getPrimaryKeyColumnsByTableId = createServerFn(
  'GET',
  async (tableId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(tableId)

    try {
      const columns = await findPrimaryKeyColumnsByTableId(tableId)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to fetch primary key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Get foreign key columns in a table
 * @param tableId - Table UUID
 */
export const getForeignKeyColumnsByTableId = createServerFn(
  'GET',
  async (tableId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(tableId)

    try {
      const columns = await findForeignKeyColumnsByTableId(tableId)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to fetch foreign key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Create a new column
 * @param data - Column creation data (name, dataType, etc.)
 */
export const createColumnFn = createServerFn('POST', async (data: unknown) => {
  // Validate input with Zod schema
  const validated = createColumnSchema.parse(data)

  try {
    const column = await createColumn(validated)
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
export const createColumnsFn = createServerFn(
  'POST',
  async (data: Array<unknown>) => {
    // Validate all inputs with Zod schema
    const validated = data.map((item) => createColumnSchema.parse(item))

    try {
      const columns = await createColumns(validated)
      return columns
    } catch (error) {
      throw new Error(
        `Failed to create columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Update an existing column
 * @param params - Object with id and data fields
 */
export const updateColumnFn = createServerFn(
  'PUT',
  async (params: { id: string; data: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(params.id)

    // Validate update data with Zod schema
    const validated = updateColumnSchema.parse(params.data)

    try {
      const column = await updateColumn(params.id, validated)
      return column
    } catch (error) {
      throw new Error(
        `Failed to update column: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Update column order (for reordering)
 * @param params - Object with id and order
 */
export const updateColumnOrderFn = createServerFn(
  'PUT',
  async (params: { id: string; order: number }) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(params.id)

    // Validate order value
    const orderSchema = z.number().int().min(0)
    orderSchema.parse(params.order)

    try {
      const column = await updateColumnOrder(params.id, params.order)
      return column
    } catch (error) {
      throw new Error(
        `Failed to update column order: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Delete a column by ID
 * Cascade deletes relationships referencing this column
 * @param columnId - Column UUID
 */
export const deleteColumnFn = createServerFn(
  'DELETE',
  async (columnId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(columnId)

    try {
      const column = await deleteColumn(columnId)
      return column
    } catch (error) {
      throw new Error(
        `Failed to delete column: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

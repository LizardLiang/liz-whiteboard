// src/data/column.ts
// Data access layer for Column entity

import { createColumnSchema, updateColumnSchema } from './schema'
import type { CreateColumn, UpdateColumn } from './schema'
import type { Column } from '@prisma/client'
import { prisma } from '@/db'

/**
 * Create a new column
 * @param data - Column creation data (validated with Zod)
 * @returns Created column
 * @throws Error if validation fails or database operation fails
 */
export async function createColumn(data: CreateColumn): Promise<Column> {
  // Validate input with Zod schema
  const validated = createColumnSchema.parse(data)

  try {
    const column = await prisma.column.create({
      data: validated,
    })
    return column
  } catch (error) {
    throw new Error(
      `Failed to create column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Create multiple columns in a single transaction
 * @param columns - Array of column creation data
 * @returns Array of created columns
 */
export async function createColumns(
  columns: Array<CreateColumn>,
): Promise<Array<Column>> {
  // Validate all inputs
  const validated = columns.map((col) => createColumnSchema.parse(col))

  try {
    const result = await prisma.$transaction(
      validated.map((data) => prisma.column.create({ data })),
    )
    return result
  } catch (error) {
    throw new Error(
      `Failed to create columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all columns in a table
 * @param tableId - Table UUID
 * @returns Array of columns in the table (ordered by order field)
 */
export async function findColumnsByTableId(
  tableId: string,
): Promise<Array<Column>> {
  try {
    const columns = await prisma.column.findMany({
      where: { tableId },
      orderBy: { order: 'asc' },
    })
    return columns
  } catch (error) {
    throw new Error(
      `Failed to fetch columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a column by ID
 * @param id - Column UUID
 * @returns Column or null if not found
 */
export async function findColumnById(id: string): Promise<Column | null> {
  try {
    const column = await prisma.column.findUnique({
      where: { id },
    })
    return column
  } catch (error) {
    throw new Error(
      `Failed to fetch column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a column
 * @param id - Column UUID
 * @param data - Partial column data to update (validated with Zod)
 * @returns Updated column
 * @throws Error if column not found or validation fails
 */
export async function updateColumn(
  id: string,
  data: UpdateColumn,
): Promise<Column> {
  // Validate input with Zod schema
  const validated = updateColumnSchema.parse(data)

  try {
    const column = await prisma.column.update({
      where: { id },
      data: validated,
    })
    return column
  } catch (error) {
    throw new Error(
      `Failed to update column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update column order (for reordering columns)
 * @param id - Column UUID
 * @param order - New order index
 * @returns Updated column
 */
export async function updateColumnOrder(
  id: string,
  order: number,
): Promise<Column> {
  try {
    const column = await prisma.column.update({
      where: { id },
      data: { order },
    })
    return column
  } catch (error) {
    throw new Error(
      `Failed to update column order: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a column (cascade deletes relationships referencing this column)
 * @param id - Column UUID
 * @returns Deleted column
 * @throws Error if column not found
 */
export async function deleteColumn(id: string): Promise<Column> {
  try {
    const column = await prisma.column.delete({
      where: { id },
    })
    return column
  } catch (error) {
    throw new Error(
      `Failed to delete column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find primary key columns in a table
 * @param tableId - Table UUID
 * @returns Array of primary key columns
 */
export async function findPrimaryKeyColumnsByTableId(
  tableId: string,
): Promise<Array<Column>> {
  try {
    const columns = await prisma.column.findMany({
      where: {
        tableId,
        isPrimaryKey: true,
      },
      orderBy: { order: 'asc' },
    })
    return columns
  } catch (error) {
    throw new Error(
      `Failed to fetch primary key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find foreign key columns in a table
 * @param tableId - Table UUID
 * @returns Array of foreign key columns
 */
export async function findForeignKeyColumnsByTableId(
  tableId: string,
): Promise<Array<Column>> {
  try {
    const columns = await prisma.column.findMany({
      where: {
        tableId,
        isForeignKey: true,
      },
      orderBy: { order: 'asc' },
    })
    return columns
  } catch (error) {
    throw new Error(
      `Failed to fetch foreign key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

// src/routes/api/tables.ts
// TanStack Start server functions for DiagramTable CRUD operations

import { createServerFn } from '@tanstack/start';
import { z } from 'zod';
import {
  createDiagramTable,
  findDiagramTablesByWhiteboardId,
  findDiagramTablesByWhiteboardIdWithRelations,
  findDiagramTableById,
  findDiagramTableByIdWithRelations,
  updateDiagramTable,
  updateDiagramTablePosition,
  deleteDiagramTable,
} from '@/data/diagram-table';
import { createTableSchema, updateTableSchema } from '@/data/schema';

/**
 * Get all tables in a whiteboard
 * @param whiteboardId - Whiteboard UUID
 */
export const getTablesByWhiteboardId = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const tables = await findDiagramTablesByWhiteboardId(whiteboardId);
      return tables;
    } catch (error) {
      throw new Error(
        `Failed to fetch tables: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get all tables in a whiteboard with columns and relationships
 * @param whiteboardId - Whiteboard UUID
 */
export const getTablesByWhiteboardIdWithRelations = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const tables = await findDiagramTablesByWhiteboardIdWithRelations(
        whiteboardId
      );
      return tables;
    } catch (error) {
      throw new Error(
        `Failed to fetch tables with relations: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get a single table by ID
 * @param tableId - Table UUID
 */
export const getTable = createServerFn('GET', async (tableId: string) => {
  // Validate UUID format
  const idSchema = z.string().uuid();
  idSchema.parse(tableId);

  try {
    const table = await findDiagramTableById(tableId);
    if (!table) {
      throw new Error('Table not found');
    }
    return table;
  } catch (error) {
    throw new Error(
      `Failed to fetch table: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

/**
 * Get a single table by ID with columns and relationships
 * @param tableId - Table UUID
 */
export const getTableWithRelations = createServerFn(
  'GET',
  async (tableId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(tableId);

    try {
      const table = await findDiagramTableByIdWithRelations(tableId);
      if (!table) {
        throw new Error('Table not found');
      }
      return table;
    } catch (error) {
      throw new Error(
        `Failed to fetch table with relations: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Create a new table
 * @param data - Table creation data (name, position, etc.)
 */
export const createTableFn = createServerFn('POST', async (data: unknown) => {
  // Validate input with Zod schema
  const validated = createTableSchema.parse(data);

  try {
    const table = await createDiagramTable(validated);
    return table;
  } catch (error) {
    throw new Error(
      `Failed to create table: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

/**
 * Update an existing table
 * @param params - Object with id and data fields
 */
export const updateTableFn = createServerFn(
  'PUT',
  async (params: { id: string; data: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(params.id);

    // Validate update data with Zod schema
    const validated = updateTableSchema.parse(params.data);

    try {
      const table = await updateDiagramTable(params.id, validated);
      return table;
    } catch (error) {
      throw new Error(
        `Failed to update table: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Update table position (for drag-and-drop)
 * @param params - Object with id, positionX, positionY
 */
export const updateTablePositionFn = createServerFn(
  'PUT',
  async (params: { id: string; positionX: number; positionY: number }) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(params.id);

    // Validate position values
    const positionSchema = z.object({
      positionX: z.number().finite(),
      positionY: z.number().finite(),
    });
    positionSchema.parse({
      positionX: params.positionX,
      positionY: params.positionY,
    });

    try {
      const table = await updateDiagramTablePosition(
        params.id,
        params.positionX,
        params.positionY
      );
      return table;
    } catch (error) {
      throw new Error(
        `Failed to update table position: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Delete a table by ID
 * Cascade deletes all columns and relationships connected to this table
 * @param tableId - Table UUID
 */
export const deleteTableFn = createServerFn('DELETE', async (tableId: string) => {
  // Validate UUID format
  const idSchema = z.string().uuid();
  idSchema.parse(tableId);

  try {
    const table = await deleteDiagramTable(tableId);
    return table;
  } catch (error) {
    throw new Error(
      `Failed to delete table: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

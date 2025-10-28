// src/routes/api/whiteboards.ts
// TanStack Start server functions for Whiteboard CRUD operations

import { createServerFn } from '@tanstack/start';
import { z } from 'zod';
import {
  createWhiteboard,
  findWhiteboardsByProjectId,
  findWhiteboardsByFolderId,
  findWhiteboardByIdWithDiagram,
  findWhiteboardById,
  updateWhiteboard,
  updateWhiteboardCanvasState,
  updateWhiteboardTextSource,
  deleteWhiteboard,
} from '@/data/whiteboard';
import {
  createWhiteboardSchema,
  updateWhiteboardSchema,
  canvasStateSchema,
} from '@/data/schema';

/**
 * Get all whiteboards in a project
 * @param projectId - Project UUID
 */
export const getWhiteboardsByProject = createServerFn(
  'GET',
  async (projectId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(projectId);

    try {
      const whiteboards = await findWhiteboardsByProjectId(projectId);
      return whiteboards;
    } catch (error) {
      throw new Error(
        `Failed to fetch whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get all whiteboards in a folder
 * @param folderId - Folder UUID
 */
export const getWhiteboardsByFolder = createServerFn(
  'GET',
  async (folderId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(folderId);

    try {
      const whiteboards = await findWhiteboardsByFolderId(folderId);
      return whiteboards;
    } catch (error) {
      throw new Error(
        `Failed to fetch whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get a single whiteboard by ID with full diagram data
 * Includes tables, columns, and relationships for rendering
 * @param whiteboardId - Whiteboard UUID
 */
export const getWhiteboard = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId);
      if (!whiteboard) {
        throw new Error('Whiteboard not found');
      }
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to fetch whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get a single whiteboard by ID (without diagram data)
 * @param whiteboardId - Whiteboard UUID
 */
export const getWhiteboardById = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const whiteboard = await findWhiteboardById(whiteboardId);
      if (!whiteboard) {
        throw new Error('Whiteboard not found');
      }
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to fetch whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Create a new whiteboard
 * @param data - Whiteboard creation data (name, projectId, optional folderId, canvasState, textSource)
 */
export const createWhiteboardFn = createServerFn(
  'POST',
  async (data: unknown) => {
    // Validate input with Zod schema
    const validated = createWhiteboardSchema.parse(data);

    try {
      const whiteboard = await createWhiteboard(validated);
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to create whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Update an existing whiteboard
 * @param params - Object with id and data fields
 */
export const updateWhiteboardFn = createServerFn(
  'PUT',
  async (params: { id: string; data: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(params.id);

    // Validate update data with Zod schema
    const validated = updateWhiteboardSchema.parse(params.data);

    try {
      const whiteboard = await updateWhiteboard(params.id, validated);
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to update whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Update whiteboard canvas state (zoom, pan)
 * @param params - Object with id and canvasState fields
 */
export const updateCanvasState = createServerFn(
  'PUT',
  async (params: { id: string; canvasState: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(params.id);

    // Validate canvas state with Zod schema
    const validated = canvasStateSchema.parse(params.canvasState);

    try {
      const whiteboard = await updateWhiteboardCanvasState(
        params.id,
        validated
      );
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to update canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Update whiteboard text source
 * @param params - Object with id and textSource fields
 */
export const updateTextSource = createServerFn(
  'PUT',
  async (params: { id: string; textSource: string }) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(params.id);

    // Validate text source
    const textSourceSchema = z.string();
    const validated = textSourceSchema.parse(params.textSource);

    try {
      const whiteboard = await updateWhiteboardTextSource(
        params.id,
        validated
      );
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to update text source: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Delete a whiteboard by ID
 * Cascade deletes all tables, columns, and relationships within the whiteboard
 * @param whiteboardId - Whiteboard UUID
 */
export const deleteWhiteboardFn = createServerFn(
  'DELETE',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const whiteboard = await deleteWhiteboard(whiteboardId);
      return whiteboard;
    } catch (error) {
      throw new Error(
        `Failed to delete whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

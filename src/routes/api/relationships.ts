// src/routes/api/relationships.ts
// TanStack Start server functions for Relationship CRUD operations

import { createServerFn } from '@tanstack/start';
import { z } from 'zod';
import {
  createRelationship,
  findRelationshipsByWhiteboardId,
  findRelationshipsByWhiteboardIdWithDetails,
  findRelationshipById,
  findRelationshipByIdWithDetails,
  findRelationshipsByTableId,
  updateRelationship,
  deleteRelationship,
} from '@/data/relationship';
import {
  createRelationshipSchema,
  updateRelationshipSchema,
} from '@/data/schema';

/**
 * Get all relationships in a whiteboard
 * @param whiteboardId - Whiteboard UUID
 */
export const getRelationshipsByWhiteboardId = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const relationships = await findRelationshipsByWhiteboardId(whiteboardId);
      return relationships;
    } catch (error) {
      throw new Error(
        `Failed to fetch relationships: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get all relationships in a whiteboard with table/column details
 * @param whiteboardId - Whiteboard UUID
 */
export const getRelationshipsByWhiteboardIdWithDetails = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(whiteboardId);

    try {
      const relationships = await findRelationshipsByWhiteboardIdWithDetails(
        whiteboardId
      );
      return relationships;
    } catch (error) {
      throw new Error(
        `Failed to fetch relationships with details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get a single relationship by ID
 * @param relationshipId - Relationship UUID
 */
export const getRelationship = createServerFn(
  'GET',
  async (relationshipId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(relationshipId);

    try {
      const relationship = await findRelationshipById(relationshipId);
      if (!relationship) {
        throw new Error('Relationship not found');
      }
      return relationship;
    } catch (error) {
      throw new Error(
        `Failed to fetch relationship: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get a single relationship by ID with table/column details
 * @param relationshipId - Relationship UUID
 */
export const getRelationshipWithDetails = createServerFn(
  'GET',
  async (relationshipId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(relationshipId);

    try {
      const relationship = await findRelationshipByIdWithDetails(relationshipId);
      if (!relationship) {
        throw new Error('Relationship not found');
      }
      return relationship;
    } catch (error) {
      throw new Error(
        `Failed to fetch relationship with details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Get all relationships connected to a table
 * @param tableId - Table UUID
 */
export const getRelationshipsByTableId = createServerFn(
  'GET',
  async (tableId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(tableId);

    try {
      const relationships = await findRelationshipsByTableId(tableId);
      return relationships;
    } catch (error) {
      throw new Error(
        `Failed to fetch table relationships: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Create a new relationship
 * @param data - Relationship creation data (source/target tables/columns, cardinality)
 */
export const createRelationshipFn = createServerFn(
  'POST',
  async (data: unknown) => {
    // Validate input with Zod schema
    const validated = createRelationshipSchema.parse(data);

    try {
      const relationship = await createRelationship(validated);
      return relationship;
    } catch (error) {
      throw new Error(
        `Failed to create relationship: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Update an existing relationship
 * @param params - Object with id and data fields
 */
export const updateRelationshipFn = createServerFn(
  'PUT',
  async (params: { id: string; data: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(params.id);

    // Validate update data with Zod schema
    const validated = updateRelationshipSchema.parse(params.data);

    try {
      const relationship = await updateRelationship(params.id, validated);
      return relationship;
    } catch (error) {
      throw new Error(
        `Failed to update relationship: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

/**
 * Delete a relationship by ID
 * @param relationshipId - Relationship UUID
 */
export const deleteRelationshipFn = createServerFn(
  'DELETE',
  async (relationshipId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid();
    idSchema.parse(relationshipId);

    try {
      const relationship = await deleteRelationship(relationshipId);
      return relationship;
    } catch (error) {
      throw new Error(
        `Failed to delete relationship: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
);

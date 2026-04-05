// src/routes/api/relationships.ts
// TanStack Start server functions for Relationship CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createRelationship,
  deleteRelationship,
  findRelationshipById,
  findRelationshipByIdWithDetails,
  findRelationshipsByTableId,
  findRelationshipsByWhiteboardId,
  findRelationshipsByWhiteboardIdWithDetails,
  updateRelationship,
} from '@/data/relationship'
import {
  createRelationshipSchema,
  updateRelationshipSchema,
} from '@/data/schema'
import { requireAuth } from '@/lib/auth/middleware'

/**
 * Get all relationships in a whiteboard
 * @param whiteboardId - Whiteboard UUID
 */
export const getRelationshipsByWhiteboardId = createServerFn({ method: 'GET' })
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async (_ctx, whiteboardId) => {
      try {
        const relationships = await findRelationshipsByWhiteboardId(whiteboardId)
        return relationships
      } catch (error) {
        throw new Error(
          `Failed to fetch relationships: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get all relationships in a whiteboard with table/column details
 * @param whiteboardId - Whiteboard UUID
 */
export const getRelationshipsByWhiteboardIdWithDetails = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(whiteboardId)
  })
  .handler(
    requireAuth(async (_ctx, whiteboardId) => {
      try {
        const relationships =
          await findRelationshipsByWhiteboardIdWithDetails(whiteboardId)
        return relationships
      } catch (error) {
        throw new Error(
          `Failed to fetch relationships with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single relationship by ID
 * @param relationshipId - Relationship UUID
 */
export const getRelationship = createServerFn({ method: 'GET' })
  .inputValidator((relationshipId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(relationshipId)
  })
  .handler(
    requireAuth(async (_ctx, relationshipId) => {
      try {
        const relationship = await findRelationshipById(relationshipId)
        if (!relationship) {
          throw new Error('Relationship not found')
        }
        return relationship
      } catch (error) {
        throw new Error(
          `Failed to fetch relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single relationship by ID with table/column details
 * @param relationshipId - Relationship UUID
 */
export const getRelationshipWithDetails = createServerFn({ method: 'GET' })
  .inputValidator((relationshipId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(relationshipId)
  })
  .handler(
    requireAuth(async (_ctx, relationshipId) => {
      try {
        const relationship = await findRelationshipByIdWithDetails(relationshipId)
        if (!relationship) {
          throw new Error('Relationship not found')
        }
        return relationship
      } catch (error) {
        throw new Error(
          `Failed to fetch relationship with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get all relationships connected to a table
 * @param tableId - Table UUID
 */
export const getRelationshipsByTableId = createServerFn({ method: 'GET' })
  .inputValidator((tableId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(tableId)
  })
  .handler(
    requireAuth(async (_ctx, tableId) => {
      try {
        const relationships = await findRelationshipsByTableId(tableId)
        return relationships
      } catch (error) {
        throw new Error(
          `Failed to fetch table relationships: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Create a new relationship
 * @param data - Relationship creation data (source/target tables/columns, cardinality)
 */
export const createRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createRelationshipSchema.parse(data))
  .handler(
    requireAuth(async (_ctx, data) => {
      try {
        const relationship = await createRelationship(data)
        return relationship
      } catch (error) {
        throw new Error(
          `Failed to create relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update an existing relationship
 * @param params - Object with id and data fields
 */
export const updateRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateRelationshipSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async (_ctx, params) => {
      try {
        const relationship = await updateRelationship(params.id, params.data)
        return relationship
      } catch (error) {
        throw new Error(
          `Failed to update relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Delete a relationship by ID
 * @param relationshipId - Relationship UUID
 */
export const deleteRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator((relationshipId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(relationshipId)
  })
  .handler(
    requireAuth(async (_ctx, relationshipId) => {
      try {
        const relationship = await deleteRelationship(relationshipId)
        return relationship
      } catch (error) {
        throw new Error(
          `Failed to delete relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

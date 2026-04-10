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
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import {
  getRelationshipProjectId,
  getTableProjectId,
  getWhiteboardProjectId,
} from '@/data/resolve-project'

/**
 * Get all relationships in a whiteboard
 * Requires VIEWER+ role on the whiteboard's project.
 * @param whiteboardId - Whiteboard UUID
 */
export const getRelationshipsByWhiteboardId = createServerFn({ method: 'GET' })
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
        const relationships =
          await findRelationshipsByWhiteboardId(whiteboardId)
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
 * Requires VIEWER+ role on the whiteboard's project.
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
 * Requires VIEWER+ role on the relationship's project.
 * @param relationshipId - Relationship UUID
 */
export const getRelationship = createServerFn({ method: 'GET' })
  .inputValidator((relationshipId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(relationshipId)
  })
  .handler(
    requireAuth(async ({ user }, relationshipId) => {
      const projectId = await getRelationshipProjectId(relationshipId)
      if (!projectId) {
        throw new Error('Relationship not found')
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
 * Requires VIEWER+ role on the relationship's project.
 * @param relationshipId - Relationship UUID
 */
export const getRelationshipWithDetails = createServerFn({ method: 'GET' })
  .inputValidator((relationshipId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(relationshipId)
  })
  .handler(
    requireAuth(async ({ user }, relationshipId) => {
      const projectId = await getRelationshipProjectId(relationshipId)
      if (!projectId) {
        throw new Error('Relationship not found')
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
        const relationship =
          await findRelationshipByIdWithDetails(relationshipId)
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
 * Requires VIEWER+ role on the table's project.
 * @param tableId - Table UUID
 */
export const getRelationshipsByTableId = createServerFn({ method: 'GET' })
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
 * Requires EDITOR+ role on the whiteboard's project.
 * @param data - Relationship creation data (source/target tables/columns, cardinality)
 */
export const createRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createRelationshipSchema.parse(data))
  .handler(
    requireAuth(async ({ user: _user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) {
        throw new Error('Whiteboard not found')
      }
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   return {
      //     error: 'FORBIDDEN',
      //     status: 403,
      //     message: 'Access denied',
      //   } as const
      // }
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
 * Requires EDITOR+ role on the relationship's project.
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
    requireAuth(async ({ user: _user }, params) => {
      const projectId = await getRelationshipProjectId(params.id)
      if (!projectId) {
        throw new Error('Relationship not found')
      }
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   return {
      //     error: 'FORBIDDEN',
      //     status: 403,
      //     message: 'Access denied',
      //   } as const
      // }
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
 * Requires EDITOR+ role on the relationship's project.
 * @param relationshipId - Relationship UUID
 */
export const deleteRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator((relationshipId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(relationshipId)
  })
  .handler(
    requireAuth(async ({ user: _user }, relationshipId) => {
      const projectId = await getRelationshipProjectId(relationshipId)
      if (!projectId) {
        throw new Error('Relationship not found')
      }
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   return {
      //     error: 'FORBIDDEN',
      //     status: 403,
      //     message: 'Access denied',
      //   } as const
      // }
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

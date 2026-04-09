// src/lib/server-functions.ts
// Server functions for whiteboard operations using TanStack Start

import { createServerFn } from '@tanstack/react-start'
import type { WhiteboardWithDiagram } from '@/data/whiteboard'
import type { CreateTable } from '@/data/diagram-table'
import type {
  CreateRelationship,
  RelationshipWithDetails,
} from '@/data/relationship'
import type { LayoutOptions, LayoutResult } from '@/lib/canvas/layout-engine'
import {
  findWhiteboardByIdWithDiagram,
  updateWhiteboardTextSource,
} from '@/data/whiteboard'
import {
  createDiagramTable,
  updateDiagramTablePosition,
} from '@/data/diagram-table'
import {
  createRelationship,
  findRelationshipsByWhiteboardIdWithDetails,
} from '@/data/relationship'
import { computeLayout } from '@/lib/canvas/layout-engine'
import { prisma } from '@/db'
import { requireAuth } from '@/lib/auth/middleware'
import {
  getTableProjectId,
  getWhiteboardProjectId,
} from '@/data/resolve-project'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'

/**
 * Server function to fetch whiteboard with full diagram data
 */
export const getWhiteboardWithDiagram = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => whiteboardId)
  .handler(
    requireAuth(
      async ({ user: _user }, whiteboardId): Promise<WhiteboardWithDiagram | null> => {
        // NOTE: VIEWER role check intentionally bypassed — any authenticated user can read whiteboards.
        try {
          const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId)
          return whiteboard
        } catch (error) {
          console.error('Error fetching whiteboard:', error)
          throw error
        }
      },
    ),
  )

/**
 * Server function to fetch relationships for a whiteboard with full details
 */
export const getWhiteboardRelationships = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => whiteboardId)
  .handler(
    requireAuth(
      async (
        { user: _user },
        whiteboardId,
      ): Promise<Array<RelationshipWithDetails>> => {
        // NOTE: VIEWER role check intentionally bypassed — any authenticated user can read whiteboards.
        try {
          const relationships =
            await findRelationshipsByWhiteboardIdWithDetails(whiteboardId)
          return relationships
        } catch (error) {
          console.error('Error fetching relationships:', error)
          throw error
        }
      },
    ),
  )

/**
 * Server function to create a new table
 */
export const createTable = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateTable) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        throw new Error('Access denied')
      }
      try {
        const table = await createDiagramTable(data)
        return table
      } catch (error) {
        console.error('Error creating table:', error)
        throw error
      }
    }),
  )

/**
 * Server function to update table position
 */
export const updateTablePosition = createServerFn({
  method: 'POST',
})
  .inputValidator(
    (data: { id: string; positionX: number; positionY: number }) => data,
  )
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getTableProjectId(data.id)
      if (!projectId) throw new Error('Table not found')
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        throw new Error('Access denied')
      }
      try {
        const table = await updateDiagramTablePosition(
          data.id,
          data.positionX,
          data.positionY,
        )
        return table
      } catch (error) {
        console.error('Error updating table position:', error)
        throw error
      }
    }),
  )

/**
 * Server function to create a new relationship
 */
export const createRelationshipFn = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateRelationship) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        throw new Error('Access denied')
      }
      try {
        const relationship = await createRelationship(data)
        return relationship
      } catch (error) {
        console.error('Error creating relationship:', error)
        throw error
      }
    }),
  )

/**
 * Server function to update whiteboard text source
 */
export const updateWhiteboardTextSourceFn = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { whiteboardId: string; textSource: string }) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        throw new Error('Access denied')
      }
      try {
        const whiteboard = await updateWhiteboardTextSource(
          data.whiteboardId,
          data.textSource,
        )
        return whiteboard
      } catch (error) {
        console.error('Error updating text source:', error)
        throw error
      }
    }),
  )

/**
 * Server function to compute automatic layout for whiteboard
 * Runs layout algorithm and updates table positions in database
 */
export const computeAutoLayout = createServerFn({
  method: 'POST',
})
  .inputValidator(
    (data: { whiteboardId: string; options: LayoutOptions }) => data,
  )
  .handler(
    requireAuth(async ({ user }, data): Promise<LayoutResult> => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        throw new Error('Access denied')
      }
      try {
        // Fetch whiteboard with tables and relationships
        const whiteboard = await findWhiteboardByIdWithDiagram(
          data.whiteboardId,
        )
        if (!whiteboard) {
          throw new Error('Whiteboard not found')
        }

        const relationships = await findRelationshipsByWhiteboardIdWithDetails(
          data.whiteboardId,
        )

        // Compute layout
        const layoutResult = computeLayout(
          whiteboard.tables,
          relationships,
          data.options,
        )

        // Update table positions in database (batch update for performance)
        await prisma.$transaction(
          layoutResult.positions.map((pos) =>
            prisma.diagramTable.update({
              where: { id: pos.id },
              data: {
                positionX: pos.x,
                positionY: pos.y,
              },
            }),
          ),
        )

        return layoutResult
      } catch (error) {
        console.error('Error computing auto layout:', error)
        throw error
      }
    }),
  )

/**
 * Server function to save canvas viewport state
 * Stores zoom and pan position in whiteboard canvasState
 */
export const saveCanvasState = createServerFn({
  method: 'POST',
})
  .inputValidator(
    (data: {
      whiteboardId: string
      canvasState: { zoom: number; offsetX: number; offsetY: number }
    }) => data,
  )
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        throw new Error('Access denied')
      }
      try {
        const whiteboard = await prisma.whiteboard.update({
          where: { id: data.whiteboardId },
          data: {
            canvasState: data.canvasState,
          },
        })
        return whiteboard
      } catch (error) {
        console.error('Error saving canvas state:', error)
        throw error
      }
    }),
  )

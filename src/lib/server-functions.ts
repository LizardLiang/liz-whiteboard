// src/lib/server-functions.ts
// Server functions for whiteboard operations using TanStack Start

import { createServerFn } from '@tanstack/react-start'
import type { BulkUpdatePositions } from '@/data/schema'
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
import { bulkUpdatePositionsSchema } from '@/data/schema'
// TODO: restore these imports when permission checks are re-enabled — temporarily disabled
// import { findEffectiveRole } from '@/data/permission'
// import { hasMinimumRole } from '@/lib/auth/permissions'

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
    requireAuth(async ({ user: _user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(_user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   throw new Error('Access denied')
      // }
      void projectId
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
    requireAuth(async ({ user: _user }, data) => {
      const projectId = await getTableProjectId(data.id)
      if (!projectId) throw new Error('Table not found')
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(_user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   throw new Error('Access denied')
      // }
      void projectId
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
 * Server function to bulk-update table positions (used by Auto Layout).
 *
 * Persists N positions atomically in a single prisma.$transaction.
 * Does NOT emit any Socket.IO event — the originator's client emits the
 * table:move:bulk broadcast after this call resolves successfully
 * (mirrors the existing single-table updateTablePositionMutation.onSuccess pattern;
 * resolves Apollo Finding 3 — eliminates the server-functions → routes import edge).
 *
 * NOTE: requireAuth returns AuthErrorResponse on session expiry — it does NOT throw.
 * Callers MUST check the resolved value with isUnauthorizedError() from @/lib/auth/errors.
 */
export const updateTablePositionsBulk = createServerFn({ method: 'POST' })
  .inputValidator((data: BulkUpdatePositions) =>
    bulkUpdatePositionsSchema.parse(data),
  )
  .handler(
    requireAuth(
      async (
        { user: _user },
        data,
      ): Promise<{ success: true; count: number }> => {
        const { whiteboardId, positions } = data

        // IDOR guard: verify the whiteboard exists AND every supplied
        // position.id belongs to it. Single findMany → Set to keep the guard
        // at ONE DB round-trip regardless of N positions (preserves the 2 s budget).
        const projectId = await getWhiteboardProjectId(whiteboardId)
        if (!projectId) throw new Error('Whiteboard not found')
        // TODO: restore permission check — temporarily disabled (matches the
        // codebase pattern in createTable / updateTablePosition)
        void projectId
        void _user // user identity is not needed here; the orchestrator owns the
        //            sender-id field on the socket payload

        const owned = await prisma.diagramTable.findMany({
          where: { whiteboardId },
          select: { id: true },
        })
        const ownedIds = new Set(owned.map((t) => t.id))
        for (const p of positions) {
          if (!ownedIds.has(p.id)) {
            throw new Error('Table does not belong to this whiteboard')
          }
        }

        try {
          // Single transaction — all-or-nothing per NFR Reliability.
          await prisma.$transaction(
            positions.map((p) =>
              prisma.diagramTable.update({
                where: { id: p.id },
                data: { positionX: p.positionX, positionY: p.positionY },
              }),
            ),
          )
        } catch (error) {
          console.error('Error bulk-updating table positions:', error)
          throw error
        }

        return { success: true, count: positions.length }
      },
    ),
  )

/**
 * Server function to create a new relationship
 */
export const createRelationshipFn = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateRelationship) => data)
  .handler(
    requireAuth(async ({ user: _user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(_user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   throw new Error('Access denied')
      // }
      void projectId
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
    requireAuth(async ({ user: _user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(_user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   throw new Error('Access denied')
      // }
      void projectId
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
    requireAuth(async ({ user: _user }, data): Promise<LayoutResult> => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(_user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   throw new Error('Access denied')
      // }
      void projectId
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
    requireAuth(async ({ user: _user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      // TODO: restore permission check — temporarily disabled
      // const role = await findEffectiveRole(_user.id, projectId)
      // if (!hasMinimumRole(role, 'EDITOR')) {
      //   throw new Error('Access denied')
      // }
      void projectId
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

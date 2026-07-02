// src/lib/server-functions.ts
// Server functions for whiteboard operations using TanStack Start

import { createServerFn } from '@tanstack/react-start'
import type {
  BulkUpdatePositions,
  CreateRelationship,
  CreateTable,
} from '@/data/schema'
import type { WhiteboardWithDiagram } from '@/data/whiteboard'
import type { RelationshipWithDetails } from '@/data/relationship'
import type { LayoutOptions, LayoutResult } from '@/lib/canvas/layout-engine'
import type { EffectiveRole } from '@/data/permission'
import {
  findWhiteboardByIdWithDiagram,
  updateWhiteboardCanvasState,
  updateWhiteboardTextSource,
} from '@/data/whiteboard'
import {
  createDiagramTable,
  findDiagramTablesByWhiteboardId,
  updateDiagramTablePosition,
} from '@/data/diagram-table'
import {
  createRelationship,
  findRelationshipsByWhiteboardIdWithDetails,
} from '@/data/relationship'
import { computeLayout } from '@/lib/canvas/layout-engine'
import { nowMs, transaction, update } from '@/db'
import { requireAuth } from '@/lib/auth/middleware'
import { getOAuthConfig } from '@/lib/oauth/config'
import {
  getTableProjectId,
  getWhiteboardProjectId,
} from '@/data/resolve-project'
import { bulkUpdatePositionsSchema } from '@/data/schema'
import { requireServerFnRole } from '@/lib/auth/require-role'
import { findEffectiveRole } from '@/data/permission'

/**
 * WhiteboardWithDiagram plus the requesting user's effective role on the
 * whiteboard's project — mirrors getProjectPageContent's viewerRole field,
 * enabling the client to gate write affordances (Add Table/Relationship,
 * drag) without a second round-trip.
 */
export type WhiteboardWithDiagramAndRole = WhiteboardWithDiagram & {
  viewerRole: EffectiveRole | null
}

/**
 * @requires viewer
 */
export const getWhiteboardWithDiagram = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => whiteboardId)
  .handler(
    requireAuth(
      async (
        { user },
        whiteboardId,
      ): Promise<WhiteboardWithDiagramAndRole | null> => {
        const projectId = await getWhiteboardProjectId(whiteboardId)
        await requireServerFnRole(user.id, projectId, 'VIEWER')
        try {
          const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId)
          if (!whiteboard) return null
          // projectId is guaranteed non-null here — requireServerFnRole
          // throws ForbiddenError above when it is null.
          const viewerRole = await findEffectiveRole(user.id, projectId!)
          return { ...whiteboard, viewerRole }
        } catch (error) {
          console.error('Error fetching whiteboard:', error)
          throw error
        }
      },
    ),
  )

/**
 * @requires viewer
 */
export const getWhiteboardRelationships = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => whiteboardId)
  .handler(
    requireAuth(
      async (
        { user },
        whiteboardId,
      ): Promise<Array<RelationshipWithDetails>> => {
        const projectId = await getWhiteboardProjectId(whiteboardId)
        await requireServerFnRole(user.id, projectId, 'VIEWER')
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
 * @requires editor
 */
export const createTable = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateTable) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * @requires editor
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
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * Persists N positions atomically in a single SQLite transaction.
 * Does NOT emit any Socket.IO event — the originator's client emits the
 * table:move:bulk broadcast after this call resolves successfully
 * (mirrors the existing single-table updateTablePositionMutation.onSuccess pattern;
 * resolves Apollo Finding 3 — eliminates the server-functions → routes import edge).
 *
 * NOTE: requireAuth returns AuthErrorResponse on session expiry — it does NOT throw.
 * Callers MUST check the resolved value with isUnauthorizedError() from @/lib/auth/errors.
 *
 * @requires editor
 */
export const updateTablePositionsBulk = createServerFn({ method: 'POST' })
  .inputValidator((data: BulkUpdatePositions) =>
    bulkUpdatePositionsSchema.parse(data),
  )
  .handler(
    requireAuth(
      async ({ user }, data): Promise<{ success: true; count: number }> => {
        const { whiteboardId, positions } = data

        // IDOR guard: verify the whiteboard exists AND every supplied
        // position.id belongs to it. Both queries are independent — run in
        // parallel to avoid a serial round-trip penalty (B2 fix).
        // In the rare "whiteboard not found" case the findMany returns [] (wasted
        // query), but the request still rejects correctly on the projectId check.
        const [projectId, owned] = await Promise.all([
          getWhiteboardProjectId(whiteboardId),
          findDiagramTablesByWhiteboardId(whiteboardId),
        ])
        await requireServerFnRole(user.id, projectId, 'EDITOR')

        const ownedIds = new Set(owned.map((t) => t.id))
        for (const p of positions) {
          if (!ownedIds.has(p.id)) {
            throw new Error('Table does not belong to this whiteboard')
          }
        }

        try {
          // Single transaction — all-or-nothing per NFR Reliability.
          transaction(() => {
            const ts = nowMs()
            for (const p of positions) {
              update('DiagramTable', p.id, {
                positionX: p.positionX,
                positionY: p.positionY,
                updatedAt: ts,
              })
            }
          })
        } catch (error) {
          console.error('Error bulk-updating table positions:', error)
          throw error
        }

        return { success: true, count: positions.length }
      },
    ),
  )

/**
 * @requires editor
 */
export const createRelationshipFn = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateRelationship) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 * @requires editor
 */
export const updateWhiteboardTextSourceFn = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { whiteboardId: string; textSource: string }) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
 *
 * @requires editor
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
      await requireServerFnRole(user.id, projectId, 'EDITOR')
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
        transaction(() => {
          const ts = nowMs()
          for (const pos of layoutResult.positions) {
            update('DiagramTable', pos.id, {
              positionX: pos.x,
              positionY: pos.y,
              updatedAt: ts,
            })
          }
        })

        return layoutResult
      } catch (error) {
        console.error('Error computing auto layout:', error)
        throw error
      }
    }),
  )

/**
 * Returns the MCP endpoint URL for the user to connect an AI client.
 * The value comes from MCP_RESOURCE_URI env var via getOAuthConfig().
 * @requires viewer (auth enforced for consistency; the URL is not sensitive)
 */
export const getMcpEndpointUrl = createServerFn({ method: 'GET' }).handler(
  requireAuth(async (): Promise<string> => {
    const { mcpResourceUri } = getOAuthConfig()
    return mcpResourceUri
  }),
)

/**
 * Server function to save canvas viewport state
 * Stores zoom and pan position in whiteboard canvasState
 *
 * @requires editor
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
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const whiteboard = await updateWhiteboardCanvasState(
          data.whiteboardId,
          data.canvasState,
        )
        return whiteboard
      } catch (error) {
        console.error('Error saving canvas state:', error)
        throw error
      }
    }),
  )

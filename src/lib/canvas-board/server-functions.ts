// src/lib/canvas-board/server-functions.ts
// The read path for a canvas board page (FigJam-style canvas engine,
// milestone 1, Wave 3), plus create/rename/delete (navigator-create-canvas-
// board tactical plan, step 1).
//
// Wave 3's route has to render an existing board, and no earlier step in the
// tactical plan provides a way to read one — the same gap amendment A4 closed
// for board CREATION. Without this the route is reachable only by
// hand-written SQL.
//
// The read path is read-only. Element mutations and the Socket.IO vocabulary
// are Wave 4; this module gained a `handlers.ts` sibling there, matching how
// `src/lib/share/` and `src/lib/diagram-table/` are laid out. Create/
// rename/delete below are BOARD-level (row) mutations, not element
// mutations, so they stay here as ordinary server functions rather than
// socket events — mirroring how `createWhiteboardFn` /
// `updateWhiteboardFn` / `deleteWhiteboardFn` live in
// `src/routes/api/whiteboards.ts` alongside that board kind's reads.
//
// Authorisation is the EXISTING project-role machinery, unchanged:
// `requireServerFnRole(user.id, projectId, 'VIEWER'|'EDITOR')`, exactly as
// `getWhiteboardWithDiagram` / `createWhiteboardFn` do. Canvas boards are a
// new board kind, not a new permission model.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { EffectiveRole } from '@/data/permission'
import type { CanvasBoard, CanvasElementRecord } from '@/data/models'
import { requireAuth } from '@/lib/auth/middleware'
import { requireServerFnRole } from '@/lib/auth/require-role'
import { findEffectiveRole } from '@/data/permission'
import { getCanvasBoardProjectId } from '@/data/resolve-project'
import {
  createCanvasBoard,
  deleteCanvasBoard,
  findCanvasBoardById,
  updateCanvasBoard,
} from '@/data/canvas-board'
import { createCanvasBoardSchema, updateCanvasBoardSchema } from '@/data/schema'
import { findCanvasElementsByBoard } from '@/data/canvas-element'

/**
 * Everything the canvas route needs in one round-trip: the board, its
 * elements in paint order, and the caller's effective role.
 *
 * `viewerRole` travels with the payload — mirroring
 * `WhiteboardWithDiagramAndRole` — so the client can gate write affordances
 * without a second request. It is a convenience for the UI and NOT the
 * security boundary: Wave 4's mutations re-check the role server side, since
 * anything the client is handed is client-controlled from then on.
 */
export interface CanvasBoardPageData {
  board: CanvasBoard
  elements: Array<CanvasElementRecord>
  viewerRole: EffectiveRole | null
}

/**
 * Load a canvas board with its elements.
 *
 * @requires viewer
 */
export const getCanvasBoardPage = createServerFn({ method: 'GET' })
  .inputValidator((boardId: string) => boardId)
  .handler(
    requireAuth(
      async ({ user }, boardId): Promise<CanvasBoardPageData | null> => {
        const projectId = await getCanvasBoardProjectId(boardId)
        // Throws ForbiddenError for both "no access" and "no such board" —
        // SEC-ERR-03, the same conflation every other read here makes, so a
        // probe cannot enumerate board ids.
        await requireServerFnRole(user.id, projectId, 'VIEWER')

        try {
          const board = await findCanvasBoardById(boardId)
          if (!board) return null
          const elements = await findCanvasElementsByBoard(boardId)
          // projectId is guaranteed non-null here — requireServerFnRole
          // throws above when it is null.
          const viewerRole = await findEffectiveRole(user.id, projectId!)
          return { board, elements, viewerRole }
        } catch (error) {
          console.error('Error fetching canvas board:', error)
          throw error
        }
      },
    ),
  )

/**
 * Create a canvas board.
 * Requires EDITOR+ role on the project.
 * @requires editor
 */
export const createCanvasBoardFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createCanvasBoardSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      await requireServerFnRole(user.id, data.projectId, 'EDITOR')
      try {
        const board = await createCanvasBoard(data)
        return board
      } catch (error) {
        throw new Error(
          `Failed to create canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Rename or re-file an existing canvas board.
 * Requires EDITOR+ role on the board's project.
 * @requires editor
 */
export const updateCanvasBoardFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateCanvasBoardSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, params) => {
      const projectId = await getCanvasBoardProjectId(params.id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const board = await updateCanvasBoard(params.id, params.data)
        return board
      } catch (error) {
        throw new Error(
          `Failed to update canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Delete a canvas board by ID.
 * Requires EDITOR+ role on the board's project.
 * Cascade deletes all elements on the board (schema FK, ON DELETE CASCADE).
 * @requires editor
 */
export const deleteCanvasBoardFn = createServerFn({ method: 'POST' })
  .inputValidator((boardId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(boardId)
  })
  .handler(
    requireAuth(async ({ user }, boardId) => {
      const projectId = await getCanvasBoardProjectId(boardId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const board = await deleteCanvasBoard(boardId)
        return board
      } catch (error) {
        throw new Error(
          `Failed to delete canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

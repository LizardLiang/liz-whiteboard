// src/lib/canvas-board/server-functions.ts
// The read path for a canvas board page (FigJam-style canvas engine,
// milestone 1, Wave 3).
//
// Wave 3's route has to render an existing board, and no earlier step in the
// tactical plan provides a way to read one — the same gap amendment A4 closed
// for board CREATION. Without this the route is reachable only by
// hand-written SQL.
//
// Deliberately read-only. Element mutations and the Socket.IO vocabulary are
// Wave 4; this module gains a `handlers.ts` sibling there, matching how
// `src/lib/share/` and `src/lib/diagram-table/` are laid out.
//
// Authorisation is the EXISTING project-role machinery, unchanged:
// `requireServerFnRole(user.id, projectId, 'VIEWER')`, exactly as
// `getWhiteboardWithDiagram` does. Canvas boards are a new board kind, not a
// new permission model.

import { createServerFn } from '@tanstack/react-start'
import type { EffectiveRole } from '@/data/permission'
import type { CanvasBoard, CanvasElementRecord } from '@/data/models'
import { requireAuth } from '@/lib/auth/middleware'
import { requireServerFnRole } from '@/lib/auth/require-role'
import { findEffectiveRole } from '@/data/permission'
import { getCanvasBoardProjectId } from '@/data/resolve-project'
import { findCanvasBoardById } from '@/data/canvas-board'
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

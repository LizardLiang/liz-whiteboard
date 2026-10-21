// src/lib/render/handlers.ts
// Handler logic for the headless render pages' server function. Kept out of
// src/routes/api/render.ts for the same reason src/lib/share/handlers.ts is
// kept out of src/routes/api/share.ts: the createServerFn wrapper is imported
// by client route components, and the data-layer imports here must stay
// tree-shakeable out of the browser bundle.

import { hasMinimumRole } from '@/lib/auth/permissions'
import { findEffectiveRole } from '@/data/permission'
import {
  getCanvasBoardProjectId,
  getWhiteboardProjectId,
} from '@/data/resolve-project'
import { findWhiteboardByIdWithDiagram } from '@/data/whiteboard'
import { findRelationshipsByWhiteboardIdWithDetails } from '@/data/relationship'
import { findShapesByWhiteboard } from '@/data/shape'
import { findConnectorsByWhiteboard } from '@/data/connector'
import { findCanvasBoardById } from '@/data/canvas-board'
import { findCanvasElementsByBoard } from '@/data/canvas-element'
import { verifyRenderToken } from '@/lib/render/render-token'

export type RenderDenialReason = 'INVALID' | 'EXPIRED'

/**
 * Resolve a render token into the board data its page draws.
 *
 * Never throws: a bad, expired or unauthorized token resolves to
 * `{ valid: false }` so the page shows an invalid state instead of a crash.
 *
 * The board id and kind come from the verified token EXCLUSIVELY. The role is
 * checked again here, not only at mint time, so a membership removed inside
 * the token's 60 second life stops the render. A missing board and a missing
 * role both resolve to INVALID: the page reveals nothing about which.
 */
export async function getRenderBoardHandler(token: string) {
  let claims
  try {
    claims = await verifyRenderToken(token)
  } catch (error) {
    const code = (error as { code?: string }).code
    return {
      valid: false as const,
      reason: (code === 'ERR_JWT_EXPIRED'
        ? 'EXPIRED'
        : 'INVALID') as RenderDenialReason,
    }
  }

  const projectId =
    claims.kind === 'canvas'
      ? await getCanvasBoardProjectId(claims.boardId)
      : await getWhiteboardProjectId(claims.boardId)
  if (!projectId) return invalid()

  const role = await findEffectiveRole(claims.sub, projectId)
  if (!hasMinimumRole(role, 'VIEWER')) return invalid()

  if (claims.kind === 'canvas') {
    const board = await findCanvasBoardById(claims.boardId)
    if (!board) return invalid()
    const elements = await findCanvasElementsByBoard(claims.boardId)
    return {
      valid: true as const,
      kind: 'canvas' as const,
      canvasBoardId: board.id,
      canvasBoardName: board.name,
      elements,
    }
  }

  const whiteboard = await findWhiteboardByIdWithDiagram(claims.boardId)
  if (!whiteboard) return invalid()
  const relationships = await findRelationshipsByWhiteboardIdWithDetails(
    claims.boardId,
  )
  const shapes = await findShapesByWhiteboard(claims.boardId)
  const connectors = await findConnectorsByWhiteboard(claims.boardId)
  return {
    valid: true as const,
    kind: 'whiteboard' as const,
    whiteboardId: whiteboard.id,
    whiteboardName: whiteboard.name,
    tables: whiteboard.tables,
    relationships,
    shapes,
    connectors,
  }
}

function invalid() {
  return { valid: false as const, reason: 'INVALID' as RenderDenialReason }
}

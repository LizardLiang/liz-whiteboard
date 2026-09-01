// src/routes/api/canvas-share.ts
// Server-fn wrappers for canvas-board read-only share links. The canvas
// counterpart of src/routes/api/share.ts and deliberately just as THIN: it
// only wires createServerFn + requireAuth around handler functions imported
// from src/lib/share/canvas-handlers.ts.
//
// Client components import the createServerFn-wrapped consts from THIS file.
// The handler logic must stay in the other module — see its header for the
// bundler failure that keeping it here would cause.

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  createCanvasShareLinkHandler,
  getSharedCanvasBoardHandler,
  listCanvasShareLinksHandler,
  revokeCanvasShareLinkHandler,
} from '@/lib/share/canvas-handlers'
import {
  createCanvasShareLinkSchema,
  revokeCanvasShareLinkSchema,
} from '@/data/schema'

/**
 * @requires admin
 */
export const createCanvasShareLink = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createCanvasShareLinkSchema.parse(data))
  .handler(requireAuth(createCanvasShareLinkHandler))

/**
 * @requires admin
 */
export const revokeCanvasShareLink = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => revokeCanvasShareLinkSchema.parse(data))
  .handler(requireAuth(revokeCanvasShareLinkHandler))

/**
 * List every read-only share link on one canvas board.
 * @requires admin
 */
export const listCanvasShareLinks = createServerFn({ method: 'GET' })
  .inputValidator((canvasBoardId: unknown) => {
    if (typeof canvasBoardId !== 'string') {
      throw new Error('Invalid canvasBoardId')
    }
    return canvasBoardId
  })
  .handler(requireAuth(listCanvasShareLinksHandler))

/**
 * @requires unauthenticated
 */
export const getSharedCanvasBoard = createServerFn({ method: 'GET' })
  .inputValidator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => getSharedCanvasBoardHandler(token))

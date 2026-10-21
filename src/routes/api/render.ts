// src/routes/api/render.ts
// Server function behind the headless render pages (/render/whiteboard/$token
// and /render/canvas/$token). Deliberately thin: the handler lives in
// src/lib/render/handlers.ts so its data-layer imports stay out of the client
// bundle (see that file and src/routes/api/share.ts for the full reason).

import { createServerFn } from '@tanstack/react-start'
import { getRenderBoardHandler } from '@/lib/render/handlers'

/**
 * Authorization is the signed render token, verified and role-checked inside
 * the handler.
 * @requires unauthenticated
 */
export const getRenderBoard = createServerFn({ method: 'GET' })
  .inputValidator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => getRenderBoardHandler(token))

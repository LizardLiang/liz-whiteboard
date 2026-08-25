// src/lib/canvas-board/handlers.ts
// Socket.IO handlers for canvas element mutations (tactical plan Wave 4,
// step 14) and the canvas namespace they live on.
//
// Mirrors the shape/connector block in src/routes/api/collaboration.ts
// structure-for-structure, because that is what the plan asks for and because
// a reviewer should be able to read the two side by side:
//
//   session-expiry check -> role check -> ownership lookup -> Zod parse
//   -> data-layer call -> socket.broadcast.emit -> cb?.()
//
// Two things are deliberately DIFFERENT from that block, both forced:
//
//  1. Authorisation goes through `requireCanvasBoardRole`, not `requireRole`.
//     A canvas board is a separate table, so resolving its project through
//     `getWhiteboardProjectId` returns null and every event would be denied as
//     not-found. Same checks, different resolver.
//  2. No `CollaborationSession` row and no presence. That table foreign-keys
//     `Whiteboard`, and presence/cursors are out of scope per plan E2.
//
// Unlike the shape handlers, `registerCanvasElementHandlers` is EXPORTED, so
// its tests drive the real function instead of a reimplementation of it.

import { z } from 'zod'
import type { Server as SocketIOServer } from 'socket.io'
import {
  createCanvasElementSchema,
  updateCanvasElementSchema,
} from '@/data/schema'
import {
  RevisionMismatchError,
  createCanvasElement,
  deleteCanvasElement,
  findCanvasElementById,
  nextCanvasZIndex,
  updateCanvasElement,
} from '@/data/canvas-element'
import {
  authenticateSocketHandshake,
  isSocketSessionExpired,
} from '@/lib/auth/socket-handshake'
import { requireCanvasBoardRole } from '@/lib/auth/require-role'

/**
 * Ack payload for canvas mutations. Structurally the same union
 * `collaboration.ts` uses for every other entity — declared here rather than
 * imported so this library module does not depend on a route module.
 */
export type CanvasAckResult =
  | { ok: true; entity: unknown }
  | {
      ok: false
      code:
        | 'VALIDATION_ERROR'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'SESSION_EXPIRED'
        | 'INTERNAL_ERROR'
        // The target was written or deleted since the caller's
        // `expectedRevision` was read — undo's contested-target refusal
        // (board-undo tactical plan, Wave 1, step 4). Distinct from
        // VALIDATION_ERROR: the payload was well-formed, the row just moved.
        | 'REVISION_MISMATCH'
      message: string
    }

/** The minimum socket surface these handlers use. */
export interface CanvasSocket {
  data: Record<string, unknown>
  on: (event: string, handler: (...args: Array<any>) => void) => void
  emit: (event: string, payload: unknown) => void
  broadcast: { emit: (event: string, payload: unknown) => void }
  disconnect: (close?: boolean) => void
}

type Ack = ((res: CanvasAckResult) => void) | undefined

/**
 * True when the caller was rejected and the handler must return immediately.
 *
 * Both gates live in one function so no event can register with only one of
 * them: an expired session must not mutate, and neither must a VIEWER.
 * `minRole` is EDITOR, exactly as every shape mutation uses.
 */
async function denyMutation(
  socket: CanvasSocket,
  boardId: string,
  eventName: string,
  cb: Ack,
): Promise<boolean> {
  if (isSocketSessionExpired(socket)) {
    socket.emit('session_expired', {})
    socket.disconnect(true)
    cb?.({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' })
    return true
  }
  if (
    await requireCanvasBoardRole(
      socket as unknown as {
        data: { userId: string }
        emit: (e: string, p: any) => void
      },
      boardId,
      eventName,
      'EDITOR',
    )
  ) {
    cb?.({ ok: false, code: 'FORBIDDEN', message: 'Insufficient permission' })
    return true
  }
  return false
}

/**
 * The single refusal used for both "no such element" and "element belongs to
 * another board".
 *
 * One response for both is deliberate. Distinct codes would let any editor on
 * any board probe an id and learn whether it exists somewhere else — an
 * element-existence oracle across every board in the instance. `shape:delete`
 * does return distinct codes; this is stricter than its precedent on purpose,
 * and the client needs no distinction (the hook branches only on `res.ok`).
 */
const ELEMENT_REFUSED = 'Canvas element not found on this board'

/**
 * Load an element and prove it belongs to THIS board (IDOR guard).
 *
 * The role check authorises the caller for `boardId` and nothing more.
 * Without this, an editor on board A could pass an element id from board B
 * and have the mutation authorised against the wrong board — the same guard
 * `shape:update` and `shape:delete` carry (FR-037).
 */
async function loadOwnedElement(
  socket: CanvasSocket,
  boardId: string,
  elementId: string,
  eventName: string,
  cb: Ack,
) {
  const record = await findCanvasElementById(elementId)
  if (!record || record.boardId !== boardId) {
    socket.emit('error', {
      event: eventName,
      error: 'NOT_FOUND',
      message: ELEMENT_REFUSED,
      elementId,
    })
    cb?.({ ok: false, code: 'NOT_FOUND', message: ELEMENT_REFUSED })
    return null
  }
  return record
}

/**
 * Register `element:create` / `element:update` / `element:delete` on a canvas
 * socket. Broadcasts `element:created` / `element:updated` / `element:deleted`
 * to every OTHER client on the board — the per-entity CRUD vocabulary the rest
 * of this app already speaks.
 */
export function registerCanvasElementHandlers(
  socket: CanvasSocket,
  boardId: string,
  userId: string,
): void {
  socket.on('element:create', async (data: unknown, cb: Ack) => {
    if (await denyMutation(socket, boardId, 'element:create', cb)) return

    try {
      // `boardId` comes from the SERVER and is spread last, so a payload
      // naming a different board cannot redirect the write. The role check
      // authorised this board and only this board.
      //
      // `zIndex` is USUALLY server-computed too — the client's own z-index is
      // stale the moment a collaborator adds anything, so two clients drawing
      // at once would both claim the same top slot if the client's value were
      // trusted. `MAX(zIndex) + 1` in SQL is correct regardless of what either
      // client has seen.
      //
      // The one exception is undo's restore path for a deleted element:
      // `data.id`, when present, flows straight through
      // `createCanvasElementSchema` (which validates it like any other field)
      // and through the SAME `denyMutation` gate above — no privileged,
      // undo-only write path exists here or anywhere else. A restore MUST
      // also honour the ORIGINAL `zIndex` it carries, or "Canvas Undo Restores
      // Deleted Elements Faithfully" (which names stacking order explicitly)
      // is violated: the element would resurrect on top of the board instead
      // of back where it was.
      //
      // Gating the exception on `id` being present (rather than a separate
      // "isRestore" flag) grants no new capability to an ordinary create: any
      // editor can already set an element's zIndex to anything within
      // `canvasZIndexSchema`'s bounds via `element:update` immediately after
      // creating it, so trusting a client-supplied zIndex ONLY on the
      // create-with-id path does not open a second, wider channel to the
      // same value — it only lets a restore land in the right place in one
      // write instead of two.
      const payload = data as Record<string, unknown>
      const hasExplicitId = typeof payload.id === 'string'
      const hasNumericZIndex = typeof payload.zIndex === 'number'
      const zIndex =
        hasExplicitId && hasNumericZIndex
          ? (payload.zIndex as number)
          : await nextCanvasZIndex(boardId)
      // Same restore-only gating as `zIndex` immediately above, for the same
      // reason: `minRevision` seeds the restored row's revision ABOVE the
      // deleted row's last one, closing an ABA hole where a stale undo/redo
      // entry could otherwise match a freshly-restored row's revision by
      // coincidence (Hermes review, W-C). Gated on `id` being present, not a
      // separate flag — an ordinary create spreads `payload` first and this
      // key overrides whatever it sent, so a client cannot set it without
      // ALSO supplying the id undo already knows.
      const hasNumericMinRevision = typeof payload.minRevision === 'number'
      const minRevision =
        hasExplicitId && hasNumericMinRevision
          ? (payload.minRevision as number)
          : undefined
      const validated = createCanvasElementSchema.parse({
        ...payload,
        boardId,
        zIndex,
        minRevision,
      })
      const element = await createCanvasElement(validated)
      socket.broadcast.emit('element:created', {
        ...element,
        createdBy: userId,
      })
      cb?.({ ok: true, entity: element })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to create canvas element'
      console.error('Failed to create canvas element:', error)
      socket.emit('error', {
        event: 'element:create',
        error: 'VALIDATION_ERROR',
        message,
      })
      cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
    }
  })

  socket.on(
    'element:update',
    async (data: { elementId?: string; [key: string]: unknown }, cb: Ack) => {
      if (await denyMutation(socket, boardId, 'element:update', cb)) return

      const parsedId = z
        .object({
          elementId: z.string().uuid(),
          // Undo's conditional-write guard (board-undo tactical plan, Wave
          // 1, step 4). Absent for an ordinary forward edit, which keeps
          // last-write-wins.
          expectedRevision: z.number().int().nonnegative().optional(),
        })
        .safeParse(data)
      if (!parsedId.success) {
        const message = 'Invalid element:update payload'
        socket.emit('error', {
          event: 'element:update',
          error: 'VALIDATION_ERROR',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
        return
      }
      const { elementId, expectedRevision } = parsedId.data

      try {
        const existing = await loadOwnedElement(
          socket,
          boardId,
          elementId,
          'element:update',
          cb,
        )
        if (!existing) return

        const {
          elementId: _ignoredId,
          expectedRevision: _ignoredExpectedRevision,
          ...updateData
        } = data
        const validated = updateCanvasElementSchema.parse(updateData)
        const updated = await updateCanvasElement(
          elementId,
          validated,
          expectedRevision,
        )
        // Carries `updatedAt`/`revision` for the same reason the shape
        // broadcast carries `updatedAt`: every peer holds a fresh token for
        // the row it just re-rendered, and `revision` is the token undo
        // compares.
        socket.broadcast.emit('element:updated', {
          elementId,
          ...validated,
          updatedAt: updated.updatedAt,
          revision: updated.revision,
          updatedBy: userId,
        })
        cb?.({ ok: true, entity: updated })
      } catch (error) {
        if (error instanceof RevisionMismatchError) {
          cb?.({ ok: false, code: 'REVISION_MISMATCH', message: error.message })
          return
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to update canvas element'
        console.error('Failed to update canvas element:', error)
        socket.emit('error', {
          event: 'element:update',
          error: 'UPDATE_FAILED',
          message,
        })
        cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
      }
    },
  )

  socket.on('element:delete', async (data: unknown, cb: Ack) => {
    if (await denyMutation(socket, boardId, 'element:delete', cb)) return

    const parsed = z
      .object({
        elementId: z.string().uuid(),
        // Undo's conditional-delete guard (board-undo tactical plan, Wave 1,
        // step 4). Absent for an ordinary forward delete.
        expectedRevision: z.number().int().nonnegative().optional(),
      })
      .safeParse(data)
    if (!parsed.success) {
      const message = 'Invalid element:delete payload'
      socket.emit('error', {
        event: 'element:delete',
        error: 'VALIDATION_ERROR',
        message,
      })
      cb?.({ ok: false, code: 'VALIDATION_ERROR', message })
      return
    }
    const { elementId, expectedRevision } = parsed.data

    try {
      const existing = await loadOwnedElement(
        socket,
        boardId,
        elementId,
        'element:delete',
        cb,
      )
      if (!existing) return

      await deleteCanvasElement(elementId, expectedRevision)
      socket.broadcast.emit('element:deleted', {
        elementId,
        // Pre-delete revision — there is no row left to read one from.
        revision: existing.revision,
        deletedBy: userId,
      })
      cb?.({
        ok: true,
        // Pre-delete `updatedAt`/`revision` — there is no row left to read
        // either from.
        entity: {
          elementId,
          updatedAt: existing.updatedAt,
          revision: existing.revision,
        },
      })
    } catch (error) {
      if (error instanceof RevisionMismatchError) {
        cb?.({ ok: false, code: 'REVISION_MISMATCH', message: error.message })
        return
      }
      console.error('Failed to delete canvas element:', error)
      const message = 'Failed to delete canvas element'
      socket.emit('error', {
        event: 'element:delete',
        error: 'DELETE_FAILED',
        message,
        elementId,
      })
      cb?.({ ok: false, code: 'INTERNAL_ERROR', message })
    }
  })
}

/**
 * The `/canvas/:boardId` namespace.
 *
 * Separate from `/whiteboard/:id` because the two board kinds resolve their
 * project differently — see the file header. Connection requires VIEWER; every
 * mutation requires EDITOR, so a viewer connects, receives broadcasts, and is
 * refused every write.
 */
export function setupCanvasNamespace(ioServer: SocketIOServer): void {
  const canvasNsp = ioServer.of(/^\/canvas\/[\w-]+$/)

  canvasNsp.use(authenticateSocketHandshake)

  canvasNsp.on('connection', async (socket) => {
    const boardId = socket.nsp.name.replace('/canvas/', '')
    const userId = socket.data.userId as string | undefined

    if (!userId) {
      socket.disconnect(true)
      return
    }

    // Authentication is not authorisation: the handshake middleware proved
    // who this is, not that they may see this board.
    if (await requireCanvasBoardRole(socket, boardId, 'connection', 'VIEWER')) {
      socket.disconnect(true)
      return
    }

    // No CollaborationSession row and no active-user list: that table
    // foreign-keys Whiteboard, and presence is out of scope (plan E2). The
    // event is still emitted so the client's connection state settles.
    socket.emit('connected', { sessionId: null, activeUsers: [] })

    registerCanvasElementHandlers(
      socket as unknown as CanvasSocket,
      boardId,
      userId,
    )
  })
}

// src/hooks/use-whiteboard-comments.ts
// Canvas comment state + realtime CRUD (GH #110). Consumes the generic
// socket primitives (on/off/emit) from useWhiteboardCollaboration so it
// shares the single whiteboard connection — mirrors use-whiteboard-areas.ts.
// Comments are loaded once via getWhiteboardComments and then kept live
// through comment:created/updated/resolved/deleted events.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CommentWithAuthor } from '@/data/models'
import type { CreateComment } from '@/data/schema'
import { getWhiteboardComments } from '@/lib/server-functions'
import { isUnauthorizedError } from '@/lib/auth/errors'

type Emit = (event: string, data: any, ack?: (res: any) => void) => void
type On = (event: string, handler: (...args: Array<any>) => void) => void
type Off = (event: string, handler: (...args: Array<any>) => void) => void

interface AckResult {
  ok: boolean
  entity?: CommentWithAuthor
  message?: string
}

export interface UseWhiteboardCommentsReturn {
  comments: Array<CommentWithAuthor>
  /** Create a root thread (table or point target) or a reply (parentId set). */
  createComment: (
    input: Omit<CreateComment, 'whiteboardId'>,
    cb?: (res: AckResult) => void,
  ) => void
  addReply: (parentId: string, body: string) => void
  editComment: (commentId: string, body: string) => void
  deleteComment: (commentId: string) => void
  resolveComment: (commentId: string, resolved: boolean) => void
}

export function useWhiteboardComments(params: {
  whiteboardId: string
  userId: string
  enabled: boolean
  on: On
  off: Off
  emit: Emit
}): UseWhiteboardCommentsReturn {
  const { whiteboardId, userId, enabled, on, off, emit } = params
  const [comments, setComments] = useState<Array<CommentWithAuthor>>([])

  // Mirrors `comments` synchronously (no dependency-array churn on the
  // mutator callbacks below). React's setState functional updaters run
  // during the next render/commit, NOT synchronously — so a value captured
  // inside a setComments(prev => ...) updater is not yet available if the
  // server ack fires in the same tick (a rejected ack can resolve
  // synchronously). Reading commentsRef.current before the optimistic
  // setComments call gives each mutator a definite prior snapshot to revert
  // to, independent of React's scheduling.
  const commentsRef = useRef(comments)
  useEffect(() => {
    commentsRef.current = comments
  }, [comments])

  // Initial load — disabled on the public read-only path (getWhiteboardComments
  // is requireAuth-gated, mirroring the areas/relationships queries). This
  // also means comments never appear in the version-history preview canvas
  // (which renders with collaborationEnabled=false) — comments are live
  // discussion metadata, deliberately excluded from snapshots.
  const { data } = useQuery({
    queryKey: ['comments', whiteboardId],
    queryFn: async () => getWhiteboardComments({ data: whiteboardId }),
    staleTime: 1000 * 60 * 5,
    enabled,
  })

  useEffect(() => {
    // Session expired — root-provider's global handler surfaces the
    // session-expired modal; nothing to reconcile locally.
    if (data && !isUnauthorizedError(data)) setComments(data)
  }, [data])

  // Live sync from other collaborators.
  useEffect(() => {
    if (!enabled) return

    const onCreated = (comment: CommentWithAuthor & { createdBy: string }) => {
      if (comment.createdBy === userId) return
      setComments((prev) =>
        prev.some((c) => c.id === comment.id) ? prev : [...prev, comment],
      )
    }
    const onUpdated = (payload: {
      commentId: string
      body: string
      updatedBy: string
    }) => {
      if (payload.updatedBy === userId) return
      setComments((prev) =>
        prev.map((c) =>
          c.id === payload.commentId ? { ...c, body: payload.body } : c,
        ),
      )
    }
    const onResolved = (payload: {
      commentId: string
      resolved: boolean
      resolvedBy: string | null
      resolvedAt: string | Date | null
      updatedBy: string
    }) => {
      if (payload.updatedBy === userId) return
      setComments((prev) =>
        prev.map((c) =>
          c.id === payload.commentId
            ? {
                ...c,
                resolved: payload.resolved,
                resolvedBy: payload.resolvedBy,
                resolvedAt: payload.resolvedAt
                  ? new Date(payload.resolvedAt)
                  : null,
              }
            : c,
        ),
      )
    }
    const onDeleted = (payload: {
      commentId: string
      deletedBy: string
      /** Set when this delete is a side effect of a table:delete cascade
       * (GH #110 — Comment.targetTableId is ON DELETE CASCADE). The acting
       * user's own client never optimistically removed this comment (only
       * the table/edge nodes), so — unlike a direct comment:delete — the
       * self-skip guard below must NOT apply to the deleter either. */
      cascade?: boolean
    }) => {
      if (!payload.cascade && payload.deletedBy === userId) return
      // A deleted root takes its replies with it (server-side FK cascade) —
      // mirror that locally so the thread disappears in one tick.
      setComments((prev) =>
        prev.filter(
          (c) => c.id !== payload.commentId && c.parentId !== payload.commentId,
        ),
      )
    }

    on('comment:created', onCreated)
    on('comment:updated', onUpdated)
    on('comment:resolved', onResolved)
    on('comment:deleted', onDeleted)
    return () => {
      off('comment:created', onCreated)
      off('comment:updated', onUpdated)
      off('comment:resolved', onResolved)
      off('comment:deleted', onDeleted)
    }
  }, [enabled, on, off, userId])

  // Create — waits for the server ack so we get the real id + author fields.
  const createComment = useCallback(
    (
      input: Omit<CreateComment, 'whiteboardId'>,
      cb?: (res: AckResult) => void,
    ) => {
      emit('comment:create', { ...input, whiteboardId }, (res: AckResult) => {
        if (res.ok && res.entity) {
          const created = res.entity
          setComments((prev) =>
            prev.some((c) => c.id === created.id) ? prev : [...prev, created],
          )
        } else {
          toast.error(res.message ?? 'Failed to create comment')
        }
        cb?.(res)
      })
    },
    [emit, whiteboardId],
  )

  const addReply = useCallback(
    (parentId: string, body: string) => {
      createComment({ parentId, body } as Omit<CreateComment, 'whiteboardId'>)
    },
    [createComment],
  )

  // Edit — optimistic local merge, then emit. On a rejected ack (e.g.
  // FORBIDDEN — the record wasn't ours after all), revert only the affected
  // comment's body via a functional update, never a blanket array restore —
  // a concurrent broadcast may have landed on other rows mid-roundtrip.
  const editComment = useCallback(
    (commentId: string, body: string) => {
      const priorBody = commentsRef.current.find(
        (c) => c.id === commentId,
      )?.body
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, body } : c)),
      )
      emit('comment:update', { commentId, body }, (res: AckResult) => {
        if (!res.ok) {
          toast.error(res.message ?? 'Failed to edit comment')
          if (priorBody !== undefined) {
            setComments((prev) =>
              prev.map((c) =>
                c.id === commentId ? { ...c, body: priorBody } : c,
              ),
            )
          }
        }
      })
    },
    [emit],
  )

  // Resolve/reopen — optimistic local merge, then emit. Revert only the
  // affected comment's resolved fields on a rejected ack (see editComment).
  const resolveComment = useCallback(
    (commentId: string, resolved: boolean) => {
      const existing = commentsRef.current.find((c) => c.id === commentId)
      const prior = existing
        ? {
            resolved: existing.resolved,
            resolvedBy: existing.resolvedBy,
            resolvedAt: existing.resolvedAt,
          }
        : undefined
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                resolved,
                resolvedBy: resolved ? userId : null,
                resolvedAt: resolved ? new Date() : null,
              }
            : c,
        ),
      )
      emit('comment:resolve', { commentId, resolved }, (res: AckResult) => {
        if (!res.ok) {
          toast.error(res.message ?? 'Failed to update thread')
          if (prior !== undefined) {
            setComments((prev) =>
              prev.map((c) => (c.id === commentId ? { ...c, ...prior } : c)),
            )
          }
        }
      })
    },
    [emit, userId],
  )

  // Delete — optimistic remove (root takes its replies with it), then emit.
  // Revert by re-inserting only the removed rows on a rejected ack (see
  // editComment) — a blanket restore of the whole array could clobber a
  // concurrent broadcast that arrived while the ack was in flight.
  const deleteComment = useCallback(
    (commentId: string) => {
      const removed = commentsRef.current.filter(
        (c) => c.id === commentId || c.parentId === commentId,
      )
      setComments((prev) =>
        prev.filter((c) => c.id !== commentId && c.parentId !== commentId),
      )
      emit('comment:delete', { commentId }, (res: AckResult) => {
        if (!res.ok) {
          toast.error(res.message ?? 'Failed to delete comment')
          if (removed.length > 0) {
            setComments((prev) => {
              const existingIds = new Set(prev.map((c) => c.id))
              const toRestore = removed.filter((c) => !existingIds.has(c.id))
              return toRestore.length > 0 ? [...prev, ...toRestore] : prev
            })
          }
        }
      })
    },
    [emit],
  )

  return {
    comments,
    createComment,
    addReply,
    editComment,
    deleteComment,
    resolveComment,
  }
}

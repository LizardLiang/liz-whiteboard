// src/hooks/use-whiteboard-collaboration.ts
// React Flow-specific WebSocket collaboration hook

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useCollaboration } from './use-collaboration'
import type { TableErrorEvent } from './use-table-mutations'
import type { RelationshipErrorEvent } from './use-relationship-mutations'
import { useAuthContext } from '@/components/auth/AuthContext'

/**
 * Position update event data from WebSocket
 */
export interface PositionUpdateEvent {
  tableId: string
  positionX: number
  positionY: number
  userId?: string
}

/**
 * useWhiteboardCollaboration hook - React Flow integration for real-time collaboration
 *
 * This hook integrates the base WebSocket collaboration with React Flow's state management.
 * It handles incoming position updates from other users and emits outgoing updates.
 *
 * @param whiteboardId - Whiteboard UUID to connect to
 * @param userId - Current user UUID for authentication
 * @param onPositionUpdate - Callback to update React Flow nodes when other users move tables
 * @returns Collaboration state and emit function
 *
 * NOTE ON SIGNATURE (S3, Hermes review, table-comment): this hook now takes 12
 * positional parameters (up from 9 pre-GH#109/table-comment). An options-object
 * refactor was considered and deliberately deferred rather than done here: the
 * hook has ~20+ existing positional call sites across
 * `ReactFlowWhiteboard.tsx`, `use-whiteboard-collaboration.test.ts`, and
 * `use-whiteboard-collaboration-auth.test.ts` (many of which rely on trailing
 * defaults / call with only the first 3 args), so converting is not a
 * contained change — it would touch every test invocation in two large TC-*
 * suites for a refactor that is orthogonal to the five findings this pass
 * fixes. If another callback is added to this hook, prefer migrating to a
 * single options object at that point rather than a 13th positional param.
 *
 * @example
 * ```tsx
 * const { connectionState, emitPositionUpdate } = useWhiteboardCollaboration(
 *   whiteboardId,
 *   userId,
 *   (tableId, x, y) => {
 *     // Update React Flow nodes state
 *     setNodes((nds) =>
 *       nds.map((node) =>
 *         node.id === tableId ? { ...node, position: { x, y } } : node
 *       )
 *     )
 *   }
 * )
 * ```
 */
/**
 * Bulk position update event data from Auto Layout broadcast
 */
export interface BulkPositionUpdateEvent {
  positions: Array<{
    tableId: string
    positionX: number
    positionY: number
  }>
  userId: string
}

export function useWhiteboardCollaboration(
  whiteboardId: string,
  userId: string,
  onPositionUpdate: (
    tableId: string,
    positionX: number,
    positionY: number,
  ) => void,
  onTableDeleted?: (tableId: string) => void,
  onTableError?: (data: TableErrorEvent) => void,
  onRelationshipDeleted?: (relationshipId: string) => void,
  onRelationshipError?: (data: RelationshipErrorEvent) => void,
  onRelationshipUpdated?: (relationshipId: string, label: string) => void,
  onBulkPositionUpdate?: (
    positions: Array<{ tableId: string; positionX: number; positionY: number }>,
  ) => void,
  // R1 (GH #109): the public read-only /share route passes false so no
  // Socket.IO connection is ever opened on that path. Defaults to true for
  // every existing authenticated caller.
  enabled: boolean = true,
  // Table comment/note (table-comment): applies inbound table:updated events
  // from other users (currently only `description` is threaded through, but
  // the payload carries whatever fields the sender changed via table:update).
  onTableUpdated?: (data: { tableId: string; description?: string }) => void,
  // Table comment/note (table-comment, W1 fix): server-side rejections of a
  // LOCAL table:update emit (FORBIDDEN / NOT_FOUND / VALIDATION_ERROR) arrive
  // on the shared `error` event. A sibling listener (separate from the
  // table:delete-only onTableError above) routes them here so useTableMutations
  // can roll back the optimistic edit and toast — mirrors onRelationshipError's
  // job for relationship:update, kept as its own callback rather than folded
  // into onTableError since the two have different toast copy.
  onTableUpdateError?: (data: TableErrorEvent) => void,
) {
  // Use the base collaboration hook
  const { triggerSessionExpired } = useAuthContext()
  const { emit, on, off, connectionState, activeUsers } = useCollaboration(
    whiteboardId,
    userId,
    triggerSessionExpired,
    enabled,
  )
  const router = useRouter()
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for table position updates from other users
  useEffect(() => {
    const handlePositionUpdate = (data: PositionUpdateEvent) => {
      // Ignore updates from current user (already applied optimistically)
      if (data.userId === userId) return

      console.log('Position update from another user:', data)
      onPositionUpdate(data.tableId, data.positionX, data.positionY)
    }

    // Register event listeners
    on('table:moved', handlePositionUpdate)
    on('table:position-updated', handlePositionUpdate) // Support both event names

    // Cleanup on unmount
    return () => {
      off('table:moved', handlePositionUpdate)
      off('table:position-updated', handlePositionUpdate)
    }
  }, [on, off, userId, onPositionUpdate])

  // Listen for table deletion events from other users
  useEffect(() => {
    if (!onTableDeleted) return

    const handleTableDeleted = (data: {
      tableId: string
      deletedBy: string
    }) => {
      // Ignore if we deleted it (already applied optimistically)
      if (data.deletedBy === userId) return
      onTableDeleted(data.tableId)
    }

    on('table:deleted', handleTableDeleted)
    return () => {
      off('table:deleted', handleTableDeleted)
    }
  }, [on, off, userId, onTableDeleted])

  // Listen for table:delete error events
  useEffect(() => {
    if (!onTableError) return

    const handleError = (data: TableErrorEvent) => {
      // Only handle table:delete errors — column errors are handled by useColumnCollaboration
      if (data.event !== 'table:delete') return
      onTableError(data)
    }

    on('error', handleError)
    return () => {
      off('error', handleError)
    }
  }, [on, off, onTableError])

  // Listen for table:update error events (table-comment W1 fix). Previously
  // these were silently dropped: the effect above filters strictly to
  // `table:delete`, so a rejected table:update save (FORBIDDEN / NOT_FOUND /
  // VALIDATION_ERROR) never reached useTableMutations for rollback+toast. A
  // sibling listener keeps table:delete's handling untouched while routing
  // table:update failures to their own callback.
  useEffect(() => {
    if (!onTableUpdateError) return

    const handleError = (data: TableErrorEvent) => {
      if (data.event !== 'table:update') return
      onTableUpdateError(data)
    }

    on('error', handleError)
    return () => {
      off('error', handleError)
    }
  }, [on, off, onTableUpdateError])

  // Listen for relationship deletion events from other users
  useEffect(() => {
    if (!onRelationshipDeleted) return

    const handleRelationshipDeleted = (data: {
      relationshipId: string
      deletedBy: string
    }) => {
      // Ignore if we deleted it (already applied optimistically)
      if (data.deletedBy === userId) return
      onRelationshipDeleted(data.relationshipId)
    }

    on('relationship:deleted', handleRelationshipDeleted)
    return () => {
      off('relationship:deleted', handleRelationshipDeleted)
    }
  }, [on, off, userId, onRelationshipDeleted])

  // Listen for relationship:delete error events
  useEffect(() => {
    if (!onRelationshipError) return

    const handleError = (data: RelationshipErrorEvent) => {
      // Only handle relationship:delete errors
      if (data.event !== 'relationship:delete') return
      onRelationshipError(data)
    }

    on('error', handleError)
    return () => {
      off('error', handleError)
    }
  }, [on, off, onRelationshipError])

  // Listen for relationship update events from other users
  useEffect(() => {
    if (!onRelationshipUpdated) return

    const handleRelationshipUpdated = (data: {
      relationshipId: string
      label: string
      updatedBy: string
    }) => {
      // Ignore if we updated it (already applied optimistically)
      if (data.updatedBy === userId) return
      onRelationshipUpdated(data.relationshipId, data.label)
    }

    on('relationship:updated', handleRelationshipUpdated)
    return () => {
      off('relationship:updated', handleRelationshipUpdated)
    }
  }, [on, off, userId, onRelationshipUpdated])

  // Listen for table update events from other users (table-comment: currently
  // only the `description` field is emitted, but the payload is generic per
  // the server's table:update contract). Mirrors the table:moved pattern.
  useEffect(() => {
    if (!onTableUpdated) return

    const handleTableUpdated = (data: {
      tableId: string
      description?: string
      updatedBy: string
    }) => {
      // Ignore updates from current user (already applied optimistically)
      if (data.updatedBy === userId) return
      onTableUpdated(data)
    }

    on('table:updated', handleTableUpdated)
    return () => {
      off('table:updated', handleTableUpdated)
    }
  }, [on, off, userId, onTableUpdated])

  // Handle permission_revoked event: show toast + redirect to project list
  useEffect(() => {
    const handlePermissionRevoked = (data: { projectId: string }) => {
      console.warn('Permission revoked for project:', data.projectId)
      toast.error('Your access to this project has been removed', {
        description: 'You will be redirected to the project list in 5 seconds.',
        duration: 5000,
      })
      redirectTimerRef.current = setTimeout(() => {
        router.navigate({ to: '/' })
      }, 5000)
    }

    on('permission_revoked', handlePermissionRevoked)
    return () => {
      off('permission_revoked', handlePermissionRevoked)
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current)
      }
    }
  }, [on, off, router])

  // Listen for bulk position updates from other users (Auto Layout broadcast)
  // NOTE on field names — both this listener and the existing table:moved listener
  // use `data.userId` for the sender-id field. The mutation-event family
  // (table:updated / table:deleted / column:updated) uses `updatedBy`; that's a
  // different convention in different hooks. Picking userId here keeps both
  // listeners in this hook consistent and avoids the muscle-memory bug where a
  // future reader writes data.userId in a handler that should read data.updatedBy
  // (or vice versa) and the guard silently fails (resolves Apollo Finding 5).
  // Pre-existing latent bug (out of scope for Auto Layout): collaboration.ts:418-423
  // emits the legacy table:moved event with `updatedBy` while the listener at
  // lines 75-77 reads `data.userId`. Auto Layout does NOT touch that legacy emit;
  // new code uses `userId` end-to-end on the new `table:move:bulk` event.
  useEffect(() => {
    if (!onBulkPositionUpdate) return

    const handler = (data: BulkPositionUpdateEvent) => {
      // Defensive sender-guard: broadcastToWhiteboard already excludes the
      // sender on the server, but we keep this guard for parity with the
      // existing table:moved listener and as a defense against any future
      // change that might re-route the broadcast through emitToWhiteboard.
      if (data.userId === userId) return
      onBulkPositionUpdate(data.positions)
    }

    on('table:move:bulk', handler)
    return () => {
      off('table:move:bulk', handler)
    }
  }, [on, off, userId, onBulkPositionUpdate])

  // Emit position update to other users.
  // isInit=true signals the server to apply a first-write-wins guard: if the
  // table already has a position (set by another client that loaded first),
  // the server acks without writing to the DB or broadcasting.
  const emitPositionUpdate = useCallback(
    (tableId: string, positionX: number, positionY: number, isInit = false) => {
      emit('table:move', {
        tableId,
        positionX,
        positionY,
        userId,
        isInit,
      })
    },
    [emit, userId],
  )

  // Emit bulk position update after Auto Layout persistence succeeds.
  // The server-side socket.on('table:move:bulk') handler re-broadcasts to
  // every OTHER socket in the namespace via broadcastToWhiteboard(socket.id).
  // Field name is `userId` (not `updatedBy`) for parity with the table:moved
  // listener in this same hook (resolves Apollo Finding 5).
  const emitBulkPositionUpdate = useCallback(
    (
      positions: Array<{
        tableId: string
        positionX: number
        positionY: number
      }>,
    ) => {
      emit('table:move:bulk', { positions, userId })
    },
    [emit, userId],
  )

  // Emit table delete to server
  const emitTableDelete = useCallback(
    (tableId: string) => {
      emit('table:delete', { tableId })
    },
    [emit],
  )

  // Emit table update to server (table-comment: first client-side emitter for
  // table:update — server persists via updateTableSchema + updateDiagramTable
  // and broadcasts table:updated to other clients). The optional `ack`
  // callback (added for W1) reports the server's immediate ok/fail result back
  // to the caller (useTableMutations.updateTable) so it can clear its pending
  // rollback entry on success; failures are still logged here, and are also
  // surfaced via the broadcast `error` event (routed to onTableUpdateError
  // above) for rollback + toast.
  const emitTableUpdate = useCallback(
    (
      tableId: string,
      data: { description?: string },
      ack?: (ok: boolean) => void,
    ) => {
      emit(
        'table:update',
        { tableId, ...data },
        (res: { ok: boolean; message?: string }) => {
          if (!res?.ok) {
            console.error('Failed to update table:', res?.message)
          }
          ack?.(Boolean(res?.ok))
        },
      )
    },
    [emit],
  )

  // Emit relationship delete to server
  const emitRelationshipDelete = useCallback(
    (relationshipId: string) => {
      emit('relationship:delete', { relationshipId })
    },
    [emit],
  )

  // Emit relationship label update to server
  const emitRelationshipUpdate = useCallback(
    (relationshipId: string, label: string) => {
      emit('relationship:update', { relationshipId, label })
    },
    [emit],
  )

  return {
    connectionState,
    activeUsers,
    emitPositionUpdate,
    emitBulkPositionUpdate,
    emitTableDelete,
    emitTableUpdate,
    emitRelationshipDelete,
    emitRelationshipUpdate,
    // Generic socket primitives — exposed so entity hooks (e.g. subject areas,
    // GH #106) can add their own events without opening a second connection.
    on,
    off,
    emit,
  }
}

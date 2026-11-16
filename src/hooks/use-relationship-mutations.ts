/**
 * useRelationshipMutations — encapsulates relationship deletion with optimistic updates
 *
 * WebSocket-only persistence: mutations emit via Socket.IO.
 * Mirrors the architecture of useTableMutations but operates on a single edge
 * rather than a table node + connected edges.
 */

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'
import type {
  ColumnLookup,
  RelationshipEndpointPatch,
  RelationshipUpdatePatch,
} from '@/lib/react-flow/relationship-endpoints'
import { applyEndpointPatch } from '@/lib/react-flow/relationship-endpoints'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'
import { NOT_CONNECTED_TOAST_MESSAGE } from '@/lib/react-flow/types'

type SetEdges = React.Dispatch<
  React.SetStateAction<Array<RelationshipEdgeType>>
>

interface PendingRelationshipMutation {
  type: 'delete' | 'update' | 'reconnect'
  rollback: () => void
}

export interface RelationshipErrorEvent {
  event: string
  error?: string
  message?: string
  relationshipId?: string
}

export function useRelationshipMutations(
  setEdges: SetEdges,
  emitRelationshipDelete: ((relationshipId: string) => void) | null,
  isConnected: boolean,
  emitRelationshipUpdate?:
    ((relationshipId: string, patch: RelationshipUpdatePatch) => void) | null,
  findColumn?: ColumnLookup,
) {
  /**
   * Track optimistic mutations for rollback on server error.
   * Key: relationshipId
   */
  const t = useT()
  const pendingMutations = useRef<Map<string, PendingRelationshipMutation>>(
    new Map(),
  )

  /**
   * Delete a relationship optimistically (removes the edge) then emit via WebSocket.
   */
  const deleteRelationship = useCallback(
    (relationshipId: string) => {
      if (!isConnected) {
        toast.error(tError(t, NOT_CONNECTED_TOAST_MESSAGE))
        return
      }

      let deletedEdge: RelationshipEdgeType | undefined

      // Capture edge for rollback and optimistically remove it
      setEdges((prev) => {
        deletedEdge = prev.find((e) => e.id === relationshipId)
        return prev.filter((e) => e.id !== relationshipId)
      })

      // Store rollback closure
      pendingMutations.current.set(relationshipId, {
        type: 'delete',
        rollback: () => {
          if (deletedEdge) {
            setEdges((prev) => {
              // Guard: don't re-insert if edge already exists (idempotency)
              if (prev.some((e) => e.id === relationshipId)) return prev
              return [...prev, deletedEdge!]
            })
          }
        },
      })

      // Emit via WebSocket
      if (emitRelationshipDelete) {
        emitRelationshipDelete(relationshipId)
      }
    },
    [isConnected, setEdges, emitRelationshipDelete, t],
  )

  /**
   * Update a relationship label optimistically then emit via WebSocket.
   */
  const updateRelationshipLabel = useCallback(
    (relationshipId: string, label: string) => {
      if (!isConnected) {
        toast.error(tError(t, NOT_CONNECTED_TOAST_MESSAGE))
        return
      }

      let previousLabel: string | undefined

      // Capture previous label for rollback and optimistically apply new label
      setEdges((prev) => {
        previousLabel = prev.find((e) => e.id === relationshipId)?.data?.label
        return prev.map((e) =>
          e.id === relationshipId
            ? { ...e, data: { ...e.data!, label: label || undefined } }
            : e,
        )
      })

      // Store rollback closure that restores the previous label value
      pendingMutations.current.set(relationshipId, {
        type: 'update',
        rollback: () => {
          setEdges((prev) =>
            prev.map((e) =>
              e.id === relationshipId
                ? { ...e, data: { ...e.data!, label: previousLabel } }
                : e,
            ),
          )
        },
      })

      // Emit via WebSocket
      if (emitRelationshipUpdate) {
        emitRelationshipUpdate(relationshipId, { label })
      }
    },
    [isConnected, setEdges, emitRelationshipUpdate, t],
  )

  /**
   * Move one or both ends of a relationship to other columns: apply the new
   * endpoints optimistically, emit only the changed fields, and restore the
   * whole previous edge if the server rejects the change.
   */
  const reconnectRelationship = useCallback(
    (relationshipId: string, patch: RelationshipEndpointPatch) => {
      if (!isConnected) {
        toast.error(tError(t, NOT_CONNECTED_TOAST_MESSAGE))
        return
      }

      let previousEdge: RelationshipEdgeType | undefined
      const lookup: ColumnLookup = findColumn ?? (() => undefined)

      setEdges((prev) => {
        previousEdge = prev.find((e) => e.id === relationshipId)
        return prev.map((e) =>
          e.id === relationshipId ? applyEndpointPatch(e, patch, lookup) : e,
        )
      })

      pendingMutations.current.set(relationshipId, {
        type: 'reconnect',
        rollback: () => {
          if (!previousEdge) return
          setEdges((prev) =>
            prev.map((e) => (e.id === relationshipId ? previousEdge! : e)),
          )
        },
      })

      if (emitRelationshipUpdate) {
        emitRelationshipUpdate(relationshipId, patch)
      }
    },
    [isConnected, setEdges, emitRelationshipUpdate, findColumn, t],
  )

  /**
   * Called by useWhiteboardCollaboration when server sends an error event for
   * relationship:delete or relationship:update.
   * Finds the pending mutation and invokes its rollback.
   */
  const onRelationshipError = useCallback(
    (data: RelationshipErrorEvent) => {
      const pendingKind = data.relationshipId
        ? pendingMutations.current.get(data.relationshipId)?.type
        : undefined
      if (data.event === 'relationship:update') {
        toast.error(
          pendingKind === 'reconnect'
            ? t('hooks.relationship.reconnectFailed')
            : t('hooks.relationship.labelFailed'),
        )
      } else {
        toast.error(t('hooks.relationship.deleteFailed'))
      }

      if (data.relationshipId) {
        const pending = pendingMutations.current.get(data.relationshipId)
        if (pending) {
          pending.rollback()
          pendingMutations.current.delete(data.relationshipId)
        }
      }
    },
    [t],
  )

  return {
    deleteRelationship,
    updateRelationshipLabel,
    reconnectRelationship,
    onRelationshipError,
  }
}

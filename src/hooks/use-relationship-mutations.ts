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

type SetEdges = React.Dispatch<
  React.SetStateAction<Array<RelationshipEdgeType>>
>

interface PendingRelationshipMutation {
  type: 'delete'
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
) {
  /**
   * Track optimistic mutations for rollback on server error.
   * Key: relationshipId
   */
  const pendingMutations = useRef<Map<string, PendingRelationshipMutation>>(
    new Map(),
  )

  /**
   * Delete a relationship optimistically (removes the edge) then emit via WebSocket.
   */
  const deleteRelationship = useCallback(
    (relationshipId: string) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
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
    [isConnected, setEdges, emitRelationshipDelete],
  )

  /**
   * Called by useWhiteboardCollaboration when server sends an error event for relationship:delete.
   * Finds the pending mutation and invokes its rollback.
   */
  const onRelationshipError = useCallback((data: RelationshipErrorEvent) => {
    toast.error('Failed to delete relationship. Please try again.')

    if (data.relationshipId) {
      const pending = pendingMutations.current.get(data.relationshipId)
      if (pending) {
        pending.rollback()
        pendingMutations.current.delete(data.relationshipId)
      }
    }
  }, [])

  return {
    deleteRelationship,
    onRelationshipError,
  }
}

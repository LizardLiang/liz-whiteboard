/**
 * useTableMutations — encapsulates table deletion with optimistic updates
 *
 * WebSocket-only persistence: mutations emit via Socket.IO.
 * Mirrors the architecture of useColumnMutations but operates on table nodes
 * rather than column data within nodes.
 */

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'

type SetNodes = React.Dispatch<React.SetStateAction<Array<TableNodeType>>>
type SetEdges = React.Dispatch<
  React.SetStateAction<Array<RelationshipEdgeType>>
>

interface PendingTableMutation {
  type: 'delete'
  rollback: () => void
}

export interface TableErrorEvent {
  event: string
  error?: string
  message?: string
  tableId?: string
}

export function useTableMutations(
  setNodes: SetNodes,
  setEdges: SetEdges,
  emitTableDelete: ((tableId: string) => void) | null,
  isConnected: boolean,
) {
  /**
   * Track optimistic mutations for rollback on server error.
   * Key: tableId
   */
  const pendingMutations = useRef<Map<string, PendingTableMutation>>(new Map())

  /**
   * Delete a table optimistically (removes node + all connected edges) then emit via WebSocket.
   */
  const deleteTable = useCallback(
    (tableId: string) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      let deletedNode: TableNodeType | undefined
      let deletedEdges: Array<RelationshipEdgeType> = []

      // Capture node for rollback
      setNodes((prev) => {
        const node = prev.find((n) => n.id === tableId)
        if (node) deletedNode = node
        return prev
      })

      // Capture and remove edges
      setEdges((prev) => {
        deletedEdges = prev.filter(
          (e) =>
            e.data?.relationship.sourceTableId === tableId ||
            e.data?.relationship.targetTableId === tableId,
        )
        return prev.filter(
          (e) =>
            e.data?.relationship.sourceTableId !== tableId &&
            e.data?.relationship.targetTableId !== tableId,
        )
      })

      // Optimistic remove node
      setNodes((prev) => prev.filter((n) => n.id !== tableId))

      // Store rollback
      pendingMutations.current.set(tableId, {
        type: 'delete',
        rollback: () => {
          if (deletedNode) {
            setNodes((prev) => {
              // Guard: don't re-insert if node already exists (concurrent remote deletion)
              if (prev.some((n) => n.id === tableId)) return prev
              return [...prev, deletedNode!]
            })
          }
          if (deletedEdges.length > 0) {
            setEdges((prev) => [...prev, ...deletedEdges])
          }
        },
      })

      // Emit via WebSocket
      if (emitTableDelete) {
        emitTableDelete(tableId)
      }
    },
    [isConnected, setNodes, setEdges, emitTableDelete],
  )

  /**
   * Called by useWhiteboardCollaboration when server sends an error event for table:delete.
   * Finds the pending mutation and invokes its rollback.
   */
  const onTableError = useCallback((data: TableErrorEvent) => {
    toast.error('Failed to delete table. Please try again.')

    if (data.tableId) {
      const pending = pendingMutations.current.get(data.tableId)
      if (pending) {
        pending.rollback()
        pendingMutations.current.delete(data.tableId)
      }
    }
  }, [])

  return {
    deleteTable,
    onTableError,
  }
}

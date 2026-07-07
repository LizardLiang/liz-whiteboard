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
  type: 'delete' | 'update'
  rollback: () => void
}

export interface TableErrorEvent {
  event: string
  error?: string
  message?: string
  tableId?: string
}

/** Fields a table:update emit may carry. Currently only `description`
 * (table-comment), but kept as a partial bag so future fields (e.g. `name`)
 * don't require a signature change. */
export type UpdateTableFields = Partial<{ description: string }>

type EmitTableUpdate = (
  tableId: string,
  data: UpdateTableFields,
  ack?: (ok: boolean) => void,
) => void

export function useTableMutations(
  setNodes: SetNodes,
  setEdges: SetEdges,
  emitTableDelete: ((tableId: string) => void) | null,
  isConnected: boolean,
  emitTableUpdate: EmitTableUpdate | null = null,
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

  /**
   * Update a table's fields (currently just `description` — table-comment)
   * optimistically then emit via WebSocket. Mirrors useColumnMutations.updateColumn:
   * captures the previous value(s) for rollback, applies an immutable merge into
   * data.table (preserving columns/relationships/other fields), and clears the
   * pending entry once the server ack confirms success.
   */
  const updateTable = useCallback(
    (
      tableId: string,
      data: UpdateTableFields,
      prevValues?: UpdateTableFields,
    ) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      let previousValues = prevValues

      setNodes((prev) =>
        prev.map((node) => {
          if (node.id !== tableId) return node
          if (!previousValues) {
            const current = node.data.table as unknown as UpdateTableFields
            previousValues = Object.fromEntries(
              Object.keys(data).map((key) => [
                key,
                current[key as keyof UpdateTableFields],
              ]),
            ) as UpdateTableFields
          }
          return {
            ...node,
            data: {
              ...node.data,
              table: {
                ...node.data.table,
                ...data,
              },
            },
          }
        }),
      )

      // Store rollback
      pendingMutations.current.set(tableId, {
        type: 'update',
        rollback: () => {
          const toRestore = previousValues
          if (!toRestore) return
          setNodes((prev) =>
            prev.map((node) =>
              node.id === tableId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      table: {
                        ...node.data.table,
                        ...toRestore,
                      },
                    },
                  }
                : node,
            ),
          )
        },
      })

      // Emit via WebSocket. On ack success, clear the pending entry so a
      // later (unrelated) error event can't roll back a change the server
      // already accepted.
      if (emitTableUpdate) {
        emitTableUpdate(tableId, data, (ok) => {
          if (ok) {
            pendingMutations.current.delete(tableId)
          }
        })
      }
    },
    [isConnected, setNodes, emitTableUpdate],
  )

  /**
   * Called by useWhiteboardCollaboration when server sends an error event for
   * table:update (FORBIDDEN / NOT_FOUND / VALIDATION_ERROR, etc.).
   * Finds the pending mutation and invokes its rollback.
   */
  const onTableUpdateError = useCallback((data: TableErrorEvent) => {
    toast.error('Failed to save table changes. Please try again.')

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
    updateTable,
    onTableUpdateError,
    pendingMutations,
  }
}

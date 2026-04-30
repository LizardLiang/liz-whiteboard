/**
 * useColumnReorderCollaboration — column:reorder WebSocket event listeners + emitters
 *
 * Emits column:reorder to the server.
 * Listens for:
 *   - column:reordered: applies directly if not locally dragging; buffers otherwise
 *   - column:reorder:ack: routes to mutations.onColumnReorderAck
 *   - error (event === 'column:reorder'): routes to mutations.onColumnReorderError
 *
 * Follows the same pattern as use-column-collaboration.ts.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useCollaboration } from './use-collaboration'
import type { ColumnReorderErrorCode, UseColumnReorderMutationsReturn } from './use-column-reorder-mutations'
import type { TableNodeType } from '@/lib/react-flow/types'

type SetNodes = React.Dispatch<React.SetStateAction<Array<TableNodeType>>>

export interface ColumnReorderedEvent {
  tableId: string
  orderedColumnIds: Array<string>
  reorderedBy?: string
}

export interface ColumnReorderAckEvent {
  tableId: string
  orderedColumnIds: Array<string>
}

export interface ColumnReorderErrorEvent {
  event: string
  error: ColumnReorderErrorCode | string
  message: string
  tableId?: string
}

export interface UseColumnReorderCollaborationCallbacks {
  setNodes: SetNodes
  bumpReorderTick: (tableId: string) => void
  mutations: UseColumnReorderMutationsReturn
}

export function useColumnReorderCollaboration(
  whiteboardId: string,
  userId: string,
  callbacks: UseColumnReorderCollaborationCallbacks,
) {
  const { emit, on, off, connectionState } = useCollaboration(
    whiteboardId,
    userId,
  )

  const isConnected = connectionState === 'connected'

  // Store callbacks in a ref so listeners don't re-run on every render
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  useEffect(() => {
    const handleReordered = (data: ColumnReorderedEvent) => {
      const { tableId, orderedColumnIds, reorderedBy } = data

      // Guard against malformed server payload: reorderedBy may be undefined
      const safeReorderedBy = typeof reorderedBy === 'string' ? reorderedBy : undefined

      if (callbacksRef.current.mutations.isLocalDragging(tableId)) {
        // Buffer the remote event while we are mid-drag
        callbacksRef.current.mutations.bufferRemoteReorder({
          tableId,
          orderedColumnIds,
          reorderedBy: safeReorderedBy,
        })
      } else {
        // Apply directly
        callbacksRef.current.mutations.onColumnReorderedFromOther(
          tableId,
          orderedColumnIds,
          callbacksRef.current.setNodes,
        )
        callbacksRef.current.bumpReorderTick(tableId)
      }
    }

    const handleAck = (data: ColumnReorderAckEvent) => {
      callbacksRef.current.mutations.onColumnReorderAck(
        data.tableId,
        data.orderedColumnIds,
        callbacksRef.current.setNodes,
        callbacksRef.current.bumpReorderTick,
      )
    }

    const handleError = (data: ColumnReorderErrorEvent) => {
      // Only handle column:reorder errors
      if (data.event !== 'column:reorder') return
      callbacksRef.current.mutations.onColumnReorderError(
        data.tableId ?? '',
        data.error,
        callbacksRef.current.setNodes,
      )
    }

    on('column:reordered', handleReordered)
    on('column:reorder:ack', handleAck)
    on('error', handleError)

    return () => {
      off('column:reordered', handleReordered)
      off('column:reorder:ack', handleAck)
      off('error', handleError)
    }
  }, [on, off])

  /**
   * Emit column:reorder event to server.
   * No-op when not connected (caller should handle this case).
   */
  const emitColumnReorder = useCallback(
    (tableId: string, orderedColumnIds: Array<string>) => {
      if (!isConnected) {
        console.warn('Cannot emit column:reorder: not connected')
        return
      }
      emit('column:reorder', { tableId, orderedColumnIds })
    },
    [emit, isConnected],
  )

  return {
    emitColumnReorder,
    connectionState,
  }
}

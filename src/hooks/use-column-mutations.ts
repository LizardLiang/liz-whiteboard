/**
 * useColumnMutations — encapsulates column CRUD with optimistic updates
 *
 * WebSocket-only persistence: all mutations emit via Socket.IO, not HTTP server functions.
 * This matches the existing pattern for table:create/move/update/delete.
 *
 * Phases:
 * - Phase 2: updateColumn (no WebSocket emit yet — wired in Phase 5)
 * - Phase 3: createColumn
 * - Phase 4: deleteColumn
 * - Phase 5: WebSocket emitters wired in, isConnected guard, onColumnError rollback
 */

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { Column } from '@prisma/client'
import type { RelationshipEdgeType, TableNodeType } from '@/lib/react-flow/types'
import type { DataType, UpdateColumn } from '@/data/schema'

type SetNodes = React.Dispatch<React.SetStateAction<Array<TableNodeType>>>
type SetEdges = React.Dispatch<React.SetStateAction<Array<RelationshipEdgeType>>>

type EmitColumnCreate = (data: {
  tableId: string
  name: string
  dataType: DataType
  order: number
  isPrimaryKey?: boolean
  isForeignKey?: boolean
  isUnique?: boolean
  isNullable?: boolean
}) => void

type EmitColumnUpdate = (columnId: string, data: Partial<UpdateColumn>) => void
type EmitColumnDelete = (columnId: string) => void

export interface PendingMutation {
  type: 'create' | 'update' | 'delete'
  rollback: () => void
}

export function useColumnMutations(
  setNodes: SetNodes,
  setEdges: SetEdges,
  emitColumnCreate: EmitColumnCreate | null,
  emitColumnUpdate: EmitColumnUpdate | null,
  emitColumnDelete: EmitColumnDelete | null,
  isConnected: boolean,
) {
  /**
   * Track optimistic mutations for rollback on server error.
   * Key: temp column ID (for create) or columnId (for update/delete)
   */
  const pendingMutations = useRef<Map<string, PendingMutation>>(new Map())

  /**
   * Create a column optimistically then emit via WebSocket.
   */
  const createColumn = useCallback(
    async (
      tableId: string,
      data: { name: string; dataType: DataType; order: number },
    ) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      const tempId = crypto.randomUUID()
      const optimisticColumn: Column = {
        id: tempId,
        tableId,
        name: data.name,
        dataType: data.dataType,
        order: data.order,
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Optimistic insert
      setNodes((prev) =>
        prev.map((node) =>
          node.data.table.id === tableId
            ? {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: [...node.data.table.columns, optimisticColumn],
                  },
                },
              }
            : node,
        ),
      )

      // Store rollback
      pendingMutations.current.set(tempId, {
        type: 'create',
        rollback: () => {
          setNodes((prev) =>
            prev.map((node) =>
              node.data.table.id === tableId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      table: {
                        ...node.data.table,
                        columns: node.data.table.columns.filter(
                          (c) => c.id !== tempId,
                        ),
                      },
                    },
                  }
                : node,
            ),
          )
        },
      })

      // Emit via WebSocket
      if (emitColumnCreate) {
        emitColumnCreate({
          tableId,
          name: data.name,
          dataType: data.dataType,
          order: data.order,
        })
      }
    },
    [isConnected, setNodes, emitColumnCreate],
  )

  /**
   * Replace the temp ID of an optimistic column with the real DB ID.
   * Called when column:created arrives from server for our own create.
   */
  const replaceTempId = useCallback(
    (tableId: string, tempId: string, realId: string) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.data.table.id === tableId
            ? {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: node.data.table.columns.map((c) =>
                      c.id === tempId ? { ...c, id: realId } : c,
                    ),
                  },
                },
              }
            : node,
        ),
      )
      // Remove the pending mutation now that it's confirmed
      pendingMutations.current.delete(tempId)
    },
    [setNodes],
  )

  /**
   * Update a column optimistically then emit via WebSocket.
   */
  const updateColumn = useCallback(
    async (
      columnId: string,
      tableId: string,
      data: Partial<UpdateColumn>,
    ) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      // Store previous column value for rollback
      let previousColumn: Column | undefined

      setNodes((prev) => {
        const updated = prev.map((node) => {
          if (node.data.table.id !== tableId) return node
          const col = node.data.table.columns.find((c) => c.id === columnId)
          if (!col) return node
          previousColumn = col
          return {
            ...node,
            data: {
              ...node.data,
              table: {
                ...node.data.table,
                columns: node.data.table.columns.map((c) =>
                  c.id === columnId ? { ...c, ...data } : c,
                ),
              },
            },
          }
        })
        return updated
      })

      // Store rollback
      pendingMutations.current.set(columnId, {
        type: 'update',
        rollback: () => {
          if (!previousColumn) return
          setNodes((prev) =>
            prev.map((node) =>
              node.data.table.id === tableId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      table: {
                        ...node.data.table,
                        columns: node.data.table.columns.map((c) =>
                          c.id === columnId ? previousColumn! : c,
                        ),
                      },
                    },
                  }
                : node,
            ),
          )
        },
      })

      // Emit via WebSocket
      if (emitColumnUpdate) {
        emitColumnUpdate(columnId, data)
      }
    },
    [isConnected, setNodes, emitColumnUpdate],
  )

  /**
   * Delete a column optimistically (removes column + affected edges) then emit via WebSocket.
   */
  const deleteColumn = useCallback(
    async (columnId: string, tableId: string) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      let deletedColumn: Column | undefined
      let deletedEdges: Array<RelationshipEdgeType> = []

      // Capture for rollback
      setNodes((prev) => {
        prev.forEach((node) => {
          if (node.data.table.id === tableId) {
            const col = node.data.table.columns.find((c) => c.id === columnId)
            if (col) deletedColumn = col
          }
        })
        return prev
      })

      setEdges((prev) => {
        deletedEdges = prev.filter(
          (e) =>
            e.data?.relationship.sourceColumnId === columnId ||
            e.data?.relationship.targetColumnId === columnId,
        )
        return prev.filter(
          (e) =>
            e.data?.relationship.sourceColumnId !== columnId &&
            e.data?.relationship.targetColumnId !== columnId,
        )
      })

      // Optimistic remove column
      setNodes((prev) =>
        prev.map((node) =>
          node.data.table.id === tableId
            ? {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: node.data.table.columns.filter(
                      (c) => c.id !== columnId,
                    ),
                  },
                },
              }
            : node,
        ),
      )

      // Store rollback
      pendingMutations.current.set(columnId, {
        type: 'delete',
        rollback: () => {
          if (deletedColumn) {
            setNodes((prev) =>
              prev.map((node) =>
                node.data.table.id === tableId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        table: {
                          ...node.data.table,
                          columns: [...node.data.table.columns, deletedColumn!],
                        },
                      },
                    }
                  : node,
              ),
            )
          }
          if (deletedEdges.length > 0) {
            setEdges((prev) => [...prev, ...deletedEdges])
          }
        },
      })

      // Emit via WebSocket
      if (emitColumnDelete) {
        emitColumnDelete(columnId)
      }
    },
    [isConnected, setNodes, setEdges, emitColumnDelete],
  )

  /**
   * Called by useColumnCollaboration when server sends an error event.
   * Finds the pending mutation and invokes its rollback.
   */
  const onColumnError = useCallback(
    (data: { event: string; error: string; message: string; columnId?: string; tableId?: string; name?: string }) => {
      // Detect duplicate name error
      const isDuplicateName =
        data.message?.toLowerCase().includes('unique constraint') ||
        data.error?.toLowerCase().includes('p2002') ||
        data.message?.toLowerCase().includes('already exists')

      if (isDuplicateName && data.name) {
        toast.error(`Column name '${data.name}' already exists in this table.`)
      } else if (data.message?.toLowerCase().includes('not found')) {
        toast.error('Column was already deleted.')
      } else {
        toast.error('Unable to save changes. Please try again.')
      }

      // Find the pending mutation to rollback
      // For column:delete and column:update, key is columnId
      // For column:create, key is the temp ID — we match by tableId + name + order
      if (data.columnId) {
        const pending = pendingMutations.current.get(data.columnId)
        if (pending) {
          pending.rollback()
          pendingMutations.current.delete(data.columnId)
        }
      } else {
        // For create errors: rollback all pending creates for this table
        pendingMutations.current.forEach((mutation, key) => {
          if (mutation.type === 'create') {
            mutation.rollback()
            pendingMutations.current.delete(key)
          }
        })
      }
    },
    [],
  )

  return {
    createColumn,
    updateColumn,
    deleteColumn,
    replaceTempId,
    onColumnError,
    pendingMutations,
  }
}

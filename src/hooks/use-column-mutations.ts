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
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import type { DataType, UpdateColumn } from '@/data/schema'
import { uuid } from '@/lib/uuid'

type SetNodes = React.Dispatch<React.SetStateAction<Array<TableNodeType>>>
type SetEdges = React.Dispatch<
  React.SetStateAction<Array<RelationshipEdgeType>>
>

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
type EmitColumnDuplicate = (columnId: string) => void

export interface PendingMutation {
  type: 'create' | 'update' | 'delete'
  rollback: () => void
  /** Queued updates to apply once a pending create resolves to a real ID */
  pendingUpdates?: Array<Partial<UpdateColumn>>
  /** For create mutations: the table this column belongs to (used for scoped rollback) */
  tableId?: string
}

export function useColumnMutations(
  setNodes: SetNodes,
  setEdges: SetEdges,
  emitColumnCreate: EmitColumnCreate | null,
  emitColumnUpdate: EmitColumnUpdate | null,
  emitColumnDelete: EmitColumnDelete | null,
  isConnected: boolean,
  emitColumnDuplicate: EmitColumnDuplicate | null = null,
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
    (
      tableId: string,
      data: { name: string; dataType: DataType; order: number },
    ) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      const tempId = uuid()

      const optimisticColumn: Column = {
        id: tempId,
        tableId,
        name: data.name,
        dataType: data.dataType,
        order: data.order,
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Optimistic insert
      setNodes((prev) => {
        const updated = prev.map((node) =>
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
        )
        return updated
      })

      // Store rollback
      pendingMutations.current.set(tempId, {
        type: 'create',
        tableId,
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
      // Read queued updates synchronously before entering the setNodes updater so
      // we have them available to emit after the atomic state commit.
      const pendingCreate = pendingMutations.current.get(tempId)
      const queuedUpdates = pendingCreate?.pendingUpdates ?? []

      setNodes((prev) => {
        // Delete the pending-create entry atomically with the ID swap so that any
        // column:update arriving between the setNodes call and React committing the
        // new state still sees the temp ID in pendingMutations and queues itself
        // rather than emitting the stale temp UUID to the server.
        pendingMutations.current.delete(tempId)

        return prev.map((node) =>
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
        )
      })

      // Emit each queued update with the real DB ID
      if (queuedUpdates.length > 0 && emitColumnUpdate) {
        // Merge all queued updates into a single emission to avoid redundant round-trips
        const merged = Object.assign(
          {},
          ...queuedUpdates,
        ) as Partial<UpdateColumn>
        emitColumnUpdate(realId, merged)
      }
    },
    [setNodes, emitColumnUpdate],
  )

  /**
   * Update a column optimistically then emit via WebSocket.
   */
  const updateColumn = useCallback(
    (columnId: string, tableId: string, data: Partial<UpdateColumn>) => {
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

      // Guard: if columnId is still a pending create (temp UUID not yet confirmed by
      // server), emitting an update now would send a temp ID the server doesn't know
      // about, causing a "Record to update not found" error.  Queue the update
      // instead — replaceTempId will flush queued updates once the real ID arrives.
      // IMPORTANT: read the existing entry BEFORE writing the 'update' entry so we
      // don't overwrite a 'create' entry and make this check always-false.
      const existing = pendingMutations.current.get(columnId)
      if (existing?.type === 'create') {
        if (!existing.pendingUpdates) {
          existing.pendingUpdates = []
        }
        existing.pendingUpdates.push(data)
        return
      }

      // Store rollback (only reached when columnId is NOT a pending create)
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
    (columnId: string, tableId: string) => {
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
   * Duplicate a column optimistically then emit via WebSocket.
   *
   * Optimistic strategy:
   *  1. Insert a temp column (with name `<original>_copy` and order = source.order + 1)
   *     immediately below the source, shifting siblings in local state.
   *  2. Emit `column:duplicate` to the server.
   *  3. On `column:duplicated` confirmation (onOwnColumnDuplicated in ReactFlowWhiteboard),
   *     replace the temp ID with the real DB ID via replaceTempId.
   *  4. On error, roll back the optimistic insert.
   */
  const duplicateColumn = useCallback(
    (sourceColumn: Column) => {
      if (!isConnected) {
        toast.error('Not connected. Please wait for reconnection.')
        return
      }

      const tempId = uuid()
      const newOrder = sourceColumn.order + 1
      const tableId = sourceColumn.tableId

      const optimisticColumn: Column = {
        id: tempId,
        tableId,
        name: `${sourceColumn.name}_copy`,
        dataType: sourceColumn.dataType,
        order: newOrder,
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: sourceColumn.isUnique,
        isNullable: sourceColumn.isNullable,
        description: sourceColumn.description,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Optimistic insert: shift siblings with order >= newOrder up by 1, then insert
      setNodes((prev) =>
        prev.map((node) => {
          if (node.data.table.id !== tableId) return node
          const shiftedColumns = node.data.table.columns.map((c) =>
            c.order >= newOrder && c.id !== sourceColumn.id
              ? { ...c, order: c.order + 1 }
              : c,
          )
          return {
            ...node,
            data: {
              ...node.data,
              table: {
                ...node.data.table,
                columns: [...shiftedColumns, optimisticColumn].sort(
                  (a, b) => a.order - b.order,
                ),
              },
            },
          }
        }),
      )

      // Store rollback
      pendingMutations.current.set(tempId, {
        type: 'create',
        tableId,
        rollback: () => {
          setNodes((prev) =>
            prev.map((node) => {
              if (node.data.table.id !== tableId) return node
              // Remove the optimistic column and un-shift siblings
              const withoutOptimistic = node.data.table.columns.filter(
                (c) => c.id !== tempId,
              )
              const unshifted = withoutOptimistic.map((c) =>
                c.order > newOrder ? { ...c, order: c.order - 1 } : c,
              )
              return {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: unshifted.sort((a, b) => a.order - b.order),
                  },
                },
              }
            }),
          )
        },
      })

      // Emit via WebSocket
      if (emitColumnDuplicate) {
        emitColumnDuplicate(sourceColumn.id)
      }
    },
    [isConnected, setNodes, emitColumnDuplicate],
  )

  /**
   * Called by useColumnCollaboration when a remote user duplicates a column.
   * Inserts the real column into local state and shifts sibling orders.
   */
  const onRemoteColumnDuplicated = useCallback(
    (data: { column: Column; sourceColumnId: string; tableId: string }) => {
      const { column, tableId } = data
      setNodes((prev) =>
        prev.map((node) => {
          if (node.data.table.id !== tableId) return node
          // Shift existing columns with order >= new column's order
          const shifted = node.data.table.columns.map((c) =>
            c.order >= column.order ? { ...c, order: c.order + 1 } : c,
          )
          return {
            ...node,
            data: {
              ...node.data,
              table: {
                ...node.data.table,
                columns: [...shifted, column].sort((a, b) => a.order - b.order),
              },
            },
          }
        }),
      )
    },
    [setNodes],
  )

  /**
   * Called by useColumnCollaboration when server sends an error event.
   * Finds the pending mutation and invokes its rollback.
   */
  const onColumnError = useCallback(
    (data: {
      event: string
      error: string
      message: string
      columnId?: string
      tableId?: string
      name?: string
    }) => {
      // Detect duplicate name error
      const isDuplicateName =
        data.message?.toLowerCase().includes('unique constraint') ||
        data.error?.toLowerCase().includes('p2002') ||
        data.message?.toLowerCase().includes('already exists')

      if (isDuplicateName && data.name) {
        toast.error(`Column name '${data.name}' already exists in this table.`)
      } else if (data.message?.toLowerCase().includes('not found')) {
        // "Not found" means different things depending on which operation failed.
        // For deletes it's safe to tell the user the column was already gone.
        // For updates it's more likely a temp-ID race; give a more accurate message.
        if (data.event === 'column:delete') {
          toast.error('Column was already deleted.')
        } else {
          toast.error(
            'Column not found — it may still be saving. Please try again.',
          )
        }
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
        // For create errors without a columnId: rollback pending creates.
        // If tableId is known, only rollback creates for that specific table
        // to avoid disturbing unrelated optimistic creates on other tables.
        pendingMutations.current.forEach((mutation, key) => {
          if (mutation.type === 'create') {
            if (!data.tableId || mutation.tableId === data.tableId) {
              mutation.rollback()
              pendingMutations.current.delete(key)
            }
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
    duplicateColumn,
    replaceTempId,
    onColumnError,
    onRemoteColumnDuplicated,
    pendingMutations,
  }
}

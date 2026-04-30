/**
 * useColumnReorderMutations — column reorder optimistic state + FIFO queue
 *
 * Responsibilities:
 * - Optimistic column order state via setNodes
 * - Per-table FIFO queue (max 5 in-flight reorders) — gated at drag-start (SA-M3)
 * - detectOverwriteConflict — column-level intersection check (SA-H2, REQ-14)
 * - reconcileAfterDrop — single post-drop entry-point (SA-H4)
 * - onColumnReorderAck — defers applyServerOrder until queue drains (SA-H3)
 * - seedConfirmedOrderFromServer — idempotent baseline seeding (SA-H1)
 * - onSyncReconcile — fires AC-08e toast when server order differs from optimistic
 */

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { Column } from '@prisma/client'
import type { TableNodeType } from '@/lib/react-flow/types'

// ============================================================================
// Types
// ============================================================================

type SetNodes = React.Dispatch<React.SetStateAction<Array<TableNodeType>>>

export interface BufferedRemoteReorder {
  tableId: string
  orderedColumnIds: Array<string>
  reorderedBy?: string
}

interface QueueEntry {
  tableId: string
  optimisticOrder: Array<string>
  /** Pre-drag snapshot for rollback */
  preState: Array<Column>
}

export interface ReconcileAfterDropParams {
  tableId: string
  /** Column order before the drag started */
  preDragOrder: Array<string>
  /** New order after drop (null = cancel/Escape) */
  newOrder: Array<string> | null
  /** Pre-drag column snapshot for rollback on error */
  preState: Array<Column>
  /** Emit the column:reorder event to the server */
  emitColumnReorder: (tableId: string, orderedColumnIds: Array<string>) => void
  setNodes: SetNodes
  bumpReorderTick: (tableId: string) => void
}

export interface UseColumnReorderMutationsReturn {
  /** Check if queue for this table is at capacity (5) — call at drag-start */
  isQueueFullForTable: (tableId: string) => boolean
  /** Check if local drag is active for a table (used by collaboration hook) */
  isLocalDragging: (tableId: string) => boolean
  /** Mark a table as actively dragging (called at handleDragStart) */
  setLocalDragging: (tableId: string, isDragging: boolean) => void
  /** Buffer a remote reorder event received during active local drag */
  bufferRemoteReorder: (event: BufferedRemoteReorder) => void
  /** Apply a remote column:reordered event when NOT locally dragging */
  onColumnReorderedFromOther: (
    tableId: string,
    orderedColumnIds: Array<string>,
    setNodes: SetNodes,
  ) => void
  /** Single entry-point for all post-drop state changes (SA-H4) */
  reconcileAfterDrop: (params: ReconcileAfterDropParams) => void
  /** Handle column:reorder:ack from server — queue-depth aware (SA-H3) */
  onColumnReorderAck: (
    tableId: string,
    serverOrderedIds: Array<string>,
    setNodes: SetNodes,
    bumpReorderTick: (tableId: string) => void,
  ) => void
  /** Handle column:reorder error from server — rollback + toast */
  onColumnReorderError: (
    tableId: string,
    errorCode: string,
    setNodes: SetNodes,
  ) => void
  /** Idempotent: seed baseline order from server on initial whiteboard load (SA-H1) */
  seedConfirmedOrderFromServer: (
    tableId: string,
    serverOrder: Array<string>,
  ) => void
  /** Check divergence after reconnect refetch — fires AC-08e toast if dirty (SA-H1) */
  onSyncReconcile: (
    tableId: string,
    serverOrder: Array<string>,
  ) => void
}

// ============================================================================
// Pure utility: detectOverwriteConflict
// Exported as a named function for unit testing (Suite S3)
// ============================================================================

/**
 * Detect whether a buffered remote reorder conflicts with the local drop.
 *
 * Uses column-level intersection check (SA-H2, AC-14e):
 * 1. Compute A's moved-set: columns whose position changed between preDragOrder and localFinal
 * 2. Compute B's moved-set: columns whose position changed between preDragOrder and bufferedRemote.orderedColumnIds
 * 3. Find sharedMoved = A ∩ B
 * 4. For each column in sharedMoved, compare its final index in localFinal vs bufferedRemote
 * 5. If any shared column ends up at a different index → conflict
 *
 * Returns false when bufferedRemote is null/undefined (no remote event to compare).
 */
export function detectOverwriteConflict(
  preDragOrder: Array<string>,
  localFinal: Array<string>,
  bufferedRemote: BufferedRemoteReorder | null | undefined,
): boolean {
  if (!bufferedRemote) return false

  const remoteOrder = bufferedRemote.orderedColumnIds

  // Build position maps from each order
  const preDragPosition = new Map<string, number>()
  preDragOrder.forEach((id, i) => preDragPosition.set(id, i))

  const localFinalPosition = new Map<string, number>()
  localFinal.forEach((id, i) => localFinalPosition.set(id, i))

  const remotePosition = new Map<string, number>()
  remoteOrder.forEach((id, i) => remotePosition.set(id, i))

  // A's moved-set: columns whose index changed between preDrag and localFinal
  const movedByA = new Set<string>()
  for (const id of localFinal) {
    const pre = preDragPosition.get(id)
    const local = localFinalPosition.get(id)
    if (pre !== undefined && local !== undefined && pre !== local) {
      movedByA.add(id)
    }
  }

  // B's moved-set: columns whose index changed between preDrag and remoteOrder
  const movedByB = new Set<string>()
  for (const id of remoteOrder) {
    const pre = preDragPosition.get(id)
    const remote = remotePosition.get(id)
    if (pre !== undefined && remote !== undefined && pre !== remote) {
      movedByB.add(id)
    }
  }

  // Check shared moved columns: if any are at different final positions → conflict
  for (const id of movedByA) {
    if (movedByB.has(id)) {
      const localPos = localFinalPosition.get(id)
      const remotePos = remotePosition.get(id)
      if (localPos !== remotePos) {
        return true
      }
    }
  }

  return false
}

// ============================================================================
// Hook
// ============================================================================

export function useColumnReorderMutations(): UseColumnReorderMutationsReturn {
  // Per-table FIFO queue — max 5 entries
  const queueByTable = useRef<Map<string, Array<QueueEntry>>>(new Map())

  // Last optimistic order per table (for sync-reconcile comparison)
  const lastOptimisticByTable = useRef<Map<string, Array<string>>>(new Map())

  // Last confirmed order per table (seeded from server on load — SA-H1)
  const lastConfirmedOrderByTable = useRef<Map<string, Array<string>>>(new Map())

  // Tables with unacknowledged optimistic reorders
  const dirtyByTable = useRef<Set<string>>(new Set())

  // Buffered remote reorders (received while local drag is active)
  const bufferedRemoteByTable = useRef<Map<string, BufferedRemoteReorder>>(new Map())

  // Tables currently being locally dragged
  const localDraggingByTable = useRef<Set<string>>(new Set())

  // -------------------------------------------------------------------------

  const isQueueFullForTable = useCallback((tableId: string): boolean => {
    const queue = queueByTable.current.get(tableId) ?? []
    return queue.length >= 5
  }, [])

  const isLocalDragging = useCallback((tableId: string): boolean => {
    return localDraggingByTable.current.has(tableId)
  }, [])

  const setLocalDragging = useCallback(
    (tableId: string, isDragging: boolean) => {
      if (isDragging) {
        localDraggingByTable.current.add(tableId)
      } else {
        localDraggingByTable.current.delete(tableId)
      }
    },
    [],
  )

  const bufferRemoteReorder = useCallback(
    (event: BufferedRemoteReorder) => {
      // Only buffer if we are actively dragging this table
      if (localDraggingByTable.current.has(event.tableId)) {
        bufferedRemoteByTable.current.set(event.tableId, event)
      }
    },
    [],
  )

  const onColumnReorderedFromOther = useCallback(
    (
      tableId: string,
      orderedColumnIds: Array<string>,
      setNodes: SetNodes,
    ) => {
      // Apply remote order directly to nodes
      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id !== tableId) return node
          const colMap = new Map<string, Column>(
            node.data.table.columns.map((c: Column) => [c.id, c]),
          )
          const reordered = orderedColumnIds
            .filter((id) => colMap.has(id))
            .map((id, i) => ({ ...colMap.get(id)!, order: i }))
          return {
            ...node,
            data: {
              ...node.data,
              table: { ...node.data.table, columns: reordered },
            },
          }
        }),
      )
    },
    [],
  )

  /**
   * Apply server's canonical order to nodes (used when queue drains or on load).
   */
  const applyServerOrder = useCallback(
    (
      tableId: string,
      serverOrderedIds: Array<string>,
      setNodes: SetNodes,
      bumpReorderTick: (tableId: string) => void,
    ) => {
      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id !== tableId) return node
          const colMap = new Map<string, Column>(
            node.data.table.columns.map((c: Column) => [c.id, c]),
          )
          const reordered = serverOrderedIds
            .filter((id) => colMap.has(id))
            .map((id, i) => ({ ...colMap.get(id)!, order: i }))
          return {
            ...node,
            data: {
              ...node.data,
              table: { ...node.data.table, columns: reordered },
            },
          }
        }),
      )
      bumpReorderTick(tableId)
    },
    [],
  )

  /**
   * reconcileAfterDrop — single post-drop entry-point (SA-H4).
   *
   * Handles three paths:
   * 1. Cancel (newOrder === null): restore preDragOrder; apply buffered remote if present
   * 2. No-op (newOrder equals preDragOrder): clear dragging flag; apply buffered remote if present
   * 3. Real drop: optimistic update, enqueue, detectOverwriteConflict, emitColumnReorder
   */
  const reconcileAfterDrop = useCallback(
    ({
      tableId,
      preDragOrder,
      newOrder,
      preState,
      emitColumnReorder,
      setNodes,
      bumpReorderTick,
    }: ReconcileAfterDropParams) => {
      // Always clear dragging flag
      localDraggingByTable.current.delete(tableId)

      const buffered = bufferedRemoteByTable.current.get(tableId)

      // Cancel path: newOrder === null (Escape key)
      if (newOrder === null) {
        // Apply buffered remote if present (AC-14f, AC-10c)
        if (buffered) {
          bufferedRemoteByTable.current.delete(tableId)
          applyServerOrder(tableId, buffered.orderedColumnIds, setNodes, bumpReorderTick)
        }
        return
      }

      // No-op path: order unchanged
      const isNoOp = arraysEqual(newOrder, preDragOrder)
      if (isNoOp) {
        // Apply buffered remote if present (AC-14f)
        if (buffered) {
          bufferedRemoteByTable.current.delete(tableId)
          applyServerOrder(tableId, buffered.orderedColumnIds, setNodes, bumpReorderTick)
        }
        return
      }

      // Real drop path: optimistic update
      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id !== tableId) return node
          const colMap = new Map<string, Column>(
            node.data.table.columns.map((c: Column) => [c.id, c]),
          )
          const reordered = newOrder
            .filter((id) => colMap.has(id))
            .map((id, i) => ({ ...colMap.get(id)!, order: i }))
          return {
            ...node,
            data: {
              ...node.data,
              table: { ...node.data.table, columns: reordered },
            },
          }
        }),
      )
      bumpReorderTick(tableId)

      // Enqueue with pre-drag snapshot for rollback
      const queue = queueByTable.current.get(tableId) ?? []
      queue.push({
        tableId,
        optimisticOrder: newOrder,
        preState,
      })
      queueByTable.current.set(tableId, queue)

      // Track optimistic state for sync-reconcile
      lastOptimisticByTable.current.set(tableId, newOrder)
      dirtyByTable.current.add(tableId)

      // Check for overwrite conflict with buffered remote (REQ-14, SA-H2)
      if (buffered) {
        bufferedRemoteByTable.current.delete(tableId)
        if (detectOverwriteConflict(preDragOrder, newOrder, buffered)) {
          toast.info(
            'Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten.',
          )
        }
      }

      // Emit to server
      emitColumnReorder(tableId, newOrder)
    },
    [applyServerOrder],
  )

  /**
   * onColumnReorderAck — SA-H3: defers applyServerOrder until queue drains.
   */
  const onColumnReorderAck = useCallback(
    (
      tableId: string,
      serverOrderedIds: Array<string>,
      setNodes: SetNodes,
      bumpReorderTick: (tableId: string) => void,
    ) => {
      const queue = queueByTable.current.get(tableId) ?? []

      // Pop the head of the queue (oldest pending entry)
      if (queue.length > 0) {
        queue.shift()
        queueByTable.current.set(tableId, queue)
      }

      // Update confirmed order
      lastConfirmedOrderByTable.current.set(tableId, serverOrderedIds)

      // SA-H3: only apply server order when queue is empty
      if (queue.length === 0) {
        applyServerOrder(tableId, serverOrderedIds, setNodes, bumpReorderTick)
        dirtyByTable.current.delete(tableId)
      }
    },
    [applyServerOrder],
  )

  /**
   * onColumnReorderError — rollback + toast.
   * dirtyByTable remains set after rollback (UT-14, SA spec decision).
   */
  const onColumnReorderError = useCallback(
    (tableId: string, errorCode: string, setNodes: SetNodes) => {
      const queue = queueByTable.current.get(tableId) ?? []

      // Pop the head for rollback
      const entry = queue.shift()
      queueByTable.current.set(tableId, queue)

      // Rollback to the pre-drag state captured at enqueue time
      if (entry) {
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            if (node.id !== tableId) return node
            return {
              ...node,
              data: {
                ...node.data,
                table: { ...node.data.table, columns: entry.preState },
              },
            }
          }),
        )
      }

      // Toast based on error code
      if (errorCode === 'UPDATE_FAILED') {
        toast.error('Unable to save column order. Please try again.')
      } else {
        // VALIDATION_FAILED or FORBIDDEN
        toast.error('Unable to reorder columns. Please try again.')
      }

      // Note: dirtyByTable deliberately NOT cleared on error (UT-14 pins this)
    },
    [],
  )

  /**
   * seedConfirmedOrderFromServer — idempotent, only sets baseline if not already present.
   * Called on initial whiteboard load for each table (SA-H1).
   */
  const seedConfirmedOrderFromServer = useCallback(
    (tableId: string, serverOrder: Array<string>) => {
      if (!lastConfirmedOrderByTable.current.has(tableId)) {
        lastConfirmedOrderByTable.current.set(tableId, serverOrder)
      }
    },
    [],
  )

  /**
   * onSyncReconcile — fires AC-08e toast when server order differs from optimistic
   * and the table is dirty (has unacknowledged reorders). Called after reconnect refetch.
   */
  const onSyncReconcile = useCallback(
    (tableId: string, serverOrder: Array<string>) => {
      if (!dirtyByTable.current.has(tableId)) return

      const lastOptimistic = lastOptimisticByTable.current.get(tableId)
      if (!lastOptimistic) return

      if (!arraysEqual(serverOrder, lastOptimistic)) {
        toast.warning(
          'Your last column reorder may not have saved. Please verify the order and try again if needed.',
        )
      }
    },
    [],
  )

  return {
    isQueueFullForTable,
    isLocalDragging,
    setLocalDragging,
    bufferRemoteReorder,
    onColumnReorderedFromOther,
    reconcileAfterDrop,
    onColumnReorderAck,
    onColumnReorderError,
    seedConfirmedOrderFromServer,
    onSyncReconcile,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function arraysEqual(a: Array<string>, b: Array<string>): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}


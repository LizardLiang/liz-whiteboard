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

/**
 * Shared error code type for column:reorder errors (W3 — typed error codes).
 * Used by both the server emitter (collaboration.ts) and the client switch
 * (onColumnReorderError) to prevent silent string-literal drift.
 */
export type ColumnReorderErrorCode =
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'UPDATE_FAILED'

export interface UseColumnReorderMutationsReturn {
  /** Check if queue for this table is at capacity (5) — call at drag-start */
  isQueueFullForTable: (tableId: string) => boolean
  /** Check if local drag is active for a table (used by collaboration hook) */
  isLocalDragging: (tableId: string) => boolean
  /** True when ANY table column is being dragged — use to disable RF panOnDrag */
  isAnyColumnDragging: () => boolean
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
    errorCode: ColumnReorderErrorCode | string,
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
  /**
   * Clean up all per-table state when a table is deleted (W4 — M10).
   * Must be called from onTableDeleted and table:deleted socket handler
   * to prevent unbounded growth of per-table ref maps.
   */
  forgetTable: (tableId: string) => void
}

// ============================================================================
// Private helper: applyOrderToNodes (B2 — M3, extracted from 3 duplicate blocks)
// ============================================================================

/**
 * Apply a new column order to the matching table node (immutable update).
 * Extracted to eliminate 3 near-duplicate setNodes-reorder blocks that
 * previously appeared in onColumnReorderedFromOther, applyServerOrder, and
 * reconcileAfterDrop's real-drop path.
 */
function applyOrderToNodes(
  tableId: string,
  orderedIds: Array<string>,
  setNodes: SetNodes,
): void {
  setNodes((prevNodes) =>
    prevNodes.map((node) => {
      if (node.id !== tableId) return node
      const colMap = new Map<string, Column>(
        node.data.table.columns.map((c: Column) => [c.id, c]),
      )
      const reordered = orderedIds
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
}

// ============================================================================
// Pure utility: detectOverwriteConflict
// Exported as a named function for unit testing (Suite S3)
// ============================================================================

/**
 * Find the single column that was explicitly moved by comparing two orderings.
 * Returns the column that, when removed from both arrays, leaves the remaining
 * elements in identical relative order (i.e., all other columns were merely displaced).
 * Returns null if no such single column exists (multi-column move or complex scenario).
 */
function findExplicitlyMoved(
  preDragOrder: Array<string>,
  newOrder: Array<string>,
): string | null {
  for (const id of newOrder) {
    const preDragWithout = preDragOrder.filter((e) => e !== id)
    const newOrderWithout = newOrder.filter((e) => e !== id)
    if (
      preDragWithout.length === newOrderWithout.length &&
      preDragWithout.every((v, i) => v === newOrderWithout[i])
    ) {
      return id
    }
  }
  return null
}

/**
 * Compute the moved-set: columns that were explicitly moved (not just displaced).
 * Primary strategy: find the single column that was the drag target.
 * Fallback (multi-column scenario): use all columns whose absolute position changed.
 * Returns empty set if the two orders are identical (no-op).
 */
function computeMovedSet(
  preDragOrder: Array<string>,
  newOrder: Array<string>,
): Set<string> {
  // Fast path: no-op (orders are identical)
  if (arraysEqual(preDragOrder, newOrder)) {
    return new Set()
  }

  const singleMoved = findExplicitlyMoved(preDragOrder, newOrder)
  if (singleMoved !== null) {
    return new Set([singleMoved])
  }

  // Fallback: absolute position change (for multi-element moves)
  const preDragPosition = new Map<string, number>()
  preDragOrder.forEach((id, i) => preDragPosition.set(id, i))
  const newPosition = new Map<string, number>()
  newOrder.forEach((id, i) => newPosition.set(id, i))

  const moved = new Set<string>()
  for (const id of newOrder) {
    const pre = preDragPosition.get(id)
    const cur = newPosition.get(id)
    if (pre !== undefined && cur !== undefined && pre !== cur) {
      moved.add(id)
    }
  }
  return moved
}

/**
 * Detect whether a buffered remote reorder conflicts with the local drop.
 *
 * Uses column-level intersection check (SA-H2, AC-14e):
 * 1. Compute A's moved-set: the column(s) A explicitly moved (not just displaced)
 * 2. Compute B's moved-set: the column(s) B explicitly moved (not just displaced)
 * 3. Find sharedMoved = A ∩ B
 * 4. For each column in sharedMoved, compare its final index in localFinal vs bufferedRemote
 * 5. If any shared column ends up at a different index → conflict
 *
 * Uses findExplicitlyMoved to identify the drag target (displaced columns excluded).
 * Falls back to absolute position change for multi-column moves.
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

  const movedByA = computeMovedSet(preDragOrder, localFinal)
  const movedByB = computeMovedSet(preDragOrder, remoteOrder)

  const localFinalPosition = new Map<string, number>()
  localFinal.forEach((id, i) => localFinalPosition.set(id, i))

  const remotePosition = new Map<string, number>()
  remoteOrder.forEach((id, i) => remotePosition.set(id, i))

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

  /**
   * Last confirmed order per table (seeded from server on load — SA-H1).
   *
   * W1 DECISION: This ref stores the last server-acknowledged order for use in
   * the idempotency check inside seedConfirmedOrderFromServer (.has(tableId)).
   * The stored order array is not currently consumed by onSyncReconcile, which
   * compares against lastOptimisticByTable per the SA-H1 spec decision.
   *
   * The ref is kept (rather than reduced to a Set<string>) because MEDIUM-01
   * wiring of onSyncReconcile on reconnect will need both the existence check
   * (idempotency, existing use) and the stale-baseline refresh
   * (unconditional set on reconnect, per Cassandra LOW-03 mitigation).
   * Reducing it to a Set now would require reverting when MEDIUM-01 is fully wired.
   */
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

  const isAnyColumnDragging = useCallback((): boolean => {
    return localDraggingByTable.current.size > 0
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
      // Apply remote order directly to nodes (B2: delegates to applyOrderToNodes)
      applyOrderToNodes(tableId, orderedColumnIds, setNodes)
    },
    [],
  )

  /**
   * Apply server's canonical order to nodes (used when queue drains or on load).
   * B2: delegates to applyOrderToNodes; bumps tick to trigger edge re-anchor.
   */
  const applyServerOrder = useCallback(
    (
      tableId: string,
      serverOrderedIds: Array<string>,
      setNodes: SetNodes,
      bumpReorderTick: (tableId: string) => void,
    ) => {
      applyOrderToNodes(tableId, serverOrderedIds, setNodes)
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
   *
   * B1 FIX: If preDragOrder is empty, this means handleDragStart was rejected by the
   * queue-full guard and preDragOrderRef was never populated. Abort without mutating state.
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

      localDraggingByTable.current.delete(tableId)

      if (preDragOrder.length === 0) {
        return
      }

      const buffered = bufferedRemoteByTable.current.get(tableId)

      if (newOrder === null) {
        if (buffered) {
          bufferedRemoteByTable.current.delete(tableId)
          applyServerOrder(tableId, buffered.orderedColumnIds, setNodes, bumpReorderTick)
        }
        return
      }

      const isNoOp = arraysEqual(newOrder, preDragOrder)
      if (isNoOp) {
        if (buffered) {
          bufferedRemoteByTable.current.delete(tableId)
          applyServerOrder(tableId, buffered.orderedColumnIds, setNodes, bumpReorderTick)
        }
        return
      }

      applyOrderToNodes(tableId, newOrder, setNodes)
      bumpReorderTick(tableId)

      const queue = queueByTable.current.get(tableId) ?? []
      queue.push({ tableId, optimisticOrder: newOrder, preState })
      queueByTable.current.set(tableId, queue)

      lastOptimisticByTable.current.set(tableId, newOrder)
      dirtyByTable.current.add(tableId)

      if (buffered) {
        bufferedRemoteByTable.current.delete(tableId)
        if (detectOverwriteConflict(preDragOrder, newOrder, buffered)) {
          toast.info(
            'Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten.',
          )
        }
      }

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

      // Update confirmed order (kept for idempotency check in seedConfirmedOrderFromServer
      // and for future MEDIUM-01 reconnect-stale-baseline refresh per Cassandra LOW-03)
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
   * W3: uses typed ColumnReorderErrorCode instead of raw string.
   */
  const onColumnReorderError = useCallback(
    (tableId: string, errorCode: ColumnReorderErrorCode | string, setNodes: SetNodes) => {
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

      // Toast based on typed error code (W3 — M5)
      const code: ColumnReorderErrorCode =
        errorCode === 'UPDATE_FAILED' ||
        errorCode === 'VALIDATION_FAILED' ||
        errorCode === 'FORBIDDEN' ||
        errorCode === 'NOT_FOUND'
          ? errorCode
          : 'UPDATE_FAILED' // safe fallback for unexpected codes

      if (code === 'UPDATE_FAILED') {
        toast.error('Unable to save column order. Please try again.')
      } else {
        // VALIDATION_FAILED, FORBIDDEN, or NOT_FOUND
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

  /**
   * forgetTable — clean up all per-table state when a table is deleted (W4 — M10).
   * Prevents unbounded growth of the 6 per-table ref maps across create/delete cycles.
   * Must be called from ReactFlowWhiteboard.onTableDeleted and table:deleted socket handler.
   */
  const forgetTable = useCallback((tableId: string) => {
    queueByTable.current.delete(tableId)
    lastOptimisticByTable.current.delete(tableId)
    lastConfirmedOrderByTable.current.delete(tableId)
    dirtyByTable.current.delete(tableId)
    bufferedRemoteByTable.current.delete(tableId)
    localDraggingByTable.current.delete(tableId)
  }, [])

  return {
    isQueueFullForTable,
    isLocalDragging,
    isAnyColumnDragging,
    setLocalDragging,
    bufferRemoteReorder,
    onColumnReorderedFromOther,
    reconcileAfterDrop,
    onColumnReorderAck,
    onColumnReorderError,
    seedConfirmedOrderFromServer,
    onSyncReconcile,
    forgetTable,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function arraysEqual(a: Array<string>, b: Array<string>): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

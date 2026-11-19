// src/lib/react-flow/optimistic-table.ts
// The optimistic row a table create puts into the ['whiteboard', id] cache.
// Nothing here cancels a reload: a create that cancelled the board reload
// would end a reconnect resync early (its reconcile would then read the
// pre-reload cache). A reload that lands over the row removes it from the
// cache, so the board query's `select` (withPendingTables) lays the row over
// every result until a reload carries the real table (same name; names are
// unique per board), the create fails, the create's own reload has landed
// (settleOptimisticTable), or the board unmounts (clearPendingTables).
import { useCallback, useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { CreateTable } from '@/data/schema'

type Row = { id: string; name: string }
interface Board {
  rows: Map<string, Row>
  version: number
  listeners: Set<() => void>
}
const pending = new WeakMap<QueryClient, Map<string, Board>>()
let tempCounter = 0

function boardOf(queryClient: QueryClient, whiteboardId: string): Board {
  let boards = pending.get(queryClient)
  if (!boards) pending.set(queryClient, (boards = new Map()))
  let board = boards.get(whiteboardId)
  if (!board) {
    boards.set(
      whiteboardId,
      (board = { rows: new Map(), version: 0, listeners: new Set() }),
    )
  }
  return board
}

/** Changes the pending list and tells the board query to run `select` again. */
function changed(board: Board) {
  board.version++
  board.listeners.forEach((fn) => fn())
}

/**
 * `select` for the board query: lays the created tables that no reload has
 * carried yet over the data. Drops a pending row once the data holds a table
 * of the same name under another id (the real row).
 */
export function withPendingTables<T>(
  queryClient: QueryClient,
  whiteboardId: string,
  data: T,
): T {
  const rows = pending.get(queryClient)?.get(whiteboardId)?.rows
  const tables = (data as { tables?: Array<Row> } | undefined)?.tables
  if (!rows || rows.size === 0 || !tables) return data
  let next = tables
  for (const [tempId, row] of [...rows]) {
    const real = next.some((t) => t.name === row.name && t.id !== tempId)
    if (real) {
      rows.delete(tempId)
      next = next.filter((t) => t.id !== tempId)
    } else if (!next.some((t) => t.id === tempId)) {
      next = [...next, row]
    }
  }
  return next === tables ? data : { ...data, tables: next }
}

/**
 * Stable `select` for the board query. Its identity changes when the pending
 * list changes, so the query runs it again without new data.
 */
export function useBoardSelectWithPending(
  queryClient: QueryClient,
  whiteboardId: string,
) {
  const board = boardOf(queryClient, whiteboardId)
  const version = useSyncExternalStore(
    (fn) => {
      board.listeners.add(fn)
      return () => board.listeners.delete(fn)
    },
    () => board.version,
  )
  return useCallback(
    <T>(data: T) => {
      // A new function identity per version makes the query re-select.
      void version
      return withPendingTables(queryClient, whiteboardId, data)
    },
    [queryClient, whiteboardId, version],
  )
}

/** Adds a temporary table row to the cache. Returns its id. */
export function insertOptimisticTable(
  queryClient: QueryClient,
  whiteboardId: string,
  newTable: CreateTable,
): string {
  const tempId = `temp-${Date.now()}-${++tempCounter}`
  const row = {
    id: tempId,
    ...newTable,
    columns: [],
    outgoingRelationships: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const board = boardOf(queryClient, whiteboardId)
  board.rows.set(tempId, row)
  changed(board)
  queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
    if (!old) return old
    return {
      ...old,
      tables: [...(old.tables ?? []), row],
    }
  })
  return tempId
}

/** Removes the temporary row after a failed create. Rows a reload or a peer added stay. */
export function removeOptimisticTable(
  queryClient: QueryClient,
  whiteboardId: string,
  tempId: string,
): void {
  const board = boardOf(queryClient, whiteboardId)
  if (board.rows.delete(tempId)) changed(board)
  queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
    if (!old?.tables) return old
    return {
      ...old,
      tables: old.tables.filter((t: { id: string }) => t.id !== tempId),
    }
  })
}

/**
 * The create succeeded and its own reload has landed: any real row is in the
 * data by now, so a row still pending is gone (a peer renamed or deleted it in
 * the window) and must not linger.
 */
export function settleOptimisticTable(
  queryClient: QueryClient,
  whiteboardId: string,
  tempId: string,
): void {
  removeOptimisticTable(queryClient, whiteboardId, tempId)
}

/** The board is closed: forget its pending rows. */
export function clearPendingTables(
  queryClient: QueryClient,
  whiteboardId: string,
): void {
  const board = boardOf(queryClient, whiteboardId)
  if (board.rows.size === 0) return
  const ids = [...board.rows.keys()]
  board.rows.clear()
  for (const id of ids) removeOptimisticTable(queryClient, whiteboardId, id)
  changed(board)
}

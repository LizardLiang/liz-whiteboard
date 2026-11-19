// src/lib/react-flow/optimistic-table.ts
// The optimistic row a table create puts into the ['whiteboard', id] cache.
// Nothing here cancels a reload: a create that cancelled the board reload
// would end a reconnect resync early (its reconcile would then read the
// pre-reload cache). A reload that lands over the row removes it from the
// cache, so the board query's `select` (withPendingTables) lays the row over
// every result until a reload carries the real table (same name; names are
// unique per board) or the create fails.
import type { QueryClient } from '@tanstack/react-query'
import type { CreateTable } from '@/data/schema'

type Row = { id: string; name: string }
const pending = new WeakMap<QueryClient, Map<string, Map<string, Row>>>()

function pendingOf(queryClient: QueryClient, whiteboardId: string) {
  let boards = pending.get(queryClient)
  if (!boards) pending.set(queryClient, (boards = new Map()))
  let rows = boards.get(whiteboardId)
  if (!rows) boards.set(whiteboardId, (rows = new Map()))
  return rows
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
  const rows = pending.get(queryClient)?.get(whiteboardId)
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

/** Adds a temporary table row to the cache. Returns its id. */
export function insertOptimisticTable(
  queryClient: QueryClient,
  whiteboardId: string,
  newTable: CreateTable,
): string {
  const tempId = 'temp-' + Date.now()
  const row = {
    id: tempId,
    ...newTable,
    columns: [],
    outgoingRelationships: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  pendingOf(queryClient, whiteboardId).set(tempId, row)
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
  pendingOf(queryClient, whiteboardId).delete(tempId)
  queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
    if (!old?.tables) return old
    return {
      ...old,
      tables: old.tables.filter((t: { id: string }) => t.id !== tempId),
    }
  })
}

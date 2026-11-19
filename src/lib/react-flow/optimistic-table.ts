// src/lib/react-flow/optimistic-table.ts
// The optimistic row a table create puts into the ['whiteboard', id] cache.
// Neither function cancels a reload: a create that cancelled the board reload
// would end a reconnect resync early (its reconcile would then read the
// pre-reload cache). A reload that lands over the row removes it; the create's
// success invalidation then loads the real table.
import type { QueryClient } from '@tanstack/react-query'
import type { CreateTable } from '@/data/schema'

/** Adds a temporary table row to the cache. Returns its id. */
export function insertOptimisticTable(
  queryClient: QueryClient,
  whiteboardId: string,
  newTable: CreateTable,
): string {
  const tempId = 'temp-' + Date.now()
  queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
    if (!old) return old
    return {
      ...old,
      tables: [
        ...(old.tables ?? []),
        {
          id: tempId,
          ...newTable,
          columns: [],
          outgoingRelationships: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
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
  queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
    if (!old?.tables) return old
    return {
      ...old,
      tables: old.tables.filter((t: { id: string }) => t.id !== tempId),
    }
  })
}

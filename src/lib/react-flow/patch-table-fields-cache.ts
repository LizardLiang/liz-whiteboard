// src/lib/react-flow/patch-table-fields-cache.ts
// Writes an optimistic / peer / rollback table-field change (name, description)
// into the ['whiteboard', whiteboardId] query cache (FLAT shape, see
// apply-table-created.ts). The initialNodes sync effect in ReactFlowWhiteboard
// rebuilds node data from this cache, so a cache that disagrees with the
// canvas reverts the change on the next refetch.
import type { QueryClient } from '@tanstack/react-query'

export type TableCacheFields = Partial<{
  name: string
  description: string | null
}>

export async function patchTableFieldsInCache(
  queryClient: QueryClient,
  whiteboardId: string,
  tableId: string,
  fields: TableCacheFields,
): Promise<void> {
  const queryKey = ['whiteboard', whiteboardId]
  // A refetch already in flight carries the pre-change snapshot; cancel it so
  // its late result cannot overwrite this patch.
  await queryClient.cancelQueries({ queryKey })
  queryClient.setQueryData(queryKey, (old: any) => {
    if (!old?.tables) return old
    return {
      ...old,
      tables: old.tables.map((t: any) =>
        t.id === tableId ? { ...t, ...fields } : t,
      ),
    }
  })
}

// src/lib/react-flow/patch-table-fields-cache.ts
// Writes an optimistic / peer / rollback table-field change (name, description)
// into the ['whiteboard', whiteboardId] query cache (FLAT shape, see
// apply-table-created.ts). The initialNodes sync effect in ReactFlowWhiteboard
// rebuilds node data from this cache, so a cache that disagrees with the
// canvas reverts the change on the next refetch.
//
// A refetch already in flight may carry the pre-change snapshot, so the patch
// cancels it. That cancel also drops refetches that other code started with
// invalidateQueries (reconnect resync, new relationship edges), and nothing
// retries them. So the patch re-runs every refetch it cancelled:
//   - 'now'   (peer update, rollback): the server already holds the value.
//   - 'defer' (local optimistic edit): the server may not have committed yet,
//     so the re-run waits for settleCancelledWhiteboardRefetch (table:update ack).
import type { QueryClient } from '@tanstack/react-query'

export type TableCacheFields = Partial<{
  name: string
  description: string | null
}>

export type RefetchRerun = 'now' | 'defer'

const deferredKeys = new WeakMap<QueryClient, Set<string>>()

const keyOf = (whiteboardId: string) => `whiteboard:${whiteboardId}`

function deferredFor(queryClient: QueryClient): Set<string> {
  let keys = deferredKeys.get(queryClient)
  if (!keys) {
    keys = new Set()
    deferredKeys.set(queryClient, keys)
  }
  return keys
}

function rerun(queryClient: QueryClient, whiteboardId: string): void {
  void queryClient.refetchQueries({
    queryKey: ['whiteboard', whiteboardId],
    exact: true,
  })
}

/** True while a cancelled whiteboard refetch is waiting for its deferred re-run. */
export function hasDeferredWhiteboardRefetch(
  queryClient: QueryClient,
  whiteboardId: string,
): boolean {
  return deferredKeys.get(queryClient)?.has(keyOf(whiteboardId)) ?? false
}

/** Re-runs a refetch that a deferred patch cancelled. Call once the server has settled. */
export function settleCancelledWhiteboardRefetch(
  queryClient: QueryClient,
  whiteboardId: string,
): void {
  if (deferredFor(queryClient).delete(keyOf(whiteboardId))) {
    rerun(queryClient, whiteboardId)
  }
}

export async function patchTableFieldsInCache(
  queryClient: QueryClient,
  whiteboardId: string,
  tableId: string,
  fields: TableCacheFields,
  rerunMode: RefetchRerun = 'now',
): Promise<void> {
  const queryKey = ['whiteboard', whiteboardId]
  const deferred = deferredFor(queryClient)
  const wasFetching = queryClient.isFetching({ queryKey, exact: true }) > 0
  // A refetch already in flight carries the pre-change snapshot; cancel it so
  // its late result cannot overwrite this patch.
  await queryClient.cancelQueries({ queryKey, exact: true })
  queryClient.setQueryData(queryKey, (old: any) => {
    if (!old?.tables) return old
    return {
      ...old,
      tables: old.tables.map((t: any) =>
        t.id === tableId ? { ...t, ...fields } : t,
      ),
    }
  })
  const owed = wasFetching || deferred.has(keyOf(whiteboardId))
  if (!owed) return
  if (rerunMode === 'defer') {
    deferred.add(keyOf(whiteboardId))
  } else {
    deferred.delete(keyOf(whiteboardId))
    rerun(queryClient, whiteboardId)
  }
}

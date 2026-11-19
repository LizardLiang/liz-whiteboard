// src/lib/react-flow/board-resync.ts
// Reconnect resync of the ER board: reload the board data, then check each
// table's column order against the server exactly once, when the reload ends.
import { convertTablesToNodes } from './convert-to-nodes'
import { boardReloadStartCount } from './table-edit-sync'
import type { QueryClient } from '@tanstack/react-query'
import type { Column, DiagramTable } from '@/data/models'
import { isUnauthorizedError } from '@/lib/auth/errors'

type BoardTable = DiagramTable & { columns: Array<Column> }

interface BoardData {
  tables: Array<BoardTable>
  tableReferences: Array<{ table: { id: string } }>
}

/**
 * The tables the board renders as table nodes. A cross-file reference
 * (LizMeter #83) is itself a DiagramTable row inside `.tables`; it renders
 * through the `externalTable` node type, so it is filtered out here.
 */
export function getBoardTables(data: BoardData): Array<BoardTable> {
  const referenceIds = new Set(data.tableReferences.map((r) => r.table.id))
  return data.tables.filter((t) => !referenceIds.has(t.id))
}

/** Upper bound on consecutive waits for a restarted reload. */
const MAX_RELOAD_WAITS = 20

/** Number of times the query has ended a fetch (data landed or error). */
function settledCount(queryClient: QueryClient, queryKey: Array<string>) {
  const state = queryClient.getQueryState(queryKey)
  return (state?.dataUpdateCount ?? 0) + (state?.errorUpdateCount ?? 0)
}

export interface ReconnectResyncOptions {
  queryClient: QueryClient
  whiteboardId: string
  /** False once a newer reconnect started or the board unmounted. */
  isCurrent: () => boolean
  /** Called once per table with the server's column order. */
  reconcile: (tableId: string, serverOrder: Array<string>) => void
}

/**
 * Reloads ['whiteboard', id] and reconciles column order once the reload ends.
 * An older reconnect whose reload a newer one restarted does nothing.
 */
export async function resyncBoardAfterReconnect({
  queryClient,
  whiteboardId,
  isCurrent,
  reconcile,
}: ReconnectResyncOptions): Promise<void> {
  const queryKey = ['whiteboard', whiteboardId]
  await queryClient.invalidateQueries({ queryKey })
  // A newer invalidate can restart the reload and settle this await early;
  // wait for the reload that is still running. Each wait must move the query:
  // a landing, a failure, or a new reload start (a restart cancels the reload
  // this wait joined, so the wait ends with no landing and the restarted reload
  // must be awaited next). A reload that refetchQueries cannot await (for
  // example a query with no observer and no data) resolves at once and moves
  // nothing: stop then, and skip the reconcile, because the cache is not known
  // to hold the reloaded data. MAX_RELOAD_WAITS bounds the restarts a busy
  // board can cause in a row.
  for (
    let waits = 0;
    queryClient.isFetching({ queryKey, exact: true }) > 0;
    waits++
  ) {
    if (!isCurrent() || waits >= MAX_RELOAD_WAITS) return
    const before = settledCount(queryClient, queryKey)
    const startsBefore = boardReloadStartCount(queryClient, whiteboardId)
    await queryClient.refetchQueries(
      { queryKey, exact: true },
      { cancelRefetch: false },
    )
    if (
      queryClient.isFetching({ queryKey, exact: true }) > 0 &&
      settledCount(queryClient, queryKey) === before &&
      boardReloadStartCount(queryClient, whiteboardId) === startsBefore
    ) {
      return
    }
  }
  if (!isCurrent()) return
  if (queryClient.getQueryState(queryKey)?.status === 'error') return
  const data = queryClient.getQueryData<BoardData>(queryKey)
  if (!data || isUnauthorizedError(data)) return
  for (const node of convertTablesToNodes(getBoardTables(data), 'ALL_FIELDS')) {
    reconcile(
      node.data.table.id,
      node.data.table.columns.map((c) => c.id),
    )
  }
}

// src/lib/react-flow/board-resync.ts
// Reconnect resync of the ER board: reload the board data, then check each
// table's column order against the server exactly once, when the reload ends.
import { convertTablesToNodes } from './convert-to-nodes'
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
  // wait for the reload that is still running.
  while (queryClient.isFetching({ queryKey, exact: true }) > 0) {
    if (!isCurrent()) return
    await queryClient.refetchQueries(
      { queryKey, exact: true },
      { cancelRefetch: false },
    )
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

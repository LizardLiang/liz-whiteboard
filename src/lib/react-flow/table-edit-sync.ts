// src/lib/react-flow/table-edit-sync.ts
// Ties the table edit overlay to the ['whiteboard', id] query cache, so an
// unsaved table rename / note stays visible without cancelling any reload.
//
//   - It counts reload starts and landings of the board query (the overlay
//     drops confirmed values once a reload that started after them lands).
//   - It mirrors server-held values into the cache with setQueryData (no cancel),
//     so a rebuild from the cache agrees with the overlay.
//   - It tells the board which values to show (onShown) after any change.
// See .claude/.Arena/flows/table-edit-sync.md.
import { createTableEditOverlay } from './table-edit-overlay'
import type {
  TableEditDropToken,
  TableEditField,
  TableEditFields,
} from './table-edit-overlay'
import type { QueryClient } from '@tanstack/react-query'

const FIELDS: ReadonlyArray<TableEditField> = ['name', 'description']

const fieldsOf = (fields: TableEditFields) =>
  FIELDS.filter((field) => fields[field] !== undefined)

type ReloadStartListener = (whiteboardId: string) => void
const reloadStartListeners = new WeakMap<
  QueryClient,
  Set<ReloadStartListener>
>()

const reloadStartCounts = new WeakMap<QueryClient, Map<string, number>>()

/** How many times the board query function has started (see noteBoardReloadStart). */
export function boardReloadStartCount(
  queryClient: QueryClient,
  whiteboardId: string,
): number {
  return reloadStartCounts.get(queryClient)?.get(whiteboardId) ?? 0
}

/**
 * The board query function calls this each time it starts to read the server.
 * query-core announces a reload with a `fetch` action only when the query was
 * idle. A reload that `cancelRefetch` restarts (invalidateQueries does this)
 * reads the server again and dispatches nothing, so only the query function
 * sees every start. A confirmed value recorded before a start is then known to
 * be carried by the reload that start began.
 */
export function noteBoardReloadStart(
  queryClient: QueryClient,
  whiteboardId: string,
): void {
  let counts = reloadStartCounts.get(queryClient)
  if (!counts) reloadStartCounts.set(queryClient, (counts = new Map()))
  counts.set(whiteboardId, (counts.get(whiteboardId) ?? 0) + 1)
  reloadStartListeners.get(queryClient)?.forEach((fn) => fn(whiteboardId))
}

export interface TableEditSyncOptions {
  queryClient: QueryClient
  whiteboardId: string
  /** Called with the values to show for a table after the overlay changed. */
  onShown: (tableId: string, fields: TableEditFields) => void
  /** Whether the table is still on the board. A local ack for a table that is gone records nothing. Default: always. */
  tableExists?: (tableId: string) => boolean
}

export function createTableEditSync({
  queryClient,
  whiteboardId,
  onShown,
  tableExists = () => true,
}: TableEditSyncOptions) {
  const overlay = createTableEditOverlay()
  const queryKey = ['whiteboard', whiteboardId]

  const cachedValue = (tableId: string, field: TableEditField) => {
    const data = queryClient.getQueryData<{
      tables?: Array<{
        id: string
        name?: string
        description?: string | null
      }>
    }>(queryKey)
    return data?.tables?.find((t) => t.id === tableId)?.[field]
  }

  const writeCache = (tableId: string, fields: TableEditFields) => {
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

  /** Pushes the shown value of each field: overlay, else cache, else the fallback. */
  const show = (
    tableId: string,
    fields: ReadonlyArray<TableEditField>,
    fallback?: TableEditFields,
  ) => {
    const out: TableEditFields = {}
    for (const field of fields) {
      const value = [
        overlay.shown(tableId, field),
        cachedValue(tableId, field),
        fallback?.[field],
      ].find((v) => v !== undefined)
      if (value !== undefined) (out as Record<string, unknown>)[field] = value
    }
    if (Object.keys(out).length > 0) onShown(tableId, out)
  }

  return {
    /** Subscribes to the board query. Returns the unsubscribe function. */
    attach(): () => void {
      let listeners = reloadStartListeners.get(queryClient)
      if (!listeners) {
        listeners = new Set()
        reloadStartListeners.set(queryClient, listeners)
      }
      const onReloadStart: ReloadStartListener = (id) => {
        if (id === whiteboardId) overlay.onFetchStart()
      }
      listeners.add(onReloadStart)
      const unsubscribeCache = queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (event.type !== 'updated') return
          const key = event.query.queryKey
          if (
            key.length !== 2 ||
            key[0] !== 'whiteboard' ||
            key[1] !== whiteboardId
          )
            return
          // A reload that starts on an idle query counts here; every start,
          // restarts included, counts through noteBoardReloadStart.
          if (event.action.type === 'fetch') overlay.onFetchStart()
          // setQueryData also dispatches `success`; only a reload counts.
          else if (event.action.type === 'success' && !event.action.manual)
            overlay.onFetchSuccess()
        })
      return () => {
        unsubscribeCache()
        listeners.delete(onReloadStart)
      }
    },

    /** Lays the shown values over a table from the reloaded data. */
    apply: overlay.apply,

    /** A local edit starts: its values show until the server answers. Returns the edit id. */
    beginLocal(tableId: string, fields: TableEditFields): number {
      return overlay.beginLocal(tableId, fields)
    },

    /** The server answered a local edit. `previous` is the display fallback. */
    ackLocal(
      editId: number,
      tableId: string,
      ok: boolean,
      fields: TableEditFields,
      previous?: TableEditFields,
    ): void {
      // The table was deleted while the edit was in flight: keep the answer
      // for restoreTable (a refused delete brings the table back), record
      // nothing now and write no cache.
      if (!tableExists(tableId)) {
        overlay.recordDroppedAck(tableId, editId, ok, fields)
        overlay.ackLocal(editId, tableId, false, fields)
        return
      }
      overlay.ackLocal(editId, tableId, ok, fields)
      if (ok) writeCache(tableId, fields)
      else show(tableId, fieldsOf(fields), previous)
    },

    /** A peer saved these values (table:updated). */
    applyPeer(tableId: string, fields: TableEditFields): void {
      overlay.applyPeer(tableId, fields)
      writeCache(tableId, fields)
      show(tableId, fieldsOf(fields))
    },

    /** Reconnect: forget unacknowledged local edits and show the server's values. */
    releasePending(): void {
      const touched = overlay.releasePending()
      for (const tableId of touched) show(tableId, FIELDS)
    },

    /** The table is gone. Returns a token for restoreTable. */
    dropTable(tableId: string): TableEditDropToken {
      return overlay.dropTable(tableId)
    },

    /** A delete failed and the table is back: restore what dropTable returned, apply the acks that came meanwhile, and show it. */
    restoreTable(tableId: string, token: TableEditDropToken): void {
      overlay.restoreTable(tableId, token)
      for (const ack of token.acks) {
        if (ack.ok) writeCache(tableId, ack.fields)
      }
      show(tableId, FIELDS)
    },
  }
}

export type TableEditSync = ReturnType<typeof createTableEditSync>

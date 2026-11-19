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
import type { TableEditField, TableEditFields } from './table-edit-overlay'
import type { QueryClient } from '@tanstack/react-query'

const FIELDS: ReadonlyArray<TableEditField> = ['name', 'description']

const fieldsOf = (fields: TableEditFields) =>
  FIELDS.filter((field) => fields[field] !== undefined)

export interface TableEditSyncOptions {
  queryClient: QueryClient
  whiteboardId: string
  /** Called with the values to show for a table after the overlay changed. */
  onShown: (tableId: string, fields: TableEditFields) => void
}

export function createTableEditSync({
  queryClient,
  whiteboardId,
  onShown,
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
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated') return
        const key = event.query.queryKey
        if (
          key.length !== 2 ||
          key[0] !== 'whiteboard' ||
          key[1] !== whiteboardId
        )
          return
        if (event.action.type === 'fetch') overlay.onFetchStart()
        // setQueryData also dispatches `success`; only a reload counts.
        else if (event.action.type === 'success' && !event.action.manual)
          overlay.onFetchSuccess()
      })
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

    dropTable(tableId: string): void {
      overlay.dropTable(tableId)
    },
  }
}

export type TableEditSync = ReturnType<typeof createTableEditSync>

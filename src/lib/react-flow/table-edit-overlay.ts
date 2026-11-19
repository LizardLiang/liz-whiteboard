// src/lib/react-flow/table-edit-overlay.ts
// Per-board list of table name / note values that are newer than the reloaded
// board data. The board lays them over every rebuild of the table nodes, so a
// reload that was already in flight cannot show an older value. No reload is
// ever cancelled.
//
// Each (table, field) entry holds up to two values:
//   - pending:   the local edit the server has not acknowledged yet. A newer
//                local edit replaces it. A lost acknowledgement is released on
//                reconnect (releasePending) or ends with the board.
//   - confirmed: a value the server holds (local ack ok, or a peer update) that
//                a reload already in flight may not carry. A reload that STARTED
//                after the value was recorded carries it, so that reload's
//                success drops the entry. `seq` counts reload starts.
// The shown value is pending, else confirmed.

export type TableEditField = 'name' | 'description'

export type TableEditFields = Partial<{
  name: string
  description: string | null
}>

const FIELDS: ReadonlyArray<TableEditField> = ['name', 'description']

interface FieldEntry {
  pending?: { value: string | null; editId: number }
  confirmed?: { value: string | null; seq: number }
}

type TableEntry = Partial<Record<TableEditField, FieldEntry>>

export function createTableEditOverlay() {
  const tables = new Map<string, TableEntry>()
  let fetchStartSeq = 0
  let nextEditId = 0

  const fieldsOf = (fields: TableEditFields) =>
    FIELDS.filter((field) => fields[field] !== undefined)

  const entryFor = (tableId: string, field: TableEditField): FieldEntry => {
    let table = tables.get(tableId)
    if (!table) {
      table = {}
      tables.set(tableId, table)
    }
    return (table[field] ??= {})
  }

  const prune = (tableId: string) => {
    const table = tables.get(tableId)
    if (!table) return
    for (const field of FIELDS) {
      const entry = table[field]
      if (entry && !entry.pending && !entry.confirmed) delete table[field]
    }
    if (!table.name && !table.description) tables.delete(tableId)
  }

  const shown = (
    tableId: string,
    field: TableEditField,
  ): string | null | undefined => {
    const entry = tables.get(tableId)?.[field]
    if (!entry) return undefined
    if (entry.pending) return entry.pending.value
    return entry.confirmed ? entry.confirmed.value : undefined
  }

  return {
    /** Starts a local edit: its values show until the server answers. Returns the edit id. */
    beginLocal(tableId: string, fields: TableEditFields): number {
      const editId = ++nextEditId
      for (const field of fieldsOf(fields)) {
        entryFor(tableId, field).pending = {
          value: fields[field] as string | null,
          editId,
        }
      }
      return editId
    },

    /**
     * The server answered a local edit. ok: the server holds the values, so
     * record them as confirmed even when a newer edit has replaced this one.
     * The pending value goes away only if this edit still owns it.
     */
    ackLocal(
      editId: number,
      tableId: string,
      ok: boolean,
      fields: TableEditFields,
    ): void {
      for (const field of fieldsOf(fields)) {
        const entry = ok
          ? entryFor(tableId, field)
          : tables.get(tableId)?.[field]
        if (!entry) continue
        if (ok) {
          entry.confirmed = {
            value: fields[field] as string | null,
            seq: fetchStartSeq,
          }
        }
        if (entry.pending?.editId === editId) delete entry.pending
      }
      prune(tableId)
    },

    /** A peer saved these values. A local pending edit stays on top. */
    applyPeer(tableId: string, fields: TableEditFields): void {
      for (const field of fieldsOf(fields)) {
        entryFor(tableId, field).confirmed = {
          value: fields[field] as string | null,
          seq: fetchStartSeq,
        }
      }
    },

    /**
     * Reconnect: an acknowledgement may have been lost, so the server may not
     * hold a pending value. Drop every pending value, keep confirmed ones.
     * Returns the ids of the tables that changed.
     */
    releasePending(): Array<string> {
      const touched: Array<string> = []
      for (const [tableId, table] of [...tables]) {
        let changed = false
        for (const field of FIELDS) {
          const entry = table[field]
          if (entry?.pending) {
            delete entry.pending
            changed = true
          }
        }
        if (changed) touched.push(tableId)
        prune(tableId)
      }
      return touched
    },

    /** A reload of the board data starts. */
    onFetchStart(): void {
      fetchStartSeq++
    },

    /** The latest reload landed: drop confirmed values it started after. */
    onFetchSuccess(): void {
      for (const [tableId, table] of [...tables]) {
        for (const field of FIELDS) {
          const entry = table[field]
          if (entry?.confirmed && entry.confirmed.seq < fetchStartSeq) {
            delete entry.confirmed
          }
        }
        prune(tableId)
      }
    },

    /** The value the board shows for a field, or undefined when the data is current. */
    shown,

    /** Lays the shown values over a table. Returns the same object when nothing applies. */
    apply<T extends { id: string; name: string; description?: string | null }>(
      table: T,
    ): T {
      let next: T | undefined
      for (const field of FIELDS) {
        const value = shown(table.id, field)
        const current = table[field]
        if (
          value !== undefined &&
          value !== current &&
          !(value === null && current == null)
        ) {
          next ??= { ...table }
          ;(next as Record<TableEditField, string | null | undefined>)[field] =
            value
        }
      }
      return next ?? table
    },

    /** The table is gone: forget its entries. */
    dropTable(tableId: string): void {
      tables.delete(tableId)
    },

    /** Number of tables with entries (tests). */
    size(): number {
      return tables.size
    },
  }
}

export type TableEditOverlay = ReturnType<typeof createTableEditOverlay>

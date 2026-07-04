/**
 * Search index for the Cmd/Ctrl+K whiteboard palette.
 *
 * Builds a flat, client-side index of tables and columns from the current
 * React Flow nodes so the command palette can filter by name and jump the
 * viewport to the matching table. No API call — the node data already carries
 * `table.name` and `table.columns[].name`.
 */

import type { TableNodeType } from './types'

/** A table entry — selecting it navigates to `tableId`. */
export interface TableSearchEntry {
  type: 'table'
  /** React Flow node id === table id (see convert-to-nodes.ts). */
  tableId: string
  tableName: string
}

/** A column entry — selecting it navigates to its owning `tableId`. */
export interface ColumnSearchEntry {
  type: 'column'
  tableId: string
  tableName: string
  columnId: string
  columnName: string
}

export type SearchEntry = TableSearchEntry | ColumnSearchEntry

/**
 * Flatten nodes into a search index: one entry per table, one per column.
 * Order is stable — all tables first (node order), then all columns.
 */
export function buildSearchIndex(
  nodes: Array<TableNodeType>,
): Array<SearchEntry> {
  const tables: Array<TableSearchEntry> = []
  const columns: Array<ColumnSearchEntry> = []

  for (const node of nodes) {
    const table = node.data.table
    tables.push({
      type: 'table',
      tableId: node.id,
      tableName: table.name,
    })

    for (const column of table.columns) {
      columns.push({
        type: 'column',
        tableId: node.id,
        tableName: table.name,
        columnId: column.id,
        columnName: column.name,
      })
    }
  }

  return [...tables, ...columns]
}

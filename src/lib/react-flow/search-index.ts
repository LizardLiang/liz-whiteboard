/**
 * Search index for the Cmd/Ctrl+K whiteboard palette.
 *
 * Builds a flat, client-side index of tables and columns from the current
 * React Flow nodes so the command palette can filter by name and jump the
 * viewport to the matching table. No API call — the node data already carries
 * `table.name` and `table.columns[].name`.
 */

import type { ExternalTableNodeType, TableNodeType } from './types'

/** A table entry — selecting it navigates to `tableId`. */
export interface TableSearchEntry {
  type: 'table'
  /** React Flow node id === table id (see convert-to-nodes.ts). */
  tableId: string
  tableName: string
  /**
   * Set only for a cross-file reference (LizMeter #83): the file the real
   * table lives in. The palette shows it so two same-named results — the local
   * table and a reference to another file's table of the same name — can be
   * told apart.
   */
  sourceWhiteboardName?: string | null
}

/** A column entry — selecting it navigates to its owning `tableId`. */
export interface ColumnSearchEntry {
  type: 'column'
  tableId: string
  tableName: string
  columnId: string
  columnName: string
  /** As on TableSearchEntry: set only for a cross-file reference. */
  sourceWhiteboardName?: string | null
}

export type SearchEntry = TableSearchEntry | ColumnSearchEntry

/**
 * Flatten nodes into a search index: one entry per table, one per column.
 * Order is stable — all tables first (node order), then all columns.
 */
export function buildSearchIndex(
  nodes: Array<TableNodeType>,
  referenceNodes: Array<ExternalTableNodeType> = [],
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

  // Cross-file references (LizMeter #83) are findable too — a reference you
  // cannot find is a node you cannot get back to on a large board. They index
  // under the SOURCE table's live name, which is what the node actually shows,
  // and navigation still targets the local node id.
  for (const node of referenceNodes) {
    const { sourceTableName, sourceWhiteboardName } = node.data
    tables.push({
      type: 'table',
      tableId: node.id,
      tableName: sourceTableName,
      sourceWhiteboardName,
    })

    for (const column of node.data.columns) {
      columns.push({
        type: 'column',
        tableId: node.id,
        tableName: sourceTableName,
        columnId: column.id,
        columnName: column.name,
        sourceWhiteboardName,
      })
    }
  }

  return [...tables, ...columns]
}

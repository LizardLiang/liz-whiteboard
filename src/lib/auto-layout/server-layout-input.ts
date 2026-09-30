// src/lib/auto-layout/server-layout-input.ts
// Builds computeD3ForceLayout input from persisted whiteboard rows, so the
// server can lay out a board without a browser (SQL import).

import type { Column, DiagramTable, Relationship } from '@/data/models'
import type { LayoutInputEdge, LayoutInputNode } from './d3-force-layout'
import { calculateTableHeight } from '@/lib/react-flow/layout-adapter'

/**
 * The server cannot run canvas measureText, so these approximate the client's
 * measured widths: a 13px column name + type pair (8 px/char) and a 14px header
 * (9 px/char).
 */
export const SERVER_TABLE_MIN_WIDTH = 250
export const SERVER_COLUMN_BASE_WIDTH = 22
export const SERVER_COLUMN_CHAR_WIDTH = 8
export const SERVER_COLUMN_PAIR_GAP_CHARS = 2
export const SERVER_HEADER_BASE_WIDTH = 24
export const SERVER_HEADER_CHAR_WIDTH = 9

export function estimateServerTableWidth(table: LayoutSourceTable): number {
  let widestPair = 0
  for (const col of table.columns) {
    widestPair = Math.max(
      widestPair,
      col.name.length + col.dataType.length + SERVER_COLUMN_PAIR_GAP_CHARS,
    )
  }
  return Math.max(
    table.width ?? 0,
    SERVER_TABLE_MIN_WIDTH,
    SERVER_COLUMN_BASE_WIDTH + SERVER_COLUMN_CHAR_WIDTH * widestPair,
    SERVER_HEADER_BASE_WIDTH + SERVER_HEADER_CHAR_WIDTH * table.name.length,
  )
}

export type LayoutSourceTable = DiagramTable & { columns: Array<Column> }

export function buildServerLayoutInput(
  tables: Array<LayoutSourceTable>,
  relationships: Array<
    Pick<
      Relationship,
      | 'id'
      | 'sourceTableId'
      | 'targetTableId'
      | 'sourceColumnId'
      | 'targetColumnId'
      | 'label'
      | 'cardinality'
    >
  >,
): { nodes: Array<LayoutInputNode>; edges: Array<LayoutInputEdge> } {
  const tablesById = new Map(tables.map((t) => [t.id, t]))

  const rowOf = (tableId: string, columnId: string): number | undefined => {
    const index =
      tablesById.get(tableId)?.columns.findIndex((c) => c.id === columnId) ?? -1
    return index >= 0 ? index : undefined
  }

  const nodes = tables.map((table) => ({
    id: table.id,
    width: estimateServerTableWidth(table),
    height: calculateTableHeight(table.columns.length),
  }))

  const edges = relationships.map((rel) => ({
    id: rel.id,
    source: rel.sourceTableId,
    target: rel.targetTableId,
    label: rel.label || undefined,
    cardinality: rel.cardinality,
    sourceRow: rowOf(rel.sourceTableId, rel.sourceColumnId),
    targetRow: rowOf(rel.targetTableId, rel.targetColumnId),
  }))

  return { nodes, edges }
}

// src/lib/auto-layout/server-layout-input.ts
// Builds computeD3ForceLayout input from persisted whiteboard rows, so the
// server can lay out a board without a browser (SQL import).

import type { Column, DiagramTable, Relationship } from '@/data/models'
import type { LayoutInputEdge, LayoutInputNode } from './d3-force-layout'
import { calculateTableHeight } from '@/lib/react-flow/layout-adapter'

/**
 * Table width the server assumes: the server cannot run canvas measureText, so
 * this is the typical natural width the client measures for an ER table.
 */
export const SERVER_TABLE_WIDTH_ESTIMATE = 280

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
    width: Math.max(SERVER_TABLE_WIDTH_ESTIMATE, table.width ?? 0),
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

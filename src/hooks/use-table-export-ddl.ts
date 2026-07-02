/**
 * useTableExportDdl — keyboard shortcut (d) handler for table DDL export
 *
 * Intercepts bare `d` on a single selected table node and copies that
 * table's CREATE TABLE DDL (default dialect: mssql) to the clipboard,
 * showing a Sonner toast.
 *
 * Guard/dispatch logic (same input-focus/editable guards so it doesn't fire
 * while typing in a column name) is shared with the other table-scoped
 * shortcuts via useSingleSelectedTableShortcut.
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import type { Dialect } from '@/lib/ddl-generator'
import type { DiagramTableWithRelations } from '@/data/diagram-table'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { generateTableDDL } from '@/lib/ddl-generator'
import { useSingleSelectedTableShortcut } from './use-single-selected-table-shortcut'

const DEFAULT_SHORTCUT_DIALECT: Dialect = 'mssql'

/**
 * Joins React Flow nodes (each carrying a table + its columns) with edges
 * (each carrying a full Relationship, including sourceTableId/targetTableId)
 * into DiagramTableWithRelations[] — the shape generateTableDDL expects.
 *
 * Node data only stores `columns` (see TableNodeData); relationships live on
 * edges instead, so outgoing/incoming relationships must be derived here.
 */
export function buildDiagramTablesFromFlow(
  nodes: Array<TableNodeType>,
  edges: Array<RelationshipEdgeType>,
): Array<DiagramTableWithRelations> {
  const outgoingByTableId = new Map<
    string,
    Array<DiagramTableWithRelations['outgoingRelationships'][number]>
  >()
  const incomingByTableId = new Map<
    string,
    Array<DiagramTableWithRelations['incomingRelationships'][number]>
  >()

  for (const edge of edges) {
    const relationship = edge.data?.relationship
    if (!relationship) continue

    const outgoing = outgoingByTableId.get(relationship.sourceTableId) ?? []
    outgoing.push(relationship)
    outgoingByTableId.set(relationship.sourceTableId, outgoing)

    const incoming = incomingByTableId.get(relationship.targetTableId) ?? []
    incoming.push(relationship)
    incomingByTableId.set(relationship.targetTableId, incoming)
  }

  return nodes.map((node) => ({
    ...node.data.table,
    outgoingRelationships: outgoingByTableId.get(node.id) ?? [],
    incomingRelationships: incomingByTableId.get(node.id) ?? [],
  }))
}

/**
 * Reusable DDL export helper: generates DDL for tableId in dialect, copies
 * it to the clipboard, and shows a success/error toast. Called both by the
 * "d" keyboard shortcut below and by the context-menu "Export DDL" submenu
 * (via ReactFlowWhiteboard's onExportDdl wiring).
 */
export async function exportTableDdl(
  tables: Array<DiagramTableWithRelations>,
  tableId: string,
  dialect: Dialect,
): Promise<void> {
  try {
    const ddl = generateTableDDL(tables, tableId, dialect)
    const tableName = tables.find((t) => t.id === tableId)?.name ?? tableId
    await navigator.clipboard.writeText(ddl)
    toast.success(`${tableName} DDL copied (${dialect})`)
  } catch (error) {
    toast.error(
      `Failed to export DDL: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

export function useTableExportDdl(): void {
  const { getNodes, getEdges } = useReactFlow<
    TableNodeType,
    RelationshipEdgeType
  >()

  const onTrigger = useCallback(
    (tableId: string) => {
      const tables = buildDiagramTablesFromFlow(getNodes(), getEdges())
      void exportTableDdl(tables, tableId, DEFAULT_SHORTCUT_DIALECT)
    },
    [getNodes, getEdges],
  )

  useSingleSelectedTableShortcut({ key: 'd', onTrigger })
}

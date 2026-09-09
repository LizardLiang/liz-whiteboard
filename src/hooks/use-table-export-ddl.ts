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
import { useSingleSelectedTableShortcut } from './use-single-selected-table-shortcut'
import type { Dialect, ExternalTableRef } from '@/lib/ddl-generator'
import type { DiagramTableWithRelations } from '@/data/diagram-table'
import type {
  ExternalTableNodeType,
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { generateTableDDL } from '@/lib/ddl-generator'
import { copyText } from '@/lib/copy-text'

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
  externalTables?: Map<string, ExternalTableRef>,
): Promise<void> {
  try {
    const ddl = generateTableDDL(tables, tableId, dialect, externalTables)
    const tableName = tables.find((t) => t.id === tableId)?.name ?? tableId
    const copied = await copyText(ddl)
    if (!copied) {
      toast.error('Could not copy DDL — select and copy the text manually.')
      return
    }
    toast.success(`${tableName} DDL copied (${dialect})`)
  } catch (error) {
    toast.error(
      `Failed to export DDL: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Split React Flow's node list into the two kinds the DDL export cares about.
 *
 * `getNodes()` returns EVERY node the board renders — areas, comments, shapes
 * and cross-file references included — not the table list the export path
 * assumes. A reference node carries no `data.table`, so spreading it produced
 * a row with no `columns` and the generator threw "x.columns is not
 * iterable": DDL export was broken for EVERY table on any board holding a
 * reference (LizMeter #83, found by dogfooding).
 */
export function partitionNodesForDdl(nodes: Array<unknown>): {
  tableNodes: Array<TableNodeType>
  referenceNodes: Array<ExternalTableNodeType>
} {
  const typed = nodes as Array<{ type?: string }>
  return {
    tableNodes: typed.filter(
      (node) => node.type === 'table',
    ) as unknown as Array<TableNodeType>,
    referenceNodes: typed.filter(
      (node) => node.type === 'externalTable',
    ) as unknown as Array<ExternalTableNodeType>,
  }
}

export function useTableExportDdl(): void {
  const { getNodes, getEdges } = useReactFlow<
    TableNodeType,
    RelationshipEdgeType
  >()

  const onTrigger = useCallback(
    (tableId: string) => {
      const { tableNodes, referenceNodes } = partitionNodesForDdl(getNodes())
      const tables = buildDiagramTablesFromFlow(tableNodes, getEdges())
      void exportTableDdl(
        tables,
        tableId,
        DEFAULT_SHORTCUT_DIALECT,
        buildExternalTableRefs(referenceNodes),
      )
    },
    [getNodes, getEdges],
  )

  useSingleSelectedTableShortcut({ key: 'd', onTrigger })
}

/**
 * Index the board's cross-file references by their LOCAL row id, in the shape
 * generateTableDDL needs (LizMeter #83).
 *
 * Reference nodes never reach `buildDiagramTablesFromFlow` — they are filtered
 * out of the table node list — so without this map a foreign key pointing at
 * one is silently dropped from the exported DDL.
 */
export function buildExternalTableRefs(
  referenceNodes: Array<ExternalTableNodeType>,
): Map<string, ExternalTableRef> {
  return new Map(
    referenceNodes.map((node) => [
      node.id,
      {
        sourceTableName: node.data.sourceTableName,
        sourceWhiteboardName: node.data.sourceWhiteboardName,
        columnNames: new Map(
          node.data.columns.map((column) => [column.id, column.name]),
        ),
      },
    ]),
  )
}

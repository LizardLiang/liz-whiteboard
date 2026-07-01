/**
 * useTableExportDdl — keyboard shortcut (d) handler for table DDL export
 *
 * Registers a document-level keydown listener that intercepts bare `d` on a
 * single selected table node and copies that table's CREATE TABLE DDL
 * (default dialect: mssql) to the clipboard, showing a Sonner toast.
 *
 * Mirrors useTableFocus's guard structure exactly (same input-focus/editable
 * guards so it doesn't fire while typing in a column name).
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import type { Dialect } from '@/lib/ddl-generator'
import type { DiagramTableWithRelations } from '@/data/diagram-table'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { generateTableDDL } from '@/lib/ddl-generator'

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only bare lowercase 'd' — any modifier disqualifies
      if (e.key !== 'd') return
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return

      const active = document.activeElement
      if (!active) return

      // Skip if focus is on an input, textarea, or contenteditable element
      const tag = active.tagName.toLowerCase()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        active.getAttribute('contenteditable') === 'true'
      ) {
        return
      }

      // Skip if focus is inside a column row or add-column row
      // (column rows handle their own key events)
      if (active.closest('.column-row') || active.closest('.add-column-row')) {
        return
      }

      // Read currently selected nodes
      const selectedNodes = getNodes().filter((n) => n.selected)

      // Only act on exactly one selected node
      if (selectedNodes.length !== 1) return

      const tables = buildDiagramTablesFromFlow(getNodes(), getEdges())
      void exportTableDdl(tables, selectedNodes[0].id, DEFAULT_SHORTCUT_DIALECT)
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
    }
  }, [getNodes, getEdges])
}

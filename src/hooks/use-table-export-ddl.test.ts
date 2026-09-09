// src/hooks/use-table-export-ddl.test.ts
//
// Regression coverage for the `d`-shortcut DDL export on a board that holds a
// cross-file reference (LizMeter #83). Found by dogfooding: pressing `d` on
// ANY table of such a board failed with "Failed to export DDL: x.columns is
// not iterable", because the shortcut fed React Flow's whole node list —
// areas, comments, shapes and reference nodes included — into a builder that
// expects table nodes only.
//
// The pure helper is tested rather than the hook: `useTableExportDdl` only
// wires `getNodes()`/`getEdges()` into it, the same way ReactFlowCanvas's
// connection predicate is tested through `computeConnectionValidity`.

import { describe, expect, it } from 'vitest'

import {
  buildDiagramTablesFromFlow,
  buildExternalTableRefs,
  partitionNodesForDdl,
} from './use-table-export-ddl'

function tableNode(id: string, columnId: string) {
  return {
    id,
    type: 'table',
    data: {
      table: {
        id,
        name: id,
        columns: [{ id: columnId, name: 'id', dataType: 'UUID' }],
      },
    },
  }
}

function referenceNode(id: string) {
  return {
    id,
    type: 'externalTable',
    data: {
      sourceTableName: 'orders',
      sourceWhiteboardName: 'Billing',
      columns: [{ id: 'stub-1', name: 'customer_id' }],
    },
  }
}

const MIXED_BOARD = [
  tableNode('invoices', 'invoices-id'),
  referenceNode('ref-1'),
  { id: 'area-1', type: 'area', data: {} },
  { id: 'comment-1', type: 'comment', data: {} },
  { id: 'shape-1', type: 'shape', data: {} },
]

describe('partitionNodesForDdl', () => {
  it('keeps only table nodes for the DDL builder', () => {
    const { tableNodes } = partitionNodesForDdl(MIXED_BOARD)

    expect(tableNodes.map((n) => n.id)).toEqual(['invoices'])
  })

  it('hands the reference nodes back separately, so their names still reach the export', () => {
    const { referenceNodes } = partitionNodesForDdl(MIXED_BOARD)

    expect(referenceNodes.map((n) => n.id)).toEqual(['ref-1'])
    expect(buildExternalTableRefs(referenceNodes).get('ref-1')).toMatchObject({
      sourceTableName: 'orders',
      sourceWhiteboardName: 'Billing',
    })
  })

  it('produces rows every one of which carries columns — the crash was a row without them', () => {
    const { tableNodes } = partitionNodesForDdl(MIXED_BOARD)

    const tables = buildDiagramTablesFromFlow(tableNodes, [])

    expect(tables).toHaveLength(1)
    for (const table of tables) {
      expect(Array.isArray(table.columns)).toBe(true)
    }
  })

  it('shows what the unpartitioned list did: a reference node yields a row with no columns', () => {
    // Not a wish — this is the exact shape that made generateTableDDL throw.
    const tables = buildDiagramTablesFromFlow(
      MIXED_BOARD as never,
      [],
    ) as Array<{ columns?: unknown }>

    expect(tables.some((table) => table.columns === undefined)).toBe(true)
  })
})

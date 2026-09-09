// src/lib/react-flow/search-index-references.test.ts
// Cross-file references in the Cmd/Ctrl+K index (LizMeter #83).

import { describe, expect, it } from 'vitest'

import { buildSearchIndex } from './search-index'
import type { ExternalTableNodeType, TableNodeType } from './types'

function makeTableNode(name: string, columns: Array<string>): TableNodeType {
  return {
    id: `tbl-${name}`,
    type: 'table',
    position: { x: 0, y: 0 },
    data: {
      table: {
        id: `tbl-${name}`,
        whiteboardId: 'wb-1',
        name,
        description: null,
        positionX: 0,
        positionY: 0,
        width: null,
        height: null,
        sourceWhiteboardId: null,
        sourceTableId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        columns: columns.map((columnName, order) => ({
          id: `col-${name}-${columnName}`,
          tableId: `tbl-${name}`,
          name: columnName,
          dataType: 'string',
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: false,
          isNullable: true,
          description: null,
          order,
          sourceColumnId: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        })),
      },
      isActiveHighlighted: false,
      isHighlighted: false,
      isRelationsPreviewOpen: false,
      showMode: 'ALL_FIELDS',
    },
  } as TableNodeType
}

function makeReferenceNode(): ExternalTableNodeType {
  return {
    id: 'ref-1',
    type: 'externalTable',
    position: { x: 0, y: 0 },
    data: {
      tableId: 'ref-1',
      sourceWhiteboardId: 'wb-billing',
      sourceTableId: 'tbl-orders',
      sourceTableName: 'orders',
      sourceWhiteboardName: 'Billing',
      columns: [
        {
          id: 'stub-1',
          name: 'id',
          dataType: 'uuid',
          isPrimaryKey: true,
          isForeignKey: false,
          missing: false,
        },
      ],
      missing: false,
      isActiveHighlighted: false,
      isHighlighted: false,
      showMode: 'ALL_FIELDS',
    },
  } as ExternalTableNodeType
}

describe('buildSearchIndex with references', () => {
  it('indexes nothing extra when no references are passed', () => {
    const index = buildSearchIndex([makeTableNode('invoices', ['id'])])

    expect(index.filter((e) => e.type === 'table')).toHaveLength(1)
  })

  it('indexes a reference under the source table name', () => {
    const index = buildSearchIndex(
      [makeTableNode('invoices', ['id'])],
      [makeReferenceNode()],
    )

    const tables = index.filter((e) => e.type === 'table')
    expect(tables.map((e) => e.tableName).sort()).toEqual([
      'invoices',
      'orders',
    ])
  })

  it('navigates to the LOCAL node id, not the source table id', () => {
    const index = buildSearchIndex([], [makeReferenceNode()])

    const entry = index.find((e) => e.type === 'table')!
    expect(entry.tableId).toBe('ref-1')
  })

  it('labels a reference with the file its table really lives in', () => {
    const index = buildSearchIndex([], [makeReferenceNode()])

    const entry = index.find((e) => e.type === 'table')!
    expect(entry.sourceWhiteboardName).toBe('Billing')
  })

  it('leaves a local table unlabelled, so only references show a file', () => {
    const index = buildSearchIndex([makeTableNode('invoices', ['id'])])

    const entry = index.find((e) => e.type === 'table')!
    expect(entry.sourceWhiteboardName).toBeUndefined()
  })

  it('indexes a reference stub column, keyed by the stub id', () => {
    const index = buildSearchIndex([], [makeReferenceNode()])

    const column = index.find((e) => e.type === 'column')!
    expect(column.columnId).toBe('stub-1')
    expect(column.columnName).toBe('id')
    expect(column.tableId).toBe('ref-1')
  })
})

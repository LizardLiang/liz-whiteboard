// src/lib/ddl-generator-references.test.ts
// How a cross-file reference appears in exported DDL (LizMeter #83): as a
// comment plus a real foreign key, never as a second CREATE TABLE.

import { describe, expect, it } from 'vitest'

import { generateTableDDL } from './ddl-generator'
import type { ExternalTableRef } from './ddl-generator'
import type { DiagramTableWithRelations } from '@/data/diagram-table'

const REF_ID = 'ref-1'
const STUB_COL_ID = 'stub-1'

function makeInvoices(): DiagramTableWithRelations {
  return {
    id: 'tbl-invoices',
    whiteboardId: 'wb-1',
    name: 'invoices',
    description: null,
    positionX: 0,
    positionY: 0,
    width: null,
    height: null,
    sourceWhiteboardId: null,
    sourceTableId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    columns: [
      {
        id: 'col-order-id',
        tableId: 'tbl-invoices',
        name: 'order_id',
        dataType: 'uuid',
        isPrimaryKey: false,
        isForeignKey: true,
        isUnique: false,
        isNullable: false,
        description: null,
        order: 0,
        sourceColumnId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    outgoingRelationships: [
      {
        id: 'rel-1',
        whiteboardId: 'wb-1',
        sourceTableId: 'tbl-invoices',
        targetTableId: REF_ID,
        sourceColumnId: 'col-order-id',
        targetColumnId: STUB_COL_ID,
        cardinality: 'MANY_TO_ONE',
        label: null,
        routingPoints: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    incomingRelationships: [],
  } as unknown as DiagramTableWithRelations
}

const EXTERNALS = new Map<string, ExternalTableRef>([
  [
    REF_ID,
    {
      sourceTableName: 'orders',
      sourceWhiteboardName: 'Billing',
      columnNames: new Map([[STUB_COL_ID, 'id']]),
    },
  ],
])

describe('generateTableDDL with cross-file references', () => {
  it('emits the foreign key using the SOURCE table and column names', () => {
    const ddl = generateTableDDL(
      [makeInvoices()],
      'tbl-invoices',
      'postgres',
      EXTERNALS,
    )

    expect(ddl).toContain('FOREIGN KEY ("order_id") REFERENCES "orders"("id")')
  })

  it('never defines the referenced table', () => {
    const ddl = generateTableDDL(
      [makeInvoices()],
      'tbl-invoices',
      'postgres',
      EXTERNALS,
    )

    expect(ddl).not.toContain('CREATE TABLE "orders"')
    expect(ddl.match(/CREATE TABLE/g)).toHaveLength(1)
  })

  it('records where the referenced table lives, as a comment', () => {
    const ddl = generateTableDDL(
      [makeInvoices()],
      'tbl-invoices',
      'postgres',
      EXTERNALS,
    )

    expect(ddl).toContain('-- external ref: file "Billing" table "orders"')
  })

  it('marks a deleted source file rather than naming it', () => {
    const ddl = generateTableDDL([makeInvoices()], 'tbl-invoices', 'postgres', {
      ...EXTERNALS,
      get: (key: string) =>
        key === REF_ID
          ? {
              sourceTableName: 'orders',
              sourceWhiteboardName: null,
              columnNames: new Map([[STUB_COL_ID, 'id']]),
            }
          : undefined,
    } as unknown as Map<string, ExternalTableRef>)

    expect(ddl).toContain('-- external ref: file "(missing)" table "orders"')
  })

  it('drops the constraint when the reference is unknown, rather than emitting a broken one', () => {
    // No externals map: the target resolves to nothing at all.
    const ddl = generateTableDDL([makeInvoices()], 'tbl-invoices', 'postgres')

    expect(ddl).not.toContain('FOREIGN KEY')
    expect(ddl).not.toContain('-- external ref')
  })

  it('adds no comment when the table points at no reference', () => {
    const plain = makeInvoices()
    plain.outgoingRelationships = []

    const ddl = generateTableDDL([plain], 'tbl-invoices', 'postgres', EXTERNALS)

    expect(ddl).not.toContain('-- external ref')
  })
})

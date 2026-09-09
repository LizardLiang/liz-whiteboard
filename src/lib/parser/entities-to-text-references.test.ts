// src/lib/parser/entities-to-text-references.test.ts
// How a cross-file reference survives the text-source round-trip (LizMeter #83):
// as a comment, never as a `table` block another file already owns.

import { describe, expect, it } from 'vitest'

import { entitiesToText, parseDiagram } from './diagram-parser'

const TABLES = [
  {
    id: 'tbl-invoices',
    name: 'invoices',
    columns: [
      {
        id: 'col-1',
        name: 'id',
        dataType: 'uuid',
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
      },
    ],
  },
  {
    id: 'ref-1',
    name: 'orders (Billing)',
    columns: [
      {
        id: 'stub-1',
        name: 'id',
        dataType: 'uuid',
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
      },
    ],
  },
]

const REFERENCES = new Map([
  ['ref-1', { sourceTableName: 'orders', sourceWhiteboardName: 'Billing' }],
])

describe('entitiesToText with cross-file references', () => {
  it('writes a table block for a real table', () => {
    const text = entitiesToText(TABLES, [], REFERENCES)

    expect(text).toContain('table invoices {')
  })

  it('never writes a table block for a reference', () => {
    const text = entitiesToText(TABLES, [], REFERENCES)

    expect(text).not.toContain('table orders')
    expect(text).not.toContain('table orders (Billing)')
  })

  it('records the reference as a comment naming its file', () => {
    const text = entitiesToText(TABLES, [], REFERENCES)

    expect(text).toContain('# external ref: file "Billing" table "orders"')
  })

  it('marks a deleted source file rather than naming it', () => {
    const text = entitiesToText(
      TABLES,
      [],
      new Map([
        ['ref-1', { sourceTableName: 'orders', sourceWhiteboardName: null }],
      ]),
    )

    expect(text).toContain('# external ref: file "(missing)" table "orders"')
  })

  it('writes every table when no references are given', () => {
    const text = entitiesToText(TABLES, [])

    expect(text).toContain('table invoices {')
    expect(text).toContain('table orders (Billing) {')
  })

  it('round-trips: re-parsing the text creates no table for the reference', () => {
    const text = entitiesToText(TABLES, [], REFERENCES)

    const result = parseDiagram(text)

    expect(result.errors).toHaveLength(0)
    expect(result.ast?.tables.map((t) => t.name)).toEqual(['invoices'])
  })
})

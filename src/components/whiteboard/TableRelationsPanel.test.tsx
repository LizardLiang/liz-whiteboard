// src/components/whiteboard/TableRelationsPanel.test.tsx
// RTL render tests for TableRelationsPanel (table-hover-preview-trigger-and-connection-revamp)

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TableRelationsPanel } from './TableRelationsPanel'
import type { Column, DiagramTable } from '@/data/models'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'

afterEach(() => {
  cleanup()
})

function makeTable(
  id: string,
  name: string,
  columns: Array<{ id: string; name: string; isPrimaryKey: boolean }>,
): DiagramTable & { columns: Array<Column> } {
  return {
    id,
    whiteboardId: 'wb-1',
    name,
    description: null,
    positionX: 0,
    positionY: 0,
    width: null,
    height: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    columns: columns.map((c, idx) => ({
      id: c.id,
      tableId: id,
      name: c.name,
      dataType: 'text',
      isPrimaryKey: c.isPrimaryKey,
      isForeignKey: false,
      isUnique: false,
      isNullable: true,
      description: null,
      order: idx,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  } as unknown as DiagramTable & { columns: Array<Column> }
}

function makeEdge(
  overrides: Partial<{
    id: string
    source: string
    target: string
    sourceColumn: { id: string; name: string }
    targetColumn: { id: string; name: string }
    label: string | null
    cardinality: string
  }> = {},
): RelationshipEdgeType {
  const {
    id = 'edge-1',
    source = 'table-a',
    target = 'table-b',
    sourceColumn = { id: 'a-col-1', name: 'id' },
    targetColumn = { id: 'b-col-fk', name: 'a_id' },
    label = null,
    cardinality = 'ONE_TO_MANY',
  } = overrides

  return {
    id,
    type: 'relationship',
    source,
    target,
    data: {
      relationship: {
        id,
        whiteboardId: 'wb-1',
        sourceTableId: source,
        targetTableId: target,
        sourceColumnId: sourceColumn.id,
        targetColumnId: targetColumn.id,
        cardinality: cardinality as any,
        label,
        routingPoints: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        sourceColumn: {
          id: sourceColumn.id,
          tableId: source,
          name: sourceColumn.name,
          dataType: 'text',
          isPrimaryKey: true,
          isForeignKey: false,
          isUnique: false,
          isNullable: false,
          description: null,
          order: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        targetColumn: {
          id: targetColumn.id,
          tableId: target,
          name: targetColumn.name,
          dataType: 'text',
          isPrimaryKey: false,
          isForeignKey: true,
          isUnique: false,
          isNullable: true,
          description: null,
          order: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      cardinality: cardinality as any,
      isHighlighted: false,
      label: label ?? undefined,
    },
  } as unknown as RelationshipEdgeType
}

describe('TableRelationsPanel', () => {
  it('renders the static "Related tables" header', () => {
    const table = makeTable('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])

    render(
      <TableRelationsPanel
        table={table}
        relatedEdges={[]}
        tableNameById={new Map([[table.id, table.name]])}
      />,
    )

    expect(screen.getByText('Related tables')).toBeDefined()
  })

  it('renders one row per related edge with a field-to-field connection line', () => {
    const tableA = makeTable('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])
    const edge = makeEdge({
      id: 'edge-1',
      source: 'table-a',
      target: 'table-b',
      sourceColumn: { id: 'a-col-1', name: 'id' },
      targetColumn: { id: 'b-col-fk', name: 'user_id' },
      label: 'has many',
    })

    render(
      <TableRelationsPanel
        table={tableA}
        relatedEdges={[edge]}
        tableNameById={
          new Map([
            ['table-a', 'Users'],
            ['table-b', 'Orders'],
          ])
        }
      />,
    )

    expect(screen.getByText('Orders')).toBeDefined()
    const connection = screen.getByTestId('relations-panel-connection')
    expect(connection.textContent).toContain('Users.id')
    expect(connection.textContent).toContain('Orders.user_id')
    expect(screen.getByText('has many')).toBeDefined()
  })

  it('falls back to the raw cardinality string when label is empty', () => {
    const tableA = makeTable('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])
    const edge = makeEdge({
      id: 'edge-1',
      source: 'table-a',
      target: 'table-b',
      sourceColumn: { id: 'a-col-1', name: 'id' },
      targetColumn: { id: 'b-col-fk', name: 'user_id' },
      label: null,
      cardinality: 'ONE_TO_MANY',
    })

    render(
      <TableRelationsPanel
        table={tableA}
        relatedEdges={[edge]}
        tableNameById={
          new Map([
            ['table-a', 'Users'],
            ['table-b', 'Orders'],
          ])
        }
      />,
    )

    expect(screen.getByText('ONE_TO_MANY')).toBeDefined()
  })

  it('renders "No related tables" when relatedEdges is empty', () => {
    const table = makeTable('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])

    render(
      <TableRelationsPanel
        table={table}
        relatedEdges={[]}
        tableNameById={new Map([[table.id, table.name]])}
      />,
    )

    expect(screen.getByText('No related tables')).toBeDefined()
  })

  it('does not throw and skips the row when tableNameById is missing an entry for the related table', () => {
    const tableA = makeTable('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])
    const edge = makeEdge({
      id: 'edge-1',
      source: 'table-a',
      target: 'table-missing',
      sourceColumn: { id: 'a-col-1', name: 'id' },
      targetColumn: { id: 'missing-col-fk', name: 'user_id' },
    })

    expect(() =>
      render(
        <TableRelationsPanel
          table={tableA}
          relatedEdges={[edge]}
          tableNameById={new Map([['table-a', 'Users']])}
        />,
      ),
    ).not.toThrow()

    // The row for the missing related table is defensively skipped — header
    // still renders, no crash, and no row content for it appears.
    expect(screen.getByText('Related tables')).toBeDefined()
    expect(screen.queryByText('user_id')).toBeNull()
    expect(screen.queryAllByTestId('relations-panel-row')).toHaveLength(0)
  })

  it('defaults to right-side placement', () => {
    // getBoundingClientRect() always returns an all-zero rect in jsdom (no
    // real layout engine), so the auto-flip's overflow check can never
    // observe a real overflow here — it deterministically resolves to
    // 'right' in this environment. This test only pins the default; the
    // left-flip branch requires manual/browser verification.
    const table = makeTable('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])

    render(
      <TableRelationsPanel
        table={table}
        relatedEdges={[]}
        tableNameById={new Map([[table.id, table.name]])}
      />,
    )

    expect(screen.getByTestId('table-relations-panel').dataset.side).toBe(
      'right',
    )
  })

  it('renders exactly one row for a self-referencing relationship edge', () => {
    // Regression guard for the getDirectlyRelatedTableIds dedup fix: a
    // self-referencing edge (source === target === table.id) must produce
    // exactly one row here, not two.
    const table = makeTable('table-a', 'Employees', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
      { id: 'a-col-fk', name: 'manager_id', isPrimaryKey: false },
    ])
    const selfEdge = makeEdge({
      id: 'edge-self',
      source: 'table-a',
      target: 'table-a',
      sourceColumn: { id: 'a-col-1', name: 'id' },
      targetColumn: { id: 'a-col-fk', name: 'manager_id' },
      label: 'reports to',
    })

    render(
      <TableRelationsPanel
        table={table}
        relatedEdges={[selfEdge]}
        tableNameById={new Map([['table-a', 'Employees']])}
      />,
    )

    expect(screen.getAllByTestId('relations-panel-row')).toHaveLength(1)
    expect(screen.getAllByText('reports to')).toHaveLength(1)
    const connection = screen.getByTestId('relations-panel-connection')
    expect(connection.textContent).toContain('Employees.id')
    expect(connection.textContent).toContain('Employees.manager_id')
  })
})

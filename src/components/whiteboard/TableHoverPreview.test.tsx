// src/components/whiteboard/TableHoverPreview.test.tsx
// RTL render tests for TableHoverPreview (GitHub issue #99 hover preview card)

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TableHoverPreview } from './TableHoverPreview'
import type { RelationshipEdgeType, TableNodeType } from '@/lib/react-flow/types'

afterEach(() => {
  cleanup()
})

function makeNode(
  id: string,
  name: string,
  columns: Array<{ id: string; name: string; isPrimaryKey: boolean }>,
): TableNodeType {
  return {
    id,
    type: 'table',
    position: { x: 0, y: 0 },
    data: {
      table: {
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
      },
      isActiveHighlighted: false,
      isHighlighted: false,
      isHovered: false,
      showMode: 'ALL_FIELDS',
    },
  } as unknown as TableNodeType
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

describe('TableHoverPreview', () => {
  it('renders the hovered table name as the header', () => {
    const table = makeNode('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])

    render(
      <TableHoverPreview
        table={table}
        relatedEdges={[]}
        allNodesById={new Map([[table.id, table]])}
        anchorPosition={{ x: 100, y: 100 }}
      />,
    )

    expect(screen.getByText('Users')).toBeDefined()
  })

  it('renders one row per related edge with the correct PK and FK column names', () => {
    const tableA = makeNode('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])
    const tableB = makeNode('table-b', 'Orders', [
      { id: 'b-col-1', name: 'id', isPrimaryKey: true },
      { id: 'b-col-fk', name: 'user_id', isPrimaryKey: false },
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
      <TableHoverPreview
        table={tableA}
        relatedEdges={[edge]}
        allNodesById={
          new Map([
            [tableA.id, tableA],
            [tableB.id, tableB],
          ])
        }
        anchorPosition={{ x: 100, y: 100 }}
      />,
    )

    expect(screen.getByText('Orders')).toBeDefined()
    // Orders' own PK column
    expect(screen.getByText('id')).toBeDefined()
    // The specific FK column connecting Orders back to Users
    expect(screen.getByText('user_id')).toBeDefined()
    expect(screen.getByText('has many')).toBeDefined()
  })

  it('falls back to the raw cardinality string when label is empty', () => {
    const tableA = makeNode('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])
    const tableB = makeNode('table-b', 'Orders', [
      { id: 'b-col-1', name: 'id', isPrimaryKey: true },
      { id: 'b-col-fk', name: 'user_id', isPrimaryKey: false },
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
      <TableHoverPreview
        table={tableA}
        relatedEdges={[edge]}
        allNodesById={
          new Map([
            [tableA.id, tableA],
            [tableB.id, tableB],
          ])
        }
        anchorPosition={{ x: 100, y: 100 }}
      />,
    )

    expect(screen.getByText('ONE_TO_MANY')).toBeDefined()
  })

  it('renders "No related tables" when relatedEdges is empty', () => {
    const table = makeNode('table-a', 'Users', [
      { id: 'a-col-1', name: 'id', isPrimaryKey: true },
    ])

    render(
      <TableHoverPreview
        table={table}
        relatedEdges={[]}
        allNodesById={new Map([[table.id, table]])}
        anchorPosition={{ x: 100, y: 100 }}
      />,
    )

    expect(screen.getByText('No related tables')).toBeDefined()
  })

  it('does not throw when allNodesById is missing an entry for a referenced table id', () => {
    const tableA = makeNode('table-a', 'Users', [
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
        <TableHoverPreview
          table={tableA}
          relatedEdges={[edge]}
          allNodesById={new Map([[tableA.id, tableA]])}
          anchorPosition={{ x: 100, y: 100 }}
        />,
      ),
    ).not.toThrow()

    // The row for the missing related table is defensively skipped —
    // header still renders, no crash, and no row content for it appears.
    expect(screen.getByText('Users')).toBeDefined()
    expect(screen.queryByText('user_id')).toBeNull()
  })

  it('renders exactly one row for a self-referencing relationship edge', () => {
    // Regression guard for the getDirectlyRelatedTableIds dedup fix: a
    // self-referencing edge (source === target === table.id) must produce
    // exactly one row here, not two — this test asserts the component-level
    // symptom (duplicate row / duplicate React key) that the earlier bug
    // caused when relatedEdges contained the same self-loop edge twice.
    const table = makeNode('table-a', 'Employees', [
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
      <TableHoverPreview
        table={table}
        relatedEdges={[selfEdge]}
        allNodesById={new Map([[table.id, table]])}
        anchorPosition={{ x: 100, y: 100 }}
      />,
    )

    expect(screen.getAllByTestId('hover-preview-row')).toHaveLength(1)
    expect(screen.getAllByText('reports to')).toHaveLength(1)
  })
})

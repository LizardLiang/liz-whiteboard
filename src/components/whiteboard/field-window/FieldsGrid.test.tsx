// src/components/whiteboard/field-window/FieldsGrid.test.tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FieldsGrid } from './FieldsGrid'
import type { FieldsGridTable } from './FieldsGrid'

afterEach(() => cleanup())

function makeTable(): FieldsGridTable {
  const base = {
    tableId: 't1',
    isPrimaryKey: false,
    isForeignKey: false,
    isUnique: false,
    isNullable: false,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  return {
    id: 't1',
    name: 'users',
    description: 'app users',
    columns: [
      {
        ...base,
        id: 'c2',
        name: 'email',
        dataType: 'VARCHAR',
        order: 1,
        isUnique: true,
        isNullable: true,
        description: 'login email',
      },
      {
        ...base,
        id: 'c1',
        name: 'id',
        dataType: 'UUID',
        order: 0,
        isPrimaryKey: true,
      },
    ],
  } as unknown as FieldsGridTable
}

describe('FieldsGrid', () => {
  it('lists one row per column in order with badges and comments', () => {
    render(<FieldsGrid table={makeTable()} />)
    const rows = screen.getAllByTestId('fields-drawer-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('id')
    expect(rows[0].textContent).toContain('PK')
    expect(rows[1].textContent).toContain('email')
    expect(rows[1].textContent).toContain('UQ')
    expect(rows[1].textContent).toContain('login email')
  })

  it('shows a muted dash for an empty comment', () => {
    render(<FieldsGrid table={makeTable()} />)
    const comments = screen.getAllByTestId('fields-drawer-comment')
    expect(comments[0].textContent).toBe('—')
    expect(comments[1].textContent).toBe('login email')
  })

  it('shows an empty message for a table without fields', () => {
    render(<FieldsGrid table={{ ...makeTable(), columns: [] }} />)
    expect(screen.getByText('This table has no fields yet.')).toBeTruthy()
  })
})

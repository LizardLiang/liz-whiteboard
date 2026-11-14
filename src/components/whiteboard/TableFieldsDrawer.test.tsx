// src/components/whiteboard/TableFieldsDrawer.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TableFieldsDrawer } from './TableFieldsDrawer'
import type { TableFieldsDrawerTable } from './TableFieldsDrawer'

afterEach(() => cleanup())

function makeTable(): TableFieldsDrawerTable {
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
  } as unknown as TableFieldsDrawerTable
}

describe('TableFieldsDrawer', () => {
  it('renders nothing without a table', () => {
    render(<TableFieldsDrawer table={null} onClose={() => {}} />)
    expect(screen.queryByTestId('table-fields-drawer')).toBeNull()
  })

  it('lists one row per column in order with badges and comments', () => {
    render(<TableFieldsDrawer table={makeTable()} onClose={() => {}} />)
    expect(
      screen.getByRole('heading', { name: 'Fields of users' }),
    ).toBeTruthy()
    expect(screen.getByText('app users')).toBeTruthy()
    const rows = screen.getAllByTestId('fields-drawer-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('id')
    expect(rows[0].textContent).toContain('PK')
    expect(rows[1].textContent).toContain('email')
    expect(rows[1].textContent).toContain('UQ')
    expect(rows[1].textContent).toContain('login email')
  })

  it('shows a muted dash for an empty comment', () => {
    render(<TableFieldsDrawer table={makeTable()} onClose={() => {}} />)
    const comments = screen.getAllByTestId('fields-drawer-comment')
    expect(comments[0].textContent).toBe('—')
    expect(comments[1].textContent).toBe('login email')
  })

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn()
    render(<TableFieldsDrawer table={makeTable()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close fields drawer' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

// @vitest-environment jsdom
// src/components/whiteboard/WhiteboardSearch.test.tsx
// Unit tests for the Cmd/Ctrl+K search palette.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhiteboardSearch } from './WhiteboardSearch'
import type { TableNodeType } from '@/lib/react-flow/types'

// cmdk observes its list element via ResizeObserver and scrolls the active
// item into view — neither is implemented by jsdom. No-op stubs suffice.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {}
}

function node(
  id: string,
  name: string,
  columns: Array<{ id: string; name: string }>,
): TableNodeType {
  return {
    id,
    data: { table: { id, name, columns } },
  } as unknown as TableNodeType
}

const nodes: Array<TableNodeType> = [
  node('t-users', 'users', [
    { id: 'c-users-id', name: 'id' },
    { id: 'c-users-email', name: 'email' },
  ]),
  node('t-orders', 'orders', [{ id: 'c-orders-total', name: 'total' }]),
]

function renderSearch(overrides?: {
  onNavigateToTable?: (id: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  const onNavigateToTable = overrides?.onNavigateToTable ?? vi.fn()
  const onOpenChange = overrides?.onOpenChange ?? vi.fn()
  render(
    <WhiteboardSearch
      open
      onOpenChange={onOpenChange}
      nodes={nodes}
      onNavigateToTable={onNavigateToTable}
    />,
  )
  return { onNavigateToTable, onOpenChange }
}

describe('WhiteboardSearch', () => {
  it('renders Tables and Columns groups with all entries by default', () => {
    renderSearch()
    expect(screen.getByText('Tables')).toBeTruthy()
    expect(screen.getByText('Columns')).toBeTruthy()
    // Both table names and all column names are present.
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(5) // 2 tables + 3 columns
  })

  it('filters to matching table names', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByPlaceholderText(/Search tables/i), 'orders')

    // The orders table (and its columns) match; the users table does not.
    const options = screen.getAllByRole('option')
    const texts = options.map((o) => o.textContent)
    expect(texts).toContain('orders')
    expect(texts).not.toContain('users')
  })

  it('filters to matching column names, showing the owning table', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByPlaceholderText(/Search tables/i), 'email')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    // Column item shows "users.email".
    expect(options[0].textContent).toBe('users.email')
  })

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByPlaceholderText(/Search tables/i), 'zzzznomatch')

    expect(
      screen.getByText('No matching tables or columns.'),
    ).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('navigates to the table and closes when a result is selected', async () => {
    const user = userEvent.setup()
    const onNavigateToTable = vi.fn()
    const onOpenChange = vi.fn()
    renderSearch({ onNavigateToTable, onOpenChange })

    // Click the exact "orders" table option (not a column of orders).
    const ordersTable = screen
      .getAllByRole('option')
      .find((o) => o.textContent === 'orders')!
    await user.click(ordersTable)

    expect(onNavigateToTable).toHaveBeenCalledWith('t-orders')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('navigates to the owning table when a column result is selected', async () => {
    const user = userEvent.setup()
    const onNavigateToTable = vi.fn()
    renderSearch({ onNavigateToTable })

    const columnsGroup = screen.getByText('Columns').closest('[cmdk-group]')!
    const emailColumn = within(columnsGroup as HTMLElement)
      .getAllByRole('option')
      .find((o) => o.textContent === 'users.email')!
    await user.click(emailColumn)

    expect(onNavigateToTable).toHaveBeenCalledWith('t-users')
  })
})

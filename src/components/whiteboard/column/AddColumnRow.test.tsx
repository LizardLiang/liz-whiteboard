// @vitest-environment jsdom
// src/components/whiteboard/column/AddColumnRow.test.tsx
// TS-04: AddColumnRow unit tests

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AddColumnRow } from './AddColumnRow'
import { mockColumn, mockPKColumn } from '@/test/fixtures'
import type { Column } from '@prisma/client'

// Mock DataTypeSelector so we don't need to deal with Radix portal in jsdom
vi.mock('./DataTypeSelector', () => ({
  DataTypeSelector: ({ value, onSelect }: { value: string; onSelect: (v: string) => void }) => (
    <select
      data-testid="data-type-selector"
      value={value}
      onChange={(e) => onSelect(e.target.value)}
    >
      <option value="string">String</option>
      <option value="int">Integer</option>
      <option value="uuid">UUID</option>
    </select>
  ),
}))

const defaultExistingColumns: Array<Column> = [mockPKColumn, mockColumn]

describe('AddColumnRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('TC-04-01: renders a "+" button in collapsed state', () => {
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={vi.fn()}
      />,
    )
    const addBtn = screen.getByRole('button', { name: /add new column/i })
    expect(addBtn).toBeTruthy()
  })

  it('TC-04-02: clicking "+" expands the creation form with name input', () => {
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={vi.fn()}
      />,
    )
    const addBtn = screen.getByRole('button', { name: /add new column/i })
    fireEvent.click(addBtn)
    const nameInput = screen.getByPlaceholderText('column name')
    expect(nameInput).toBeTruthy()
  })

  it('TC-04-03: name input auto-focuses when form expands', () => {
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add new column/i }))
    const nameInput = screen.getByPlaceholderText('column name')
    expect(document.activeElement).toBe(nameInput)
  })

  it('TC-04-04: data type defaults to "string"', () => {
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add new column/i }))
    // After expanding, the type selector shows the current dataType
    // The Select trigger renders with role="combobox" and aria-label set to the current type
    const typeSelector = screen.getByRole('combobox', { name: 'string' })
    expect(typeSelector).toBeTruthy()
  })

  it('TC-04-05: pressing Enter with a valid name calls onCreate with correct payload', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={onCreate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add new column/i }))
    const nameInput = screen.getByPlaceholderText('column name')
    fireEvent.change(nameInput, { target: { value: 'email' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    expect(onCreate).toHaveBeenCalledWith({
      name: 'email',
      dataType: 'string',
      order: expect.any(Number),
    })
  })

  it('TC-04-06: order is calculated as max(existing orders) + 1', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    // Columns at orders 0 (id) and 1 (email) → new order = 2
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={[mockPKColumn, mockColumn]}
        onCreate={onCreate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add new column/i }))
    const nameInput = screen.getByPlaceholderText('column name')
    fireEvent.change(nameInput, { target: { value: 'new_col' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 2 }),
    )
  })

  it('TC-04-07: pressing Escape with empty name discards the form without calling onCreate', () => {
    const onCreate = vi.fn()
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={onCreate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add new column/i }))
    const nameInput = screen.getByPlaceholderText('column name')
    fireEvent.keyDown(nameInput, { key: 'Escape' })

    expect(onCreate).not.toHaveBeenCalled()
    // Row should collapse back (the "+" button returns)
    expect(screen.getByRole('button', { name: /add new column/i })).toBeTruthy()
  })

  it('TC-04-08: blurring name input with empty value discards the form', async () => {
    const onCreate = vi.fn()
    render(
      <AddColumnRow
        tableId="tbl-001"
        existingColumns={defaultExistingColumns}
        onCreate={onCreate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add new column/i }))
    const nameInput = screen.getByPlaceholderText('column name')
    // Blur without typing anything (value is empty)
    fireEvent.blur(nameInput)

    // onCreate should not be called for empty name
    expect(onCreate).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
// src/components/whiteboard/column/ColumnRow.test.tsx
// TS-06: ColumnRow unit tests

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ColumnRow } from './ColumnRow'
import { mockColumn, mockFKColumn } from '@/test/fixtures'
import type { EditingField } from './types'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'

// Mock React Flow Handle (not needed in unit tests)
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

// Mock DataTypeSelector to avoid Radix portal complexity
vi.mock('./DataTypeSelector', () => ({
  DataTypeSelector: ({
    value,
    onSelect,
  }: {
    value: string
    onSelect: (v: string) => void
  }) => (
    <select
      data-testid="data-type-selector"
      value={value}
      onChange={(e) => onSelect(e.target.value)}
    >
      <option value="string">String</option>
      <option value="int">Integer</option>
    </select>
  ),
}))

// Mock edge-routing utility
vi.mock('@/lib/react-flow/edge-routing', () => ({
  createColumnHandleId: (tableId: string, columnId: string, side: string, type?: string) =>
    type ? `${tableId}-${columnId}-${side}-${type}` : `${tableId}-${columnId}-${side}`,
}))

const defaultProps = {
  column: mockColumn,
  tableId: 'tbl-001',
  isLast: false,
  editingField: null as EditingField | null,
  onStartEdit: vi.fn(),
  onCommitEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onToggleConstraint: vi.fn(),
  onDelete: vi.fn(),
  edges: [] as Array<RelationshipEdgeType>,
}

describe('ColumnRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('TC-06-01: renders column name and data type as static text in default state', () => {
    render(<ColumnRow {...defaultProps} />)
    expect(screen.getByText('email')).toBeTruthy()
    expect(screen.getByText('string')).toBeTruthy()
    // No text input (not in edit mode)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('TC-06-02: double-clicking name calls onStartEdit with name field', () => {
    const onStartEdit = vi.fn()
    render(<ColumnRow {...defaultProps} onStartEdit={onStartEdit} />)
    const nameSpan = screen.getByText('email')
    fireEvent.dblClick(nameSpan)
    expect(onStartEdit).toHaveBeenCalledWith(mockColumn.id, 'name')
  })

  it('TC-06-03: when editingField matches this column name, InlineNameEditor renders', () => {
    const editingField: EditingField = { columnId: mockColumn.id, field: 'name' }
    render(<ColumnRow {...defaultProps} editingField={editingField} />)
    // InlineNameEditor renders an input
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('TC-06-04: double-clicking dataType calls onStartEdit with dataType field', () => {
    const onStartEdit = vi.fn()
    render(<ColumnRow {...defaultProps} onStartEdit={onStartEdit} />)
    const typeSpan = screen.getByText('string')
    fireEvent.dblClick(typeSpan)
    expect(onStartEdit).toHaveBeenCalledWith(mockColumn.id, 'dataType')
  })

  it('TC-06-05: when editingField matches dataType, DataTypeSelector renders', () => {
    const editingField: EditingField = { columnId: mockColumn.id, field: 'dataType' }
    render(<ColumnRow {...defaultProps} editingField={editingField} />)
    expect(screen.getByTestId('data-type-selector')).toBeTruthy()
  })

  it('TC-06-06: delete button is initially hidden (opacity 0)', () => {
    render(<ColumnRow {...defaultProps} />)
    const deleteBtn = screen.getByRole('button', { name: /delete column/i })
    expect(deleteBtn.style.opacity).toBe('0')
  })

  it('TC-06-07: clicking delete on column with no edges calls onDelete directly', () => {
    const onDelete = vi.fn()
    render(<ColumnRow {...defaultProps} edges={[]} onDelete={onDelete} />)
    const deleteBtn = screen.getByRole('button', { name: /delete column/i })
    fireEvent.click(deleteBtn)
    expect(onDelete).toHaveBeenCalledWith(mockColumn)
  })

  it('TC-06-09: row has editing background when in edit mode', () => {
    const editingField: EditingField = { columnId: mockColumn.id, field: 'name' }
    render(<ColumnRow {...defaultProps} editingField={editingField} />)
    // Find the column-row container
    const rows = document.querySelectorAll('.column-row.editing')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('TC-06-09b: row does NOT have editing class when not in edit mode', () => {
    render(<ColumnRow {...defaultProps} editingField={null} />)
    const rows = document.querySelectorAll('.column-row.editing')
    expect(rows.length).toBe(0)
  })

  it('TC-06-10: name span has cursor:text style', () => {
    render(<ColumnRow {...defaultProps} />)
    const nameSpan = screen.getByText('email')
    expect(nameSpan.style.cursor).toBe('text')
  })
})

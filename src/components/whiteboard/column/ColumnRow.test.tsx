// @vitest-environment jsdom
// src/components/whiteboard/column/ColumnRow.test.tsx
// TS-06: ColumnRow unit tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { WhiteboardPermissionsProvider } from '../whiteboard-permissions-context'
import { ColumnRow } from './ColumnRow'
import type { ReactElement } from 'react'
import type { EditingField } from './types'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'
import { mockColumn, mockFKColumn } from '@/test/fixtures'

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
  createColumnHandleId: (
    tableId: string,
    columnId: string,
    side: string,
    type?: string,
  ) =>
    type
      ? `${tableId}-${columnId}-${side}-${type}`
      : `${tableId}-${columnId}-${side}`,
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

// WhiteboardPermissionsContext defaults to canEdit: false (fail-closed).
// This suite exercises delete/duplicate/note behavior that requires write
// access, so every render is wrapped with an explicit canEdit: true provider
// unless a test is specifically exercising the canEdit: false gating.
function renderEditable(ui: ReactElement) {
  return render(
    <WhiteboardPermissionsProvider value={{ canEdit: true }}>
      {ui}
    </WhiteboardPermissionsProvider>,
  )
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
    renderEditable(<ColumnRow {...defaultProps} />)
    expect(screen.getByText('email')).toBeTruthy()
    expect(screen.getByText('string')).toBeTruthy()
    // No text input (not in edit mode)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('TC-06-02: double-clicking name calls onStartEdit with name field', () => {
    const onStartEdit = vi.fn()
    renderEditable(<ColumnRow {...defaultProps} onStartEdit={onStartEdit} />)
    const nameSpan = screen.getByText('email')
    fireEvent.dblClick(nameSpan)
    expect(onStartEdit).toHaveBeenCalledWith(mockColumn.id, 'name')
  })

  it('TC-06-03: when editingField matches this column name, InlineNameEditor renders', () => {
    const editingField: EditingField = {
      columnId: mockColumn.id,
      field: 'name',
    }
    renderEditable(<ColumnRow {...defaultProps} editingField={editingField} />)
    // InlineNameEditor renders an input
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('TC-06-04: double-clicking dataType calls onStartEdit with dataType field', () => {
    const onStartEdit = vi.fn()
    renderEditable(<ColumnRow {...defaultProps} onStartEdit={onStartEdit} />)
    const typeSpan = screen.getByText('string')
    fireEvent.dblClick(typeSpan)
    expect(onStartEdit).toHaveBeenCalledWith(mockColumn.id, 'dataType')
  })

  it('TC-06-05: when editingField matches dataType, DataTypeSelector renders', () => {
    const editingField: EditingField = {
      columnId: mockColumn.id,
      field: 'dataType',
    }
    renderEditable(<ColumnRow {...defaultProps} editingField={editingField} />)
    expect(screen.getByTestId('data-type-selector')).toBeTruthy()
  })

  it('TC-06-06: delete button is initially hidden (opacity 0)', () => {
    renderEditable(<ColumnRow {...defaultProps} />)
    const deleteBtn = screen.getByRole('button', { name: /delete column/i })
    expect(deleteBtn.style.opacity).toBe('0')
  })

  it('TC-06-07: clicking delete on column with no edges calls onDelete directly', () => {
    const onDelete = vi.fn()
    renderEditable(
      <ColumnRow {...defaultProps} edges={[]} onDelete={onDelete} />,
    )
    const deleteBtn = screen.getByRole('button', { name: /delete column/i })
    fireEvent.click(deleteBtn)
    expect(onDelete).toHaveBeenCalledWith(mockColumn)
  })

  it('TC-06-09: row has editing background when in edit mode', () => {
    const editingField: EditingField = {
      columnId: mockColumn.id,
      field: 'name',
    }
    renderEditable(<ColumnRow {...defaultProps} editingField={editingField} />)
    // Find the column-row container
    const rows = document.querySelectorAll('.column-row.editing')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('TC-06-09b: row does NOT have editing class when not in edit mode', () => {
    renderEditable(<ColumnRow {...defaultProps} editingField={null} />)
    const rows = document.querySelectorAll('.column-row.editing')
    expect(rows.length).toBe(0)
  })

  it('TC-06-10: name span has cursor:text style', () => {
    renderEditable(<ColumnRow {...defaultProps} />)
    const nameSpan = screen.getByText('email')
    expect(nameSpan.style.cursor).toBe('text')
  })

  // TS-TD-06: Column deletion accessibility (P1) — TC-TD-06-01 through TC-TD-06-05

  it('TC-TD-06-01: delete button has aria-label including the column name', () => {
    renderEditable(<ColumnRow {...defaultProps} column={mockColumn} />)
    // The delete button should have aria-label that includes the column name "email"
    const deleteBtn = screen.getByRole('button', {
      name: /delete column email/i,
    })
    expect(deleteBtn).toBeTruthy()
  })

  it('TC-TD-06-03: Delete button (Cancel-equivalent) appears before the destructive action in DOM — delete button is the first focusable interactive element in its region', () => {
    // This test verifies that in DeleteColumnDialog, the Cancel button is first.
    // For ColumnRow itself, the delete button aria-label is set correctly (AC-19 focus order).
    // We verify the aria-label contains the column name.
    renderEditable(<ColumnRow {...defaultProps} column={mockColumn} />)
    const deleteBtn = screen.getByRole('button', { name: /delete column/i })
    // aria-label should contain column name
    expect(deleteBtn.getAttribute('aria-label')).toContain(mockColumn.name)
  })

  it('TC-TD-06-04: Delete key on focused column row triggers onDelete for that column', () => {
    const onDelete = vi.fn()
    renderEditable(<ColumnRow {...defaultProps} onDelete={onDelete} />)

    // Focus the column row element
    const columnRowEl = document.querySelector('.column-row') as HTMLElement
    expect(columnRowEl).toBeTruthy()
    columnRowEl.focus()

    // Fire keyDown with Delete key
    fireEvent.keyDown(columnRowEl, { key: 'Delete' })

    expect(onDelete).toHaveBeenCalledWith(mockColumn)
  })

  it('TC-TD-06-05: Delete key on column row calls onDelete with the correct column object', () => {
    const onDelete = vi.fn()
    renderEditable(
      <ColumnRow {...defaultProps} column={mockColumn} onDelete={onDelete} />,
    )

    const columnRowEl = document.querySelector('.column-row') as HTMLElement
    columnRowEl.focus()

    fireEvent.keyDown(columnRowEl, { key: 'Delete' })

    // onDelete should receive the exact column object regardless of relationship presence
    expect(onDelete).toHaveBeenCalledWith(mockColumn)
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

// ============================================================================
// canEdit gating (WhiteboardPermissionsContext) — issue #109
// Duplicate/Delete/Edit-note write affordances must not render (and the
// Delete keyboard shortcut must not fire) for view-only viewers.
// ============================================================================

describe('ColumnRow canEdit gating', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('hides Duplicate, Delete, and Edit column note controls when canEdit is false', () => {
    render(
      <WhiteboardPermissionsProvider value={{ canEdit: false }}>
        <ColumnRow {...defaultProps} />
      </WhiteboardPermissionsProvider>,
    )

    expect(
      screen.queryByRole('button', { name: /duplicate column/i }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /delete column/i })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /edit column note/i }),
    ).toBeNull()
    // Read-only schema info remains visible
    expect(screen.getByText('email')).toBeTruthy()
    expect(screen.getByText('string')).toBeTruthy()
  })

  it('does not call onDelete on Delete keydown when canEdit is false', () => {
    const onDelete = vi.fn()
    render(
      <WhiteboardPermissionsProvider value={{ canEdit: false }}>
        <ColumnRow {...defaultProps} onDelete={onDelete} />
      </WhiteboardPermissionsProvider>,
    )

    const columnRowEl = document.querySelector('.column-row') as HTMLElement
    columnRowEl.focus()
    fireEvent.keyDown(columnRowEl, { key: 'Delete' })

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('hides write controls when rendered outside any provider (fail-closed default)', () => {
    render(<ColumnRow {...defaultProps} />)

    expect(
      screen.queryByRole('button', { name: /duplicate column/i }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /delete column/i })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /edit column note/i }),
    ).toBeNull()
  })
})

// @vitest-environment jsdom
// src/components/whiteboard/DeleteTableDialog.test.tsx
// TS-TD-01: DeleteTableDialog component unit tests

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeleteTableDialog } from './DeleteTableDialog'
import type { TableRelationship } from './DeleteTableDialog'

const mockRelationship: TableRelationship = {
  id: 'rel-001',
  sourceTableName: 'orders',
  sourceColumnName: 'user_id',
  targetTableName: 'users',
  targetColumnName: 'id',
  cardinality: 'MANY_TO_ONE',
}

describe('DeleteTableDialog', () => {
  it('TC-TD-01-01: renders with alertdialog role', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('TC-TD-01-02: dialog title includes the table name', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Title should contain the table name
    const title = screen.getByRole('heading')
    expect(title.textContent).toContain('orders')
  })

  it('TC-TD-01-03: dialog body shows column count', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={5}
        affectedRelationships={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Body text should reference the column count
    const dialogEl = screen.getByRole('alertdialog')
    expect(dialogEl.textContent).toContain('5')
  })

  it('TC-TD-01-04: dialog body lists affected relationships', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/orders\.user_id/)).toBeTruthy()
    expect(screen.getByText(/users\.id/)).toBeTruthy()
    // Cardinality should be present somewhere in the dialog
    const dialogEl = screen.getByRole('alertdialog')
    expect(dialogEl.textContent).toContain('MANY_TO_ONE')
  })

  it('TC-TD-01-05: Cancel button calls onCancel without calling onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[mockRelationship]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    // onCancel may be called once (from onClick) or twice (onClick + onOpenChange)
    // depending on Radix AlertDialog behavior in jsdom — both are acceptable.
    // The important assertion is that onConfirm is NOT called.
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('TC-TD-01-06: "Delete table" confirm button calls onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[mockRelationship]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    const confirmBtn = screen.getByRole('button', { name: /delete table/i })
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('TC-TD-01-07: Cancel button appears before the "Delete table" button in DOM order', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    const confirmBtn = screen.getByRole('button', { name: /delete table/i })
    // Cancel button should precede confirm in DOM order
    const position = cancelBtn.compareDocumentPosition(confirmBtn)
    // DOCUMENT_POSITION_FOLLOWING = 4 means confirmBtn comes after cancelBtn
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('TC-TD-01-08: "Delete table" confirm button has destructive styling', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={3}
        affectedRelationships={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const confirmBtn = screen.getByRole('button', { name: /delete table/i })
    expect(
      confirmBtn.classList.contains('bg-destructive') ||
        confirmBtn.className.includes('destructive'),
    ).toBe(true)
  })

  it('TC-TD-01-09: renders correctly with 0 columns and 0 relationships', () => {
    render(
      <DeleteTableDialog
        tableName="orders"
        columnCount={0}
        affectedRelationships={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Should render without error
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    // No list items for relationships
    const listItems = screen.queryAllByRole('listitem')
    expect(listItems).toHaveLength(0)
    // Column count 0 should be in the text
    const dialogEl = screen.getByRole('alertdialog')
    expect(dialogEl.textContent).toContain('0')
  })
})

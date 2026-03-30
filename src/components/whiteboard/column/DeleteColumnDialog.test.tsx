// @vitest-environment jsdom
// src/components/whiteboard/column/DeleteColumnDialog.test.tsx
// TS-05: DeleteColumnDialog unit tests

import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteColumnDialog } from './DeleteColumnDialog'
import { mockColumn, mockFKColumn } from '@/test/fixtures'
import type { ColumnRelationship } from './types'

const mockRelationship: ColumnRelationship = {
  id: 'rel-001',
  sourceTableName: 'orders',
  sourceColumnName: 'user_id',
  targetTableName: 'users',
  targetColumnName: 'id',
  cardinality: 'MANY_TO_ONE',
}

describe('DeleteColumnDialog', () => {
  it('TC-05-01: renders as AlertDialog with accessible roles', () => {
    render(
      <DeleteColumnDialog
        column={mockColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // AlertDialog renders with alertdialog role
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('TC-05-02: lists affected relationship names in dialog body', () => {
    render(
      <DeleteColumnDialog
        column={mockColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/orders\.user_id/)).toBeTruthy()
    expect(screen.getByText(/users\.id/)).toBeTruthy()
  })

  it('TC-05-03: shows FK-specific warning when column is a FK', () => {
    render(
      <DeleteColumnDialog
        column={mockFKColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/foreign key/i)).toBeTruthy()
  })

  it('TC-05-03b: does NOT show FK warning for non-FK column', () => {
    render(
      <DeleteColumnDialog
        column={mockColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Warning about FK breakage should not appear for non-FK column
    expect(screen.queryByText(/foreign key/i)).toBeNull()
  })

  it('TC-05-04: confirm button calls onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteColumnDialog
        column={mockColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    const confirmBtn = screen.getByRole('button', { name: /delete column/i })
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalled()
  })

  it('TC-05-05: cancel button calls onCancel without calling onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DeleteColumnDialog
        column={mockColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('TC-05-06: confirm button has destructive styling class', () => {
    render(
      <DeleteColumnDialog
        column={mockColumn}
        affectedRelationships={[mockRelationship]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const confirmBtn = screen.getByRole('button', { name: /delete column/i })
    expect(
      confirmBtn.classList.contains('bg-destructive') ||
        confirmBtn.className.includes('destructive'),
    ).toBe(true)
  })
})

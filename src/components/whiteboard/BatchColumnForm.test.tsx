// @vitest-environment jsdom
// src/components/whiteboard/BatchColumnForm.test.tsx
// Suite 9 — Component: Batch UX Contract (SEC-BATCH-UX-05)
// TC-BUX-01..05

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BatchColumnForm } from './BatchColumnForm'
import type { BatchColumnFormProps } from './BatchColumnForm'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeBatchDeniedError() {
  const err = new Error(
    'This batch could not be saved. One or more items target a resource you no longer have access to.',
  ) as Error & { errorCode: string }
  err.errorCode = 'BATCH_DENIED'
  return err
}

function renderForm(overrides: Partial<BatchColumnFormProps> = {}) {
  const defaultProps: BatchColumnFormProps = {
    tableId: 'tbl-001',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides,
  }
  const result = render(<BatchColumnForm {...defaultProps} />)
  return { ...result, props: defaultProps }
}

function fillRowName(index: number, value: string) {
  const inputs = screen.getAllByRole('textbox')
  fireEvent.change(inputs[index], { target: { value } })
}

// ─────────────────────────────────────────────────────────────────────────────
// TC-BUX-01: Batch form retains input after BATCH_DENIED response
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-BUX-01: Batch form retains input after BATCH_DENIED', () => {
  it('preserves all row values after BATCH_DENIED is thrown', async () => {
    const onSubmit = vi.fn().mockRejectedValue(makeBatchDeniedError())

    renderForm({
      tableId: 'tbl-001',
      onSubmit,
      initialRows: [
        { name: 'col_a', dataType: 'string' },
        { name: 'col_b', dataType: 'int' },
        { name: 'col_c', dataType: 'uuid' },
      ],
    })

    // Verify all 3 inputs are pre-filled
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs).toHaveLength(3)
    expect(inputs[0].value).toBe('col_a')
    expect(inputs[1].value).toBe('col_b')
    expect(inputs[2].value).toBe('col_c')

    // Submit the form
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /batch column creation/i }))
    })

    // Wait for async rejection to settle
    await act(async () => {})

    // Input values must be preserved — no clear/reset
    const inputsAfter = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputsAfter).toHaveLength(3)
    expect(inputsAfter[0].value).toBe('col_a')
    expect(inputsAfter[1].value).toBe('col_b')
    expect(inputsAfter[2].value).toBe('col_c')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-BUX-02: Error banner with SEC-BATCH-UX-02 canonical message appears
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-BUX-02: Denial banner with canonical message', () => {
  it('shows BATCH_DENIED banner text after submission failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(makeBatchDeniedError())

    renderForm({
      onSubmit,
      initialRows: [{ name: 'col_x', dataType: 'string' }],
    })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /batch column creation/i }))
    })

    await act(async () => {})

    // Banner must be visible
    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toMatch(/batch could not be saved/i)
    expect(alert.textContent).toMatch(/no longer have access/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-BUX-03: Bisection affordance is present in the DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-BUX-03: Bisection affordance present in DOM', () => {
  it('shows "Try first half" and "Try second half" buttons after BATCH_DENIED on multi-row batch', async () => {
    const onSubmit = vi.fn().mockRejectedValue(makeBatchDeniedError())

    renderForm({
      onSubmit,
      initialRows: [
        { name: 'col_1', dataType: 'string' },
        { name: 'col_2', dataType: 'int' },
      ],
    })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /batch column creation/i }))
    })

    await act(async () => {})

    // At least one bisection button must exist
    const firstHalfBtn = screen.getByRole('button', { name: /try first half/i })
    const secondHalfBtn = screen.getByRole('button', { name: /try second half/i })
    expect(firstHalfBtn).toBeTruthy()
    expect(secondHalfBtn).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-BUX-04: Bisection affordance is reachable via Tab key navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-BUX-04: Bisection affordance keyboard reachable', () => {
  it('bisection button can receive focus via Tab key after BATCH_DENIED', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(makeBatchDeniedError())

    renderForm({
      onSubmit,
      initialRows: [
        { name: 'col_1', dataType: 'string' },
        { name: 'col_2', dataType: 'int' },
      ],
    })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /batch column creation/i }))
    })

    await act(async () => {})

    // Get bisection button
    const firstHalfBtn = screen.getByRole('button', { name: /try first half/i })
    expect(firstHalfBtn).toBeTruthy()

    // Tab through the form until the bisection button gets focus
    // We check by focusing the body first then tabbing
    document.body.focus()

    // Tab enough times to reach the bisection button (it's early in tab order, inside the alert)
    let reached = false
    for (let i = 0; i < 20; i++) {
      await user.tab()
      if (document.activeElement === firstHalfBtn) {
        reached = true
        break
      }
    }

    expect(reached).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-BUX-05: Error banner has role="alert" for screen readers
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-BUX-05: Banner has role="alert" for accessibility', () => {
  it('denial banner has role="alert" attribute', async () => {
    const onSubmit = vi.fn().mockRejectedValue(makeBatchDeniedError())

    renderForm({
      onSubmit,
      initialRows: [{ name: 'col_a', dataType: 'string' }],
    })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /batch column creation/i }))
    })

    await act(async () => {})

    // getByRole('alert') asserts role="alert" exists
    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(
      alert.getAttribute('role') === 'alert' ||
        alert.getAttribute('aria-live') === 'assertive',
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: row management (add/remove)
// ─────────────────────────────────────────────────────────────────────────────

describe('BatchColumnForm: row management', () => {
  it('renders one empty row by default', () => {
    renderForm()
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].value).toBe('')
  })

  it('adds a new row when "Add row" is clicked', async () => {
    renderForm()
    const addBtn = screen.getByRole('button', { name: /add column row/i })
    fireEvent.click(addBtn)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(2)
  })

  it('removes a row when "×" is clicked', async () => {
    renderForm({
      initialRows: [
        { name: 'col_1', dataType: 'string' },
        { name: 'col_2', dataType: 'int' },
      ],
    })
    const removeButtons = screen.getAllByRole('button', { name: /remove column/i })
    fireEvent.click(removeButtons[0])
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].value).toBe('col_2')
  })

  it('calls onSubmit with non-empty rows on form submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    renderForm({
      tableId: 'tbl-test',
      onSubmit,
      initialRows: [
        { name: 'id', dataType: 'uuid' },
        { name: '', dataType: 'string' }, // empty — should be filtered
      ],
    })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /batch column creation/i }))
    })

    await act(async () => {})

    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ tableId: 'tbl-test', name: 'id', dataType: 'uuid' }),
    ])
  })
})

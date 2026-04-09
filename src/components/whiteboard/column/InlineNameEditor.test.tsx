// @vitest-environment jsdom
// src/components/whiteboard/column/InlineNameEditor.test.tsx
// TS-02: InlineNameEditor unit tests

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InlineNameEditor } from './InlineNameEditor'

describe('InlineNameEditor', () => {
  it('TC-02-01: auto-focuses the input on mount', () => {
    render(
      <InlineNameEditor
        value="test_col"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox')
    expect(document.activeElement).toBe(input)
  })

  it('TC-02-02: pre-fills with the current column name value', () => {
    render(
      <InlineNameEditor
        value="my_column"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox')
    expect(input.value).toBe('my_column')
  })

  it('TC-02-03: pressing Enter commits with the new value', () => {
    const onCommit = vi.fn()
    render(
      <InlineNameEditor
        value="old_name"
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new_name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('new_name')
  })

  it('TC-02-04: pressing Escape calls onCancel without committing', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineNameEditor
        value="old_name"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    )
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('TC-02-05: blurring with a valid non-empty value commits', () => {
    const onCommit = vi.fn()
    render(
      <InlineNameEditor
        value="my_col"
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new_col' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('new_col')
  })

  it('TC-02-06: pressing Enter with empty value does NOT call onCommit', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <InlineNameEditor
        value="old_name"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    // onCancel should be called instead
    expect(onCancel).toHaveBeenCalled()
  })

  it('TC-02-07: blurring with empty value calls onCancel', () => {
    const onCancel = vi.fn()
    render(
      <InlineNameEditor
        value="some_col"
        onCommit={vi.fn()}
        onCancel={onCancel}
      />,
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onCancel).toHaveBeenCalled()
  })

  it('TC-02-08: applies nodrag and nowheel classes', () => {
    render(
      <InlineNameEditor value="col" onCommit={vi.fn()} onCancel={vi.fn()} />,
    )
    const input = screen.getByRole('textbox')
    expect(input.classList.contains('nodrag')).toBe(true)
    expect(input.classList.contains('nowheel')).toBe(true)
  })
})

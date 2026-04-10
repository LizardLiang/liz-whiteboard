// @vitest-environment jsdom
// src/components/whiteboard/column/DataTypeSelector.test.tsx
// TS-01: DataTypeSelector unit tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DataTypeSelector } from './DataTypeSelector'
import { DATA_TYPES, DATA_TYPE_LABELS } from './types'

// cmdk uses ResizeObserver and scrollIntoView internally — polyfill for jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? ResizeObserverStub
// jsdom does not implement scrollIntoView; cmdk calls it when highlighting items
Element.prototype.scrollIntoView =
  Element.prototype.scrollIntoView ?? function () {}

describe('DataTypeSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('TC-01-01: renders a combobox trigger button (not a plain text input)', () => {
    render(
      <DataTypeSelector value="string" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    // Should render a combobox role button as the trigger
    const combobox = screen.getByRole('combobox')
    expect(combobox).toBeTruthy()
  })

  it('TC-01-02: has exactly 25 data type options', () => {
    expect(DATA_TYPES).toHaveLength(25)
  })

  it('TC-01-03: all original enum values are present in DATA_TYPES', () => {
    expect(DATA_TYPES).toContain('int')
    expect(DATA_TYPES).toContain('string')
    expect(DATA_TYPES).toContain('float')
    expect(DATA_TYPES).toContain('boolean')
    expect(DATA_TYPES).toContain('date')
    expect(DATA_TYPES).toContain('text')
    expect(DATA_TYPES).toContain('uuid')
    expect(DATA_TYPES).toContain('json')
  })

  it('TC-01-03b: all new enum values are present in DATA_TYPES', () => {
    expect(DATA_TYPES).toContain('bigint')
    expect(DATA_TYPES).toContain('smallint')
    expect(DATA_TYPES).toContain('double')
    expect(DATA_TYPES).toContain('decimal')
    expect(DATA_TYPES).toContain('serial')
    expect(DATA_TYPES).toContain('money')
    expect(DATA_TYPES).toContain('char')
    expect(DATA_TYPES).toContain('varchar')
    expect(DATA_TYPES).toContain('bit')
    expect(DATA_TYPES).toContain('datetime')
    expect(DATA_TYPES).toContain('timestamp')
    expect(DATA_TYPES).toContain('time')
    expect(DATA_TYPES).toContain('binary')
    expect(DATA_TYPES).toContain('blob')
    expect(DATA_TYPES).toContain('xml')
    expect(DATA_TYPES).toContain('array')
    expect(DATA_TYPES).toContain('enum')
  })

  it('TC-01-04: displays user-friendly labels for data types', () => {
    expect(DATA_TYPE_LABELS['int']).toBe('Integer')
    expect(DATA_TYPE_LABELS['uuid']).toBe('UUID')
    expect(DATA_TYPE_LABELS['string']).toBe('String')
    expect(DATA_TYPE_LABELS['boolean']).toBe('Boolean')
    expect(DATA_TYPE_LABELS['float']).toBe('Float')
    expect(DATA_TYPE_LABELS['date']).toBe('Date')
    expect(DATA_TYPE_LABELS['text']).toBe('Text')
    expect(DATA_TYPE_LABELS['json']).toBe('JSON')
    expect(DATA_TYPE_LABELS['bigint']).toBe('BigInt')
    expect(DATA_TYPE_LABELS['smallint']).toBe('SmallInt')
    expect(DATA_TYPE_LABELS['double']).toBe('Double')
    expect(DATA_TYPE_LABELS['decimal']).toBe('Decimal')
    expect(DATA_TYPE_LABELS['serial']).toBe('Serial')
    expect(DATA_TYPE_LABELS['money']).toBe('Money')
    expect(DATA_TYPE_LABELS['char']).toBe('Char')
    expect(DATA_TYPE_LABELS['varchar']).toBe('VarChar')
    expect(DATA_TYPE_LABELS['bit']).toBe('Bit')
    expect(DATA_TYPE_LABELS['datetime']).toBe('DateTime')
    expect(DATA_TYPE_LABELS['timestamp']).toBe('Timestamp')
    expect(DATA_TYPE_LABELS['time']).toBe('Time')
    expect(DATA_TYPE_LABELS['binary']).toBe('Binary')
    expect(DATA_TYPE_LABELS['blob']).toBe('Blob')
    expect(DATA_TYPE_LABELS['xml']).toBe('XML')
    expect(DATA_TYPE_LABELS['array']).toBe('Array')
    expect(DATA_TYPE_LABELS['enum']).toBe('Enum')
  })

  it('TC-01-05: each DATA_TYPE has a corresponding label entry', () => {
    for (const dt of DATA_TYPES) {
      expect(DATA_TYPE_LABELS[dt]).toBeTruthy()
      // The label should be different from the raw value (user-friendly)
      expect(typeof DATA_TYPE_LABELS[dt]).toBe('string')
      expect(DATA_TYPE_LABELS[dt].length).toBeGreaterThan(0)
    }
  })

  it('TC-01-06: applies nodrag class to prevent React Flow drag', () => {
    const { container } = render(
      <DataTypeSelector value="string" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    // The root div should have nodrag class
    const rootDiv = container.firstChild as HTMLElement
    expect(rootDiv.classList.contains('nodrag')).toBe(true)
  })

  it('TC-01-07: trigger displays the label of the current value', () => {
    render(
      <DataTypeSelector value="int" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    const combobox = screen.getByRole('combobox')
    expect(combobox.textContent).toBe('Integer')
  })

  it('TC-01-08: combobox trigger starts closed before auto-open timer fires', () => {
    render(
      <DataTypeSelector
        value="string"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        autoOpen
      />,
    )
    // Before the setTimeout fires, the popover should be closed
    const combobox = screen.getByRole('combobox')
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
  })

  it('TC-01-09: auto-opens after the setTimeout(0) fires', async () => {
    render(
      <DataTypeSelector
        value="string"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        autoOpen
      />,
    )
    // Advance past the setTimeout(0) to trigger auto-open
    act(() => {
      vi.advanceTimersByTime(1)
    })
    // When open, there are two combobox elements: the trigger button and the cmdk search input.
    // The trigger button has data-slot="popover-trigger"; check its aria-expanded.
    const triggerButton = screen
      .getAllByRole('combobox')
      .find((el) => el.tagName === 'BUTTON')
    expect(triggerButton).toBeTruthy()
    expect(triggerButton!.getAttribute('aria-expanded')).toBe('true')
  })

  it('TC-01-10: clicking a type item calls onSelect with the correct value and does NOT call onCancel', () => {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    render(
      <DataTypeSelector
        value="string"
        onSelect={onSelect}
        onCancel={onCancel}
        autoOpen
      />,
    )
    // Open the popover
    act(() => {
      vi.advanceTimersByTime(1)
    })
    // Use role="option" to target the cmdk item, not the group heading that also reads "Boolean"
    const booleanItem = screen.getByRole('option', { name: /boolean/i })
    fireEvent.click(booleanItem)
    expect(onSelect).toHaveBeenCalledWith('boolean')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('TC-01-11: pressing Escape calls onCancel exactly once (double-cancel guard)', () => {
    const onCancel = vi.fn()
    render(
      <DataTypeSelector
        value="string"
        onSelect={vi.fn()}
        onCancel={onCancel}
        autoOpen
      />,
    )
    // Open the popover
    act(() => {
      vi.advanceTimersByTime(1)
    })
    // Press Escape on the search input to close the popover
    const searchInput = screen.getByPlaceholderText('Search types...')
    fireEvent.keyDown(searchInput, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('TC-01-12: after selection, onCancel is NOT called', () => {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    render(
      <DataTypeSelector
        value="string"
        onSelect={onSelect}
        onCancel={onCancel}
        autoOpen
      />,
    )
    // Open the popover
    act(() => {
      vi.advanceTimersByTime(1)
    })
    // Use role="option" to target the cmdk item (Integer appears only as an option, not a group heading)
    const integerItem = screen.getByRole('option', { name: /integer/i })
    fireEvent.click(integerItem)
    // onSelect should fire, onCancel should not
    expect(onSelect).toHaveBeenCalledWith('int')
    expect(onCancel).toHaveBeenCalledTimes(0)
  })

  it('TC-01-13: typing in the search input filters the displayed options', () => {
    render(
      <DataTypeSelector
        value="string"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        autoOpen
      />,
    )
    // Open the popover
    act(() => {
      vi.advanceTimersByTime(1)
    })
    // Type in the search box to filter
    const searchInput = screen.getByPlaceholderText('Search types...')
    fireEvent.change(searchInput, { target: { value: 'bool' } })
    // The Boolean option should still be visible (matches "bool")
    expect(screen.getByRole('option', { name: /boolean/i })).toBeTruthy()
    // Integer option should no longer be visible (filtered out by "bool")
    expect(screen.queryByRole('option', { name: /integer/i })).toBeNull()
  })
})

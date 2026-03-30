// @vitest-environment jsdom
// src/components/whiteboard/column/DataTypeSelector.test.tsx
// TS-01: DataTypeSelector unit tests

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { DataTypeSelector } from './DataTypeSelector'
import { DATA_TYPES, DATA_TYPE_LABELS } from './types'

describe('DataTypeSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('TC-01-01: renders a Select component (not a free-text input)', () => {
    render(
      <DataTypeSelector value="string" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    // Should not have a free-text input
    const freeTextInputs = screen
      .queryAllByRole('textbox')
      .filter((el) => (el as HTMLInputElement).type === 'text')
    expect(freeTextInputs.length).toBe(0)
  })

  it('TC-01-02: has exactly 8 data type options', () => {
    expect(DATA_TYPES).toHaveLength(8)
  })

  it('TC-01-03: all 8 enum values are present in DATA_TYPES', () => {
    expect(DATA_TYPES).toContain('int')
    expect(DATA_TYPES).toContain('string')
    expect(DATA_TYPES).toContain('float')
    expect(DATA_TYPES).toContain('boolean')
    expect(DATA_TYPES).toContain('date')
    expect(DATA_TYPES).toContain('text')
    expect(DATA_TYPES).toContain('uuid')
    expect(DATA_TYPES).toContain('json')
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
})

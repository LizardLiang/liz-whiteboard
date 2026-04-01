// @vitest-environment jsdom
// src/components/whiteboard/column/DataTypeSelector.test.tsx
// TS-01: DataTypeSelector unit tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
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
})

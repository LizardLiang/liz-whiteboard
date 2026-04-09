// src/components/whiteboard/Toolbar.test.tsx
// Unit tests for the CARDINALITIES array in Toolbar.tsx

import { describe, expect, it } from 'vitest'
import { CARDINALITIES } from './Toolbar'

describe('CARDINALITIES', () => {
  it('has exactly 17 entries', () => {
    expect(CARDINALITIES).toHaveLength(17)
  })

  it('contains all 7 cardinality values', () => {
    const values = CARDINALITIES.map((c) => c.value)
    expect(values).toContain('ONE_TO_ONE')
    expect(values).toContain('ONE_TO_MANY')
    expect(values).toContain('MANY_TO_ONE')
    expect(values).toContain('MANY_TO_MANY')
    expect(values).toContain('ZERO_TO_ONE')
    expect(values).toContain('ZERO_TO_MANY')
    expect(values).toContain('SELF_REFERENCING')
  })

  it('has user-friendly label for ONE_TO_ONE', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ONE_TO_ONE')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
    expect(entry?.label.length).toBeGreaterThan(0)
  })

  it('has user-friendly label for ONE_TO_MANY', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ONE_TO_MANY')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for MANY_TO_ONE', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'MANY_TO_ONE')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for MANY_TO_MANY', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'MANY_TO_MANY')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for ZERO_TO_ONE', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_ONE')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for ZERO_TO_MANY', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_MANY')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for SELF_REFERENCING', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'SELF_REFERENCING')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('each entry has a non-empty value and label', () => {
    for (const entry of CARDINALITIES) {
      expect(entry.value).toBeTruthy()
      expect(entry.label).toBeTruthy()
    }
  })

  it('all values are unique', () => {
    const values = CARDINALITIES.map((c) => c.value)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(CARDINALITIES.length)
  })

  it('ZERO_TO_ONE label contains "0" or "Zero"', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_ONE')
    expect(
      entry?.label.includes('0') || entry?.label.toLowerCase().includes('zero'),
    ).toBe(true)
  })

  it('ZERO_TO_MANY label contains "0" or "Zero"', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_MANY')
    expect(
      entry?.label.includes('0') || entry?.label.toLowerCase().includes('zero'),
    ).toBe(true)
  })

  it('SELF_REFERENCING label is a non-empty string', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'SELF_REFERENCING')
    expect(entry?.label).toBeTruthy()
    expect(typeof entry?.label).toBe('string')
  })
})

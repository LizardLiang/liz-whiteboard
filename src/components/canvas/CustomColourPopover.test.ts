// src/components/canvas/CustomColourPopover.test.ts
// The stored-string <-> picker-field conversions.

import { describe, expect, it } from 'vitest'
import { formatCustomColour, parseCustomColour } from './CustomColourPopover'

describe('formatCustomColour', () => {
  it('writes lowercase #rrggbb at full opacity', () => {
    expect(formatCustomColour({ hex: '#12AB34', transparency: 0 })).toBe(
      '#12ab34',
    )
  })

  it('writes rgba with two decimals when transparent', () => {
    expect(formatCustomColour({ hex: '#12ab34', transparency: 40 })).toBe(
      'rgba(18, 171, 52, 0.60)',
    )
    expect(formatCustomColour({ hex: '#12ab34', transparency: 100 })).toBe(
      'rgba(18, 171, 52, 0.00)',
    )
  })

  it('rejects an invalid hex', () => {
    expect(formatCustomColour({ hex: '#12ab3', transparency: 0 })).toBeNull()
    expect(formatCustomColour({ hex: 'red', transparency: 0 })).toBeNull()
  })
})

describe('parseCustomColour', () => {
  it('reads hex and rgba values', () => {
    expect(parseCustomColour('#12ab34')).toEqual({
      hex: '#12ab34',
      transparency: 0,
    })
    expect(parseCustomColour('rgba(18, 171, 52, 0.60)')).toEqual({
      hex: '#12ab34',
      transparency: 40,
    })
  })

  it('opens an unparseable or missing value on opaque slate', () => {
    const slate = { hex: '#696e77', transparency: 0 }
    expect(parseCustomColour('banana')).toEqual(slate)
    expect(parseCustomColour(null)).toEqual(slate)
  })

  it('round-trips what it formats', () => {
    const value = 'rgba(18, 171, 52, 0.25)'
    expect(formatCustomColour(parseCustomColour(value))).toBe(value)
  })
})

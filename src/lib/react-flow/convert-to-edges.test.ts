// src/lib/react-flow/convert-to-edges.test.ts
// Unit tests for getCardinalityMarkerStart and getCardinalityMarkerEnd

import { describe, expect, it } from 'vitest'
import {
  getCardinalityMarkerEnd,
  getCardinalityMarkerStart,
} from './convert-to-edges'
import type { Cardinality } from '@prisma/client'

describe('getCardinalityMarkerStart', () => {
  it('returns correct marker ID for ONE_TO_ONE', () => {
    expect(getCardinalityMarkerStart('ONE_TO_ONE')).toBe(
      'url(#cardinality-one-left)',
    )
  })

  it('returns correct marker ID for ONE_TO_MANY', () => {
    expect(getCardinalityMarkerStart('ONE_TO_MANY')).toBe(
      'url(#cardinality-one-left)',
    )
  })

  it('returns correct marker ID for MANY_TO_ONE', () => {
    expect(getCardinalityMarkerStart('MANY_TO_ONE')).toBe(
      'url(#cardinality-many-left)',
    )
  })

  it('returns correct marker ID for MANY_TO_MANY', () => {
    expect(getCardinalityMarkerStart('MANY_TO_MANY')).toBe(
      'url(#cardinality-many-left)',
    )
  })

  it('returns correct marker ID for ZERO_TO_ONE', () => {
    expect(getCardinalityMarkerStart('ZERO_TO_ONE')).toBe(
      'url(#cardinality-zero-one-left)',
    )
  })

  it('returns correct marker ID for ZERO_TO_MANY', () => {
    expect(getCardinalityMarkerStart('ZERO_TO_MANY')).toBe(
      'url(#cardinality-zero-many-left)',
    )
  })

  it('returns correct marker ID for SELF_REFERENCING', () => {
    expect(getCardinalityMarkerStart('SELF_REFERENCING')).toBe(
      'url(#cardinality-one-left)',
    )
  })

  it('default fallback returns a valid marker ID (not undefined)', () => {
    // Cast to Cardinality to simulate an unknown value reaching the default branch
    const result = getCardinalityMarkerStart(
      'UNKNOWN' as unknown as Cardinality,
    )
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result.startsWith('url(#')).toBe(true)
  })
})

describe('getCardinalityMarkerEnd', () => {
  it('returns correct marker ID for ONE_TO_ONE', () => {
    expect(getCardinalityMarkerEnd('ONE_TO_ONE')).toBe(
      'url(#cardinality-one-right)',
    )
  })

  it('returns correct marker ID for ONE_TO_MANY', () => {
    expect(getCardinalityMarkerEnd('ONE_TO_MANY')).toBe(
      'url(#cardinality-many-right)',
    )
  })

  it('returns correct marker ID for MANY_TO_ONE', () => {
    expect(getCardinalityMarkerEnd('MANY_TO_ONE')).toBe(
      'url(#cardinality-one-right)',
    )
  })

  it('returns correct marker ID for MANY_TO_MANY', () => {
    expect(getCardinalityMarkerEnd('MANY_TO_MANY')).toBe(
      'url(#cardinality-many-right)',
    )
  })

  it('returns correct marker ID for ZERO_TO_ONE', () => {
    expect(getCardinalityMarkerEnd('ZERO_TO_ONE')).toBe(
      'url(#cardinality-one-right)',
    )
  })

  it('returns correct marker ID for ZERO_TO_MANY', () => {
    expect(getCardinalityMarkerEnd('ZERO_TO_MANY')).toBe(
      'url(#cardinality-many-right)',
    )
  })

  it('returns correct marker ID for SELF_REFERENCING', () => {
    expect(getCardinalityMarkerEnd('SELF_REFERENCING')).toBe(
      'url(#cardinality-many-right)',
    )
  })

  it('default fallback returns a valid marker ID (not undefined)', () => {
    const result = getCardinalityMarkerEnd('UNKNOWN' as unknown as Cardinality)
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result.startsWith('url(#')).toBe(true)
  })
})

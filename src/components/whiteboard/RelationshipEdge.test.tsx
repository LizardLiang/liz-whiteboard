// src/components/whiteboard/RelationshipEdge.test.tsx
// Unit tests for getCardinalityText in RelationshipEdge.tsx

import { describe, expect, it } from 'vitest'
import { getCardinalityText } from './RelationshipEdge'

describe('getCardinalityText', () => {
  it('returns {source: "1", target: "1"} for ONE_TO_ONE', () => {
    const result = getCardinalityText('ONE_TO_ONE')
    expect(result.source).toBe('1')
    expect(result.target).toBe('1')
  })

  it('returns {source: "1", target: "N"} for ONE_TO_MANY', () => {
    const result = getCardinalityText('ONE_TO_MANY')
    expect(result.source).toBe('1')
    expect(result.target).toBe('N')
  })

  it('returns {source: "N", target: "1"} for MANY_TO_ONE', () => {
    const result = getCardinalityText('MANY_TO_ONE')
    expect(result.source).toBe('N')
    expect(result.target).toBe('1')
  })

  it('returns {source: "N", target: "N"} for MANY_TO_MANY', () => {
    const result = getCardinalityText('MANY_TO_MANY')
    expect(result.source).toBe('N')
    expect(result.target).toBe('N')
  })

  it('returns {source: "0", target: "1"} for ZERO_TO_ONE', () => {
    const result = getCardinalityText('ZERO_TO_ONE')
    expect(result.source).toBe('0')
    expect(result.target).toBe('1')
  })

  it('returns {source: "0", target: "N"} for ZERO_TO_MANY', () => {
    const result = getCardinalityText('ZERO_TO_MANY')
    expect(result.source).toBe('0')
    expect(result.target).toBe('N')
  })

  it('returns {source: "1", target: "N"} for SELF_REFERENCING', () => {
    const result = getCardinalityText('SELF_REFERENCING')
    expect(result.source).toBe('1')
    expect(result.target).toBe('N')
  })
})

// src/data/schema.test.ts
// Unit tests for cardinalitySchema Zod enum

import { describe, expect, it } from 'vitest'
import { cardinalitySchema, createRelationshipSchema } from './schema'

describe('cardinalitySchema', () => {
  describe('accepted values', () => {
    const validCardinalities = [
      'ONE_TO_ONE',
      'ONE_TO_MANY',
      'MANY_TO_ONE',
      'MANY_TO_MANY',
      'ZERO_TO_ONE',
      'ZERO_TO_MANY',
      'SELF_REFERENCING',
    ] as const

    it('has exactly 17 accepted cardinality values', () => {
      expect(cardinalitySchema.options).toHaveLength(17)
    })

    it.each(validCardinalities)('accepts %s', (value) => {
      const result = cardinalitySchema.safeParse(value)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(value)
      }
    })
  })

  describe('rejected values', () => {
    it('rejects an unknown value', () => {
      const result = cardinalitySchema.safeParse('UNKNOWN_CARDINALITY')
      expect(result.success).toBe(false)
    })

    it('rejects an empty string', () => {
      const result = cardinalitySchema.safeParse('')
      expect(result.success).toBe(false)
    })

    it('rejects null', () => {
      const result = cardinalitySchema.safeParse(null)
      expect(result.success).toBe(false)
    })

    it('rejects a lowercase version of a valid value', () => {
      const result = cardinalitySchema.safeParse('one_to_one')
      expect(result.success).toBe(false)
    })
  })

  describe('createRelationshipSchema cardinality field', () => {
    const baseRelationship = {
      whiteboardId: 'e618f6da-effb-4209-a0fa-d5c12a616b7b',
      sourceTableId: '1cd904f5-e4ff-4157-85c7-e2ec623ca0a8',
      targetTableId: 'fd7e50e2-2c7a-4eb2-8a3e-7bc23fd297e8',
      sourceColumnId: '7be1fefe-592b-4611-99ad-1e499c868a60',
      targetColumnId: '7df351d0-928c-491a-8cf4-64d6ca976f02',
    }

    it('accepts ZERO_TO_ONE in createRelationshipSchema', () => {
      const result = createRelationshipSchema.safeParse({
        ...baseRelationship,
        cardinality: 'ZERO_TO_ONE',
      })
      expect(result.success).toBe(true)
    })

    it('accepts ZERO_TO_MANY in createRelationshipSchema', () => {
      const result = createRelationshipSchema.safeParse({
        ...baseRelationship,
        cardinality: 'ZERO_TO_MANY',
      })
      expect(result.success).toBe(true)
    })

    it('accepts SELF_REFERENCING in createRelationshipSchema', () => {
      const result = createRelationshipSchema.safeParse({
        ...baseRelationship,
        cardinality: 'SELF_REFERENCING',
      })
      expect(result.success).toBe(true)
    })

    it('rejects unknown cardinality in createRelationshipSchema', () => {
      const result = createRelationshipSchema.safeParse({
        ...baseRelationship,
        cardinality: 'FIVE_TO_THREE',
      })
      expect(result.success).toBe(false)
    })
  })
})

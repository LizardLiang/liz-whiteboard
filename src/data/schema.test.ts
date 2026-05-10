// src/data/schema.test.ts
// Unit tests for cardinalitySchema Zod enum + auth schemas (TC-P1-01 through TC-P1-04)

import { describe, expect, it } from 'vitest'
import {
  cardinalitySchema,
  createRelationshipSchema,
  loginInputSchema,
  projectRoleSchema,
  registerInputSchema,
  reorderColumnsSchema,
  tableMoveBulkBroadcastSchema,
} from './schema'

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

// ============================================================================
// Auth Schema Tests
// ============================================================================

describe('registerInputSchema', () => {
  // TC-P1-01: valid input accepted
  it('TC-P1-01: accepts valid registration input', () => {
    const result = registerInputSchema.safeParse({
      username: 'alice_01',
      email: 'alice@example.com',
      password: 'secure123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.username).toBe('alice_01')
      expect(result.data.email).toBe('alice@example.com')
      expect(result.data.password).toBe('secure123')
    }
  })

  // TC-P1-02: boundary and invalid inputs rejected
  describe('TC-P1-02: boundary and invalid inputs', () => {
    it('rejects username with 2 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'ab',
        email: 'a@b.com',
        password: 'pass1234',
      })
      expect(result.success).toBe(false)
    })

    it('rejects username with 51 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'a'.repeat(51),
        email: 'a@b.com',
        password: 'pass1234',
      })
      expect(result.success).toBe(false)
    })

    it('rejects username containing a space', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice bob',
        email: 'a@b.com',
        password: 'pass1234',
      })
      expect(result.success).toBe(false)
    })

    it('rejects username containing a hyphen', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice-bob',
        email: 'a@b.com',
        password: 'pass1234',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid email format', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice',
        email: 'notanemail',
        password: 'pass1234',
      })
      expect(result.success).toBe(false)
    })

    it('rejects password of 7 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice',
        email: 'a@b.com',
        password: 'short12',
      })
      expect(result.success).toBe(false)
    })

    it('rejects password of 129 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice',
        email: 'a@b.com',
        password: 'a'.repeat(129),
      })
      expect(result.success).toBe(false)
    })

    it('accepts password of exactly 8 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice',
        email: 'a@b.com',
        password: 'exactly8',
      })
      expect(result.success).toBe(true)
    })

    it('accepts password of exactly 128 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'alice',
        email: 'a@b.com',
        password: 'a'.repeat(128),
      })
      expect(result.success).toBe(true)
    })

    it('accepts username of exactly 3 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'abc',
        email: 'a@b.com',
        password: 'pass1234',
      })
      expect(result.success).toBe(true)
    })

    it('accepts username of exactly 50 characters', () => {
      const result = registerInputSchema.safeParse({
        username: 'a'.repeat(50),
        email: 'a@b.com',
        password: 'pass1234',
      })
      expect(result.success).toBe(true)
    })
  })
})

describe('loginInputSchema', () => {
  // TC-P1-03: valid and invalid inputs
  it('TC-P1-03: accepts valid login input', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.com',
      password: 'x',
      rememberMe: false,
    })
    expect(result.success).toBe(true)
  })

  it('TC-P1-03: rejects missing password', () => {
    const result = loginInputSchema.safeParse({ email: 'a@b.com' })
    expect(result.success).toBe(false)
  })

  it('TC-P1-03: rejects empty password', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.com',
      password: '',
    })
    expect(result.success).toBe(false)
  })

  it('TC-P1-03: rememberMe defaults to false when absent', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.com',
      password: 'pass',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rememberMe).toBe(false)
    }
  })
})

describe('projectRoleSchema', () => {
  // TC-P1-04: projectRoleSchema values
  it('TC-P1-04: accepts VIEWER', () => {
    expect(projectRoleSchema.safeParse('VIEWER').success).toBe(true)
  })

  it('TC-P1-04: accepts EDITOR', () => {
    expect(projectRoleSchema.safeParse('EDITOR').success).toBe(true)
  })

  it('TC-P1-04: accepts ADMIN', () => {
    expect(projectRoleSchema.safeParse('ADMIN').success).toBe(true)
  })

  it('TC-P1-04: rejects OWNER (not a stored role)', () => {
    expect(projectRoleSchema.safeParse('OWNER').success).toBe(false)
  })

  it('TC-P1-04: rejects lowercase viewer (case-sensitive)', () => {
    expect(projectRoleSchema.safeParse('viewer').success).toBe(false)
  })
})

// Suite S1: reorderColumnsSchema (UT-01 through UT-06)
describe('reorderColumnsSchema', () => {
  // Use standard v4 UUID format (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
  const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
  const anotherUuid = '550e8400-e29b-41d4-a716-446655440000'

  it('UT-01: valid schema parses correctly', () => {
    const result = reorderColumnsSchema.safeParse({
      tableId: validUuid,
      orderedColumnIds: [validUuid, anotherUuid],
    })
    expect(result.success).toBe(true)
  })

  it('UT-02: rejects non-UUID tableId', () => {
    const result = reorderColumnsSchema.safeParse({
      tableId: 'not-a-uuid',
      orderedColumnIds: [validUuid],
    })
    expect(result.success).toBe(false)
  })

  it('UT-03: rejects empty orderedColumnIds array', () => {
    const result = reorderColumnsSchema.safeParse({
      tableId: validUuid,
      orderedColumnIds: [],
    })
    expect(result.success).toBe(false)
  })

  it('UT-04: rejects non-UUID entries in orderedColumnIds', () => {
    const result = reorderColumnsSchema.safeParse({
      tableId: validUuid,
      orderedColumnIds: ['not-a-uuid'],
    })
    expect(result.success).toBe(false)
  })

  it('UT-05: accepts array of exactly 1 UUID', () => {
    const result = reorderColumnsSchema.safeParse({
      tableId: validUuid,
      orderedColumnIds: [validUuid],
    })
    expect(result.success).toBe(true)
  })

  it('UT-06: rejects array exceeding 500 entries', () => {
    // Use the same valid UUID 501 times (contents don't matter for the max-length check)
    const ids = Array.from({ length: 501 }, () => validUuid)
    const result = reorderColumnsSchema.safeParse({
      tableId: validUuid,
      orderedColumnIds: ids,
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// tableMoveBulkBroadcastSchema — B1 security validation tests
// TC-AL-C-B1-01 through TC-AL-C-B1-08
// ============================================================================

describe('tableMoveBulkBroadcastSchema (B1 socket payload validation)', () => {
  const validUserId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
  const validTableId = '550e8400-e29b-41d4-a716-446655440000'

  const validPayload = {
    userId: validUserId,
    positions: [{ tableId: validTableId, positionX: 100, positionY: 200 }],
  }

  it('TC-AL-C-B1-01: accepts a valid payload', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('TC-AL-C-B1-02: rejects NaN positionX', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse({
      ...validPayload,
      positions: [{ tableId: validTableId, positionX: NaN, positionY: 200 }],
    })
    expect(result.success).toBe(false)
  })

  it('TC-AL-C-B1-03: rejects string positionY', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse({
      ...validPayload,
      positions: [
        { tableId: validTableId, positionX: 100, positionY: 'string' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('TC-AL-C-B1-04: rejects Infinity in coordinates', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse({
      ...validPayload,
      positions: [{ tableId: validTableId, positionX: Infinity, positionY: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('TC-AL-C-B1-05: rejects non-UUID tableId in positions', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse({
      ...validPayload,
      positions: [{ tableId: 'not-a-uuid', positionX: 10, positionY: 20 }],
    })
    expect(result.success).toBe(false)
  })

  it('TC-AL-C-B1-06: rejects non-UUID userId', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse({
      ...validPayload,
      userId: 'attacker',
    })
    expect(result.success).toBe(false)
  })

  it('TC-AL-C-B1-07: rejects empty positions array', () => {
    const result = tableMoveBulkBroadcastSchema.safeParse({
      userId: validUserId,
      positions: [],
    })
    expect(result.success).toBe(false)
  })

  it('TC-AL-C-B1-08: rejects positions array exceeding 500 entries', () => {
    const manyPositions = Array.from({ length: 501 }, () => ({
      tableId: validTableId,
      positionX: 0,
      positionY: 0,
    }))
    const result = tableMoveBulkBroadcastSchema.safeParse({
      userId: validUserId,
      positions: manyPositions,
    })
    expect(result.success).toBe(false)
  })
})

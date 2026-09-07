// src/data/schema.test.ts
// Unit tests for cardinalitySchema Zod enum + auth schemas (TC-P1-01 through TC-P1-04)

import { describe, expect, it } from 'vitest'
import {
  MAX_BOARD_COORD,
  areaMoveBroadcastSchema,
  canvasElementPropsSchema,
  cardinalitySchema,
  createConnectorSchema,
  createRelationshipSchema,
  createShapeSchema,
  loginInputSchema,
  projectRoleSchema,
  registerInputSchema,
  reorderColumnsSchema,
  shapePropsSchema,
  tableMoveBulkBroadcastSchema,
  updateShapeSchema,
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

// ============================================================================
// areaMoveBroadcastSchema — area-atomic-move validation tests
// ============================================================================

describe('areaMoveBroadcastSchema (area:move socket payload validation)', () => {
  const validAreaId = 'a1c2e3d4-58cc-4372-a567-0e02b2c3d479'
  const validTableId = '550e8400-e29b-41d4-a716-446655440000'

  const validPayload = {
    areaId: validAreaId,
    positionX: 100,
    positionY: 200,
    members: [{ tableId: validTableId, positionX: 10, positionY: 20 }],
  }

  it('accepts a valid payload with members', () => {
    const result = areaMoveBroadcastSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('accepts a valid payload with an empty members array', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      members: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects NaN positionX on the area', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      positionX: NaN,
    })
    expect(result.success).toBe(false)
  })

  it('rejects Infinity positionY on the area', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      positionY: Infinity,
    })
    expect(result.success).toBe(false)
  })

  it('rejects NaN coordinates in a member entry', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      members: [{ tableId: validTableId, positionX: NaN, positionY: 20 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects Infinity coordinates in a member entry', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      members: [{ tableId: validTableId, positionX: Infinity, positionY: 20 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID areaId', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      areaId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID tableId in a member entry', () => {
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      members: [{ tableId: 'not-a-uuid', positionX: 10, positionY: 20 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a members array exceeding 500 entries', () => {
    const manyMembers = Array.from({ length: 501 }, () => ({
      tableId: validTableId,
      positionX: 0,
      positionY: 0,
    }))
    const result = areaMoveBroadcastSchema.safeParse({
      ...validPayload,
      members: manyMembers,
    })
    expect(result.success).toBe(false)
  })
})

describe('shape/connector schemas (UNIT-02)', () => {
  const whiteboardId = '11111111-1111-4111-8111-111111111111'
  const shapeId1 = '22222222-2222-4222-8222-222222222222'
  const shapeId2 = '33333333-3333-4333-8333-333333333333'

  function baseShape(over: Record<string, unknown> = {}) {
    return {
      whiteboardId,
      kind: 'rectangle' as const,
      positionX: 0,
      positionY: 0,
      width: 100,
      height: 100,
      props: { kind: 'rectangle' },
      ...over,
    }
  }

  describe('createShapeSchema — coordinate boundaries (M7)', () => {
    it('accepts positionX/positionY at exactly ±MAX_BOARD_COORD', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ positionX: MAX_BOARD_COORD }))
          .success,
      ).toBe(true)
      expect(
        createShapeSchema.safeParse(baseShape({ positionX: -MAX_BOARD_COORD }))
          .success,
      ).toBe(true)
    })

    it('rejects positionX one unit past MAX_BOARD_COORD', () => {
      expect(
        createShapeSchema.safeParse(
          baseShape({ positionX: MAX_BOARD_COORD + 1 }),
        ).success,
      ).toBe(false)
    })

    it('rejects positionX = 1e300 (finite but absurd)', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ positionX: 1e300 })).success,
      ).toBe(false)
    })

    it('rejects NaN and Infinity on any coordinate field', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ positionX: NaN })).success,
      ).toBe(false)
      expect(
        createShapeSchema.safeParse(baseShape({ positionY: Infinity })).success,
      ).toBe(false)
      expect(
        createShapeSchema.safeParse(baseShape({ positionY: -Infinity }))
          .success,
      ).toBe(false)
    })
  })

  describe('createShapeSchema — width/height', () => {
    it('accepts width/height at exactly 100_000', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ width: 100_000 })).success,
      ).toBe(true)
    })

    it('rejects width/height at 100_001', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ width: 100_001 })).success,
      ).toBe(false)
    })

    it('rejects non-positive width/height', () => {
      expect(createShapeSchema.safeParse(baseShape({ width: 0 })).success).toBe(
        false,
      )
      expect(
        createShapeSchema.safeParse(baseShape({ width: -10 })).success,
      ).toBe(false)
    })
  })

  describe('createShapeSchema — kind/props.kind cross-validation (W2, Hermes code review)', () => {
    it('rejects a mismatched kind and props.kind', () => {
      const result = createShapeSchema.safeParse(
        baseShape({ kind: 'line', props: { kind: 'text' } }),
      )
      expect(result.success).toBe(false)
    })

    it('rejects the reverse mismatch too', () => {
      const result = createShapeSchema.safeParse(
        baseShape({ kind: 'text', props: { kind: 'rectangle' } }),
      )
      expect(result.success).toBe(false)
    })

    it('accepts every kind when props.kind matches', () => {
      for (const kind of ['rectangle', 'ellipse', 'diamond', 'text'] as const) {
        expect(
          createShapeSchema.safeParse(baseShape({ kind, props: { kind } }))
            .success,
        ).toBe(true)
      }
      expect(
        createShapeSchema.safeParse(
          baseShape({
            kind: 'line',
            props: {
              kind: 'line',
              x1: 0,
              y1: 0.5,
              x2: 1,
              y2: 0.5,
              arrowStart: false,
              arrowEnd: true,
            },
          }),
        ).success,
      ).toBe(true)
    })
  })

  describe('shapePropsSchema — line fractions (FR-031a)', () => {
    function lineProps(over: Record<string, unknown> = {}) {
      return {
        kind: 'line' as const,
        x1: 0,
        y1: 0.5,
        x2: 1,
        y2: 0.5,
        arrowStart: false,
        arrowEnd: true,
        ...over,
      }
    }

    it('accepts fractions at exactly 0 and 1', () => {
      expect(shapePropsSchema.safeParse(lineProps()).success).toBe(true)
      expect(
        shapePropsSchema.safeParse(lineProps({ x1: 1, y1: 1, y2: 0 })).success,
      ).toBe(true)
    })

    it('rejects fractions below 0 or above 1', () => {
      expect(
        shapePropsSchema.safeParse(lineProps({ x1: -0.0001 })).success,
      ).toBe(false)
      expect(
        shapePropsSchema.safeParse(lineProps({ x2: 1.0001 })).success,
      ).toBe(false)
    })

    it("rejects a line's x1/y1/x2/y2 on a rectangle's props", () => {
      const result = shapePropsSchema.safeParse({
        kind: 'rectangle',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
      })
      expect(result.success).toBe(false)
    })

    it('validates each of the five kind discriminator arms independently', () => {
      for (const kind of ['rectangle', 'ellipse', 'diamond', 'text']) {
        expect(shapePropsSchema.safeParse({ kind }).success).toBe(true)
      }
      expect(shapePropsSchema.safeParse(lineProps()).success).toBe(true)
    })
  })

  describe('createShapeSchema — text length cap', () => {
    it('accepts text at exactly 500 chars', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ text: 'a'.repeat(500) }))
          .success,
      ).toBe(true)
    })

    it('rejects text at 501 chars', () => {
      expect(
        createShapeSchema.safeParse(baseShape({ text: 'a'.repeat(501) }))
          .success,
      ).toBe(false)
    })
  })

  describe('createShapeSchema — strict blob schemas', () => {
    it('rejects an unknown key in style', () => {
      const result = createShapeSchema.safeParse(
        baseShape({ style: { fill: 'none', bogus: 1 } }),
      )
      expect(result.success).toBe(false)
    })

    it('rejects an unknown key in props', () => {
      const result = createShapeSchema.safeParse(
        baseShape({ props: { kind: 'rectangle', bogus: 1 } }),
      )
      expect(result.success).toBe(false)
    })
  })

  describe('updateShapeSchema', () => {
    it('parses absent fields as undefined (not present in the object at all)', () => {
      const result = updateShapeSchema.parse({ positionX: 10 })
      expect(result.positionX).toBe(10)
      expect('width' in result).toBe(false)
    })
  })

  describe('createConnectorSchema', () => {
    function baseConnector(over: Record<string, unknown> = {}) {
      return {
        whiteboardId,
        sourceShapeId: shapeId1,
        targetShapeId: shapeId2,
        ...over,
      }
    }

    it('accepts a valid connector payload', () => {
      expect(createConnectorSchema.safeParse(baseConnector()).success).toBe(
        true,
      )
    })

    it('rejects sourceShapeId === targetShapeId (self-connector)', () => {
      const result = createConnectorSchema.safeParse(
        baseConnector({ targetShapeId: shapeId1 }),
      )
      expect(result.success).toBe(false)
    })
  })
})

describe('canvasElementPropsSchema — the connector arm carries an optional curvature', () => {
  const SOURCE = '11111111-1111-4111-8111-111111111111'
  const TARGET = '22222222-2222-4222-8222-222222222222'

  const legacy = {
    kind: 'connector' as const,
    sourceElementId: SOURCE,
    targetElementId: TARGET,
    routing: 'curved' as const,
  }

  it('accepts a legacy row that carries no curvature at all', () => {
    // The whole reason the field is optional. Every connector row already in
    // the database was written before bending existed; a required field would
    // make each of them fail validation on its NEXT update, which turns an
    // un-bowed connector into an uneditable one.
    const parsed = canvasElementPropsSchema.parse(legacy)
    expect(parsed).not.toHaveProperty('curvature')
  })

  it('accepts a bowed connector, including a deliberate zero and a negative', () => {
    // Negative is not an error state — the sign is which SIDE of the chord the
    // bow falls on. Zero is a connector the user bowed and straightened again.
    for (const curvature of [0, 0.5, -0.5]) {
      expect(
        canvasElementPropsSchema.parse({ ...legacy, curvature }).kind,
      ).toBe('connector')
    }
  })

  it('does NOT range-check it, so an out-of-range row stays editable', () => {
    // The clamp lives in connector-geometry.ts, which every render and
    // hit-test goes through, so a wild value is drawable. Rejecting it here
    // would strand the one row a user most needs to be able to grab and fix.
    expect(() =>
      canvasElementPropsSchema.parse({ ...legacy, curvature: 999 }),
    ).not.toThrow()
  })

  it('still rejects a non-number, so a bad write cannot reach storage', () => {
    expect(() =>
      canvasElementPropsSchema.parse({ ...legacy, curvature: '0.5' }),
    ).toThrow()
    expect(() =>
      canvasElementPropsSchema.parse({ ...legacy, curvature: Number.NaN }),
    ).toThrow()
  })
})

describe("canvasElementPropsSchema — the group arm's childIds is bounded (fix round — Hermes code review, Major Issue)", () => {
  // A cheap, deterministic v4-shaped UUID — this only needs distinct,
  // schema-valid ids, not cryptographically real ones.
  function uuidAt(n: number): string {
    const hex = n.toString(16).padStart(12, '0')
    return `00000000-0000-4000-8000-${hex}`
  }

  it('accepts up to 1000 childIds, matching memberTableIds — the closest analog in this schema', () => {
    const childIds = Array.from({ length: 1000 }, (_, i) => uuidAt(i))
    expect(() =>
      canvasElementPropsSchema.parse({ kind: 'group', childIds }),
    ).not.toThrow()
  })

  it('rejects more than 1000 childIds — previously unbounded, and this value now feeds a whole-board scan (repairGroupMembership) on every load, not just a per-write shape check', () => {
    const childIds = Array.from({ length: 1001 }, (_, i) => uuidAt(i))
    expect(() =>
      canvasElementPropsSchema.parse({ kind: 'group', childIds }),
    ).toThrow()
  })
})

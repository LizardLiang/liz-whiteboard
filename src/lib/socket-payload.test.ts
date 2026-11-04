// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEventLimiter,
  cursorPayloadSchema,
  findForeignTableIds,
  tableMovePayloadSchema,
} from './socket-payload'
import {
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

const ID = '20000000-0000-4000-8000-000000000001'

describe('tableMovePayloadSchema', () => {
  it('accepts finite coordinates', () => {
    expect(
      tableMovePayloadSchema.safeParse({
        tableId: ID,
        positionX: 10,
        positionY: -5.5,
      }).success,
    ).toBe(true)
  })
  it('rejects NaN, Infinity, huge and non-numeric coordinates', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, 1e12, '1', null]) {
      expect(
        tableMovePayloadSchema.safeParse({
          tableId: ID,
          positionX: bad,
          positionY: 0,
        }).success,
      ).toBe(false)
    }
  })
  it('rejects a non-UUID tableId', () => {
    expect(
      tableMovePayloadSchema.safeParse({
        tableId: 'x',
        positionX: 0,
        positionY: 0,
      }).success,
    ).toBe(false)
  })
})

describe('cursorPayloadSchema', () => {
  it('bounds and validates', () => {
    expect(cursorPayloadSchema.safeParse({ x: 1, y: 2 }).success).toBe(true)
    expect(cursorPayloadSchema.safeParse({ x: Infinity, y: 2 }).success).toBe(
      false,
    )
    expect(cursorPayloadSchema.safeParse({ x: 1e9, y: 2 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ x: 'a', y: 2 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse(null).success).toBe(false)
  })
})

describe('createEventLimiter', () => {
  it('drops events beyond max per window and recovers next window', () => {
    const allow = createEventLimiter(60, 1000)
    let ok = 0
    for (let i = 0; i < 100; i++) if (allow(5000)) ok++
    expect(ok).toBe(60)
    expect(allow(6001)).toBe(true)
  })
})

describe('findForeignTableIds', () => {
  beforeEach(() => resetDb())

  it('returns only ids that are not tables of the board', () => {
    const { id: userId } = makeUser()
    const project = makeProject({ ownerId: userId })
    const a = makeWhiteboard({ projectId: project.id })
    const b = makeWhiteboard({ projectId: project.id })
    const ta = makeTable({ whiteboardId: a.id })
    const tb = makeTable({ whiteboardId: b.id })
    expect(findForeignTableIds(a.id, [ta.id])).toEqual([])
    expect(findForeignTableIds(a.id, [ta.id, tb.id, ID])).toEqual([tb.id, ID])
    expect(findForeignTableIds(a.id, [])).toEqual([])
  })
})

// src/data/schema-coordinate-bounds.test.ts
// Every persisted/broadcast position and size must be bounded: a value like
// 1e300 passes `.finite()` and makes fitView zoom every collaborator's board to
// nothing (see MAX_BOARD_COORD in schema.ts).

import { describe, expect, it } from 'vitest'
import {
  MAX_BOARD_COORD,
  MAX_BOARD_SIZE,
  MAX_ROUTING_POINTS,
  areaBoundsSchema,
  areaMoveBroadcastSchema,
  canvasStateSchema,
  createAreaSchema,
  createTableSchema,
  cursorSchema,
  routingPointsSchema,
  tableMoveBulkBroadcastSchema,
  updateAreaSchema,
} from './schema'

const id = '11111111-1111-4111-8111-111111111111'
const wb = '22222222-2222-4222-8222-222222222222'
const HUGE = 1e300

describe('coordinate bounds', () => {
  it('createTableSchema refuses out-of-range position and size, accepts the limit', () => {
    const base = { whiteboardId: wb, name: 't' }
    expect(createTableSchema.safeParse({ ...base, positionX: HUGE }).success).toBe(false)
    expect(createTableSchema.safeParse({ ...base, positionY: -HUGE }).success).toBe(false)
    expect(createTableSchema.safeParse({ ...base, width: HUGE }).success).toBe(false)
    expect(createTableSchema.safeParse({ ...base, height: HUGE }).success).toBe(false)
    expect(
      createTableSchema.safeParse({ ...base, positionX: MAX_BOARD_COORD, width: MAX_BOARD_SIZE }).success,
    ).toBe(true)
  })

  it('createAreaSchema / updateAreaSchema / areaBoundsSchema refuse out-of-range values', () => {
    const area = {
      whiteboardId: wb,
      name: 'a',
      color: undefined as never,
      positionX: 0,
      positionY: 0,
      width: 10,
      height: 10,
    }
    expect(createAreaSchema.safeParse({ ...area, positionX: HUGE }).success).toBe(false)
    expect(createAreaSchema.safeParse({ ...area, width: HUGE }).success).toBe(false)
    expect(updateAreaSchema.safeParse({ positionY: HUGE }).success).toBe(false)
    expect(updateAreaSchema.safeParse({ height: HUGE }).success).toBe(false)
    expect(
      areaBoundsSchema.safeParse({ id, positionX: 0, positionY: 0, width: HUGE, height: 1 }).success,
    ).toBe(false)
  })

  it('areaMoveBroadcastSchema refuses a huge area or member position', () => {
    const ok = { areaId: id, positionX: 1, positionY: 2, members: [] }
    expect(areaMoveBroadcastSchema.safeParse(ok).success).toBe(true)
    expect(areaMoveBroadcastSchema.safeParse({ ...ok, positionX: HUGE }).success).toBe(false)
    expect(
      areaMoveBroadcastSchema.safeParse({
        ...ok,
        members: [{ tableId: id, positionX: 0, positionY: HUGE }],
      }).success,
    ).toBe(false)
  })

  it('tableMoveBulkBroadcastSchema refuses a huge table position', () => {
    const msg = (x: number) => ({
      userId: id,
      positions: [{ tableId: id, positionX: x, positionY: 0 }],
    })
    expect(tableMoveBulkBroadcastSchema.safeParse(msg(5)).success).toBe(true)
    expect(tableMoveBulkBroadcastSchema.safeParse(msg(HUGE)).success).toBe(false)
  })

  it('cursor and viewport offsets are bounded', () => {
    expect(cursorSchema.safeParse({ x: HUGE, y: 0 }).success).toBe(false)
    expect(canvasStateSchema.safeParse({ zoom: 1, offsetX: HUGE, offsetY: 0 }).success).toBe(false)
    expect(canvasStateSchema.safeParse({ zoom: 1, offsetX: -3000, offsetY: 500 }).success).toBe(true)
  })

  it('routingPointsSchema bounds both coordinates and the point count', () => {
    expect(routingPointsSchema.safeParse([{ x: HUGE, y: 0 }]).success).toBe(false)
    const pts = (n: number) => Array.from({ length: n }, () => ({ x: 1, y: 1 }))
    expect(routingPointsSchema.safeParse(pts(MAX_ROUTING_POINTS)).success).toBe(true)
    expect(routingPointsSchema.safeParse(pts(MAX_ROUTING_POINTS + 1)).success).toBe(false)
  })
})

// src/data/shape.test.ts
// Integration tests for the Shape data layer (Phase 1: shapes-and-connectors)
// against a real in-memory SQLite database (DATABASE_URL=:memory:). Mirrors
// src/data/area.test.ts's style.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createShape,
  findShapeById,
  findShapesByWhiteboard,
  updateShape,
} from './shape'
import { db } from '@/db'
import { makeProject, makeWhiteboard, resetDb } from '@/test/db-helpers'

/** Build the FK chain a Shape requires: Project -> Whiteboard. */
function makeWhiteboardId(): string {
  const p = makeProject()
  const wb = makeWhiteboard({ projectId: p.id })
  return wb.id
}

function baseShape(whiteboardId: string, over: Record<string, unknown> = {}) {
  return {
    whiteboardId,
    kind: 'rectangle' as const,
    positionX: 10,
    positionY: 20,
    width: 160,
    height: 100,
    props: { kind: 'rectangle' as const },
    ...over,
  }
}

beforeEach(() => resetDb())

describe('createShape', () => {
  it('inserts a rectangle and returns the mapped model with style/props defaults', async () => {
    const wbId = makeWhiteboardId()
    const shape = await createShape(baseShape(wbId))

    expect(shape.id).toBeTruthy()
    expect(shape.whiteboardId).toBe(wbId)
    expect(shape.kind).toBe('rectangle')
    expect(shape.positionX).toBe(10)
    expect(shape.width).toBe(160)
    expect(shape.rotation).toBe(0)
    expect(shape.zIndex).toBe(0)
    expect(shape.text).toBeNull()
    expect(shape.style.fill).toBe('none')
    expect(shape.style.stroke).toBe('slate')
    expect(shape.props).toEqual({ kind: 'rectangle' })
    expect(shape.createdAt).toBeInstanceOf(Date)
  })

  it('persists a line shape with its endpoint fractions', async () => {
    const wbId = makeWhiteboardId()
    const shape = await createShape(
      baseShape(wbId, {
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
    )
    expect(shape.props).toEqual({
      kind: 'line',
      x1: 0,
      y1: 0.5,
      x2: 1,
      y2: 0.5,
      arrowStart: false,
      arrowEnd: true,
    })

    const reloaded = await findShapeById(shape.id)
    expect(reloaded?.props).toEqual(shape.props)
  })

  it('persists an explicit label and style', async () => {
    const wbId = makeWhiteboardId()
    const shape = await createShape(
      baseShape(wbId, {
        text: 'Hello',
        style: { fill: 'blue', stroke: 'red', strokeWidth: 4 },
      }),
    )
    expect(shape.text).toBe('Hello')
    expect(shape.style.fill).toBe('blue')
    expect(shape.style.stroke).toBe('red')
    expect(shape.style.strokeWidth).toBe(4)
    // Unspecified style fields still get their schema default.
    expect(shape.style.strokeStyle).toBe('solid')
  })

  it('rejects a non-finite coordinate before any write', async () => {
    const wbId = makeWhiteboardId()
    await expect(
      createShape(baseShape(wbId, { positionX: Number.NaN })),
    ).rejects.toThrow()
    const shapes = await findShapesByWhiteboard(wbId)
    expect(shapes).toHaveLength(0)
  })
})

describe('findShapesByWhiteboard', () => {
  it('returns only shapes for the given whiteboard, in creation order', async () => {
    const wbA = makeWhiteboardId()
    const wbB = makeWhiteboardId()
    const s1 = await createShape(baseShape(wbA))
    const s2 = await createShape(baseShape(wbA))
    await createShape(baseShape(wbB))

    const shapes = await findShapesByWhiteboard(wbA)
    expect(shapes.map((s) => s.id)).toEqual([s1.id, s2.id])
  })

  it('returns an empty array for a whiteboard with no shapes', async () => {
    const wbId = makeWhiteboardId()
    expect(await findShapesByWhiteboard(wbId)).toEqual([])
  })
})

describe('updateShape', () => {
  it('updates only the provided fields', async () => {
    const wbId = makeWhiteboardId()
    const shape = await createShape(baseShape(wbId))

    const updated = await updateShape(shape.id, { positionX: 999 })
    expect(updated.positionX).toBe(999)
    expect(updated.positionY).toBe(shape.positionY)
    expect(updated.width).toBe(shape.width)
  })

  it('throws for a nonexistent shape id', async () => {
    await expect(
      updateShape('99999999-9999-4999-8999-999999999999', {
        positionX: 1,
      }),
    ).rejects.toThrow()
  })

  it('reads the full prior row BEFORE writing (Phase-2 pre-compliance)', async () => {
    const wbId = makeWhiteboardId()
    const shape = await createShape(baseShape(wbId))

    const original = db.prepare.bind(db)
    const order: Array<'select' | 'update'> = []
    const spy = vi
      .spyOn(db, 'prepare')
      .mockImplementation((sql: string, ...rest: Array<unknown>) => {
        if (sql.startsWith('SELECT') && sql.includes('"Shape"')) {
          order.push('select')
        }
        if (sql.startsWith('UPDATE "Shape"')) {
          order.push('update')
        }
        return (original as any)(sql, ...rest)
      })

    await updateShape(shape.id, { positionX: 50 })

    spy.mockRestore()

    const updateIdx = order.indexOf('update')
    expect(updateIdx).toBeGreaterThan(-1)
    expect(order.slice(0, updateIdx)).toContain('select')
  })
})

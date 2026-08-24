// src/data/connector.test.ts
// Integration tests for the Connector data layer (Phase 1:
// shapes-and-connectors) against a real in-memory SQLite database
// (DATABASE_URL=:memory:). Covers FR-016/FR-018/FR-031's endpoint rules and
// the atomic cascade delete.

import { beforeEach, describe, expect, it } from 'vitest'

import { createShape } from './shape'
import {
  createConnector,
  deleteConnector,
  deleteShapeWithConnectors,
  findConnectorsByShapeId,
  findConnectorsByWhiteboard,
} from './connector'
import { db } from '@/db'
import { makeProject, makeWhiteboard, resetDb } from '@/test/db-helpers'

function makeWhiteboardId(): string {
  const p = makeProject()
  const wb = makeWhiteboard({ projectId: p.id })
  return wb.id
}

async function makeRect(whiteboardId: string) {
  return createShape({
    whiteboardId,
    kind: 'rectangle',
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    props: { kind: 'rectangle' },
  })
}

async function makeLine(whiteboardId: string) {
  return createShape({
    whiteboardId,
    kind: 'line',
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 40,
    props: {
      kind: 'line',
      x1: 0,
      y1: 0.5,
      x2: 1,
      y2: 0.5,
      arrowStart: false,
      arrowEnd: true,
    },
  })
}

beforeEach(() => resetDb())

describe('createConnector', () => {
  it('creates a connector between two shapes on the same whiteboard', async () => {
    const wbId = makeWhiteboardId()
    const a = await makeRect(wbId)
    const b = await makeRect(wbId)

    const connector = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: a.id,
      targetShapeId: b.id,
    })

    expect(connector.sourceShapeId).toBe(a.id)
    expect(connector.targetShapeId).toBe(b.id)
    expect(connector.style.arrowEnd).toBe(true)
    expect(connector.style.arrowStart).toBe(false)
  })

  it('rejects when either endpoint belongs to a different whiteboard', async () => {
    const wbA = makeWhiteboardId()
    const wbB = makeWhiteboardId()
    const a = await makeRect(wbA)
    const b = await makeRect(wbB)

    await expect(
      createConnector({
        whiteboardId: wbA,
        sourceShapeId: a.id,
        targetShapeId: b.id,
      }),
    ).rejects.toThrow()
  })

  it('rejects a self-connector (sourceShapeId === targetShapeId)', async () => {
    const wbId = makeWhiteboardId()
    const a = await makeRect(wbId)

    await expect(
      createConnector({
        whiteboardId: wbId,
        sourceShapeId: a.id,
        targetShapeId: a.id,
      }),
    ).rejects.toThrow()
  })

  it('rejects a connector with a line-kind endpoint (enforcement point 3 of 3)', async () => {
    const wbId = makeWhiteboardId()
    const rect = await makeRect(wbId)
    const line = await makeLine(wbId)

    await expect(
      createConnector({
        whiteboardId: wbId,
        sourceShapeId: line.id,
        targetShapeId: rect.id,
      }),
    ).rejects.toThrow(/line/i)

    await expect(
      createConnector({
        whiteboardId: wbId,
        sourceShapeId: rect.id,
        targetShapeId: line.id,
      }),
    ).rejects.toThrow(/line/i)
  })

  it('rejects a duplicate A->B connector via the unique index, but allows B->A', async () => {
    const wbId = makeWhiteboardId()
    const a = await makeRect(wbId)
    const b = await makeRect(wbId)

    await createConnector({
      whiteboardId: wbId,
      sourceShapeId: a.id,
      targetShapeId: b.id,
    })

    await expect(
      createConnector({
        whiteboardId: wbId,
        sourceShapeId: a.id,
        targetShapeId: b.id,
      }),
    ).rejects.toThrow(/already connected/i)

    // Reverse direction is a different, meaningful arrow — allowed.
    const reverse = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: b.id,
      targetShapeId: a.id,
    })
    expect(reverse.sourceShapeId).toBe(b.id)
  })
})

describe('findConnectorsByShapeId', () => {
  it('returns connectors where the shape is either endpoint (indexed lookup)', async () => {
    const wbId = makeWhiteboardId()
    const a = await makeRect(wbId)
    const b = await makeRect(wbId)
    const c = await makeRect(wbId)

    const ab = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: a.id,
      targetShapeId: b.id,
    })
    const cb = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: c.id,
      targetShapeId: b.id,
    })

    const touchingB = await findConnectorsByShapeId(b.id)
    expect(touchingB.map((c) => c.id).sort()).toEqual([ab.id, cb.id].sort())

    const touchingA = await findConnectorsByShapeId(a.id)
    expect(touchingA.map((c) => c.id)).toEqual([ab.id])
  })
})

describe('findConnectorsByWhiteboard', () => {
  it('scopes results to the given whiteboard', async () => {
    const wbA = makeWhiteboardId()
    const wbB = makeWhiteboardId()
    const a1 = await makeRect(wbA)
    const a2 = await makeRect(wbA)
    await createConnector({
      whiteboardId: wbA,
      sourceShapeId: a1.id,
      targetShapeId: a2.id,
    })
    const b1 = await makeRect(wbB)
    const b2 = await makeRect(wbB)
    await createConnector({
      whiteboardId: wbB,
      sourceShapeId: b1.id,
      targetShapeId: b2.id,
    })

    expect(await findConnectorsByWhiteboard(wbA)).toHaveLength(1)
    expect(await findConnectorsByWhiteboard(wbB)).toHaveLength(1)
  })
})

describe('deleteConnector', () => {
  it('deletes a single connector without touching its shapes', async () => {
    const wbId = makeWhiteboardId()
    const a = await makeRect(wbId)
    const b = await makeRect(wbId)
    const connector = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: a.id,
      targetShapeId: b.id,
    })

    const deleted = await deleteConnector(connector.id)
    expect(deleted.id).toBe(connector.id)

    expect(await findConnectorsByWhiteboard(wbId)).toHaveLength(0)
    const remainingShapes = db
      .prepare('SELECT COUNT(*) as n FROM "Shape" WHERE "whiteboardId" = ?')
      .get(wbId) as { n: number }
    expect(remainingShapes.n).toBe(2)
  })

  it('throws for a nonexistent connector id', async () => {
    await expect(
      deleteConnector('99999999-9999-4999-8999-999999999999'),
    ).rejects.toThrow()
  })
})

describe('deleteShapeWithConnectors (FR-018 atomic cascade)', () => {
  it('deleting a shape with 2 connectors removes exactly 3 rows in one transaction', async () => {
    const wbId = makeWhiteboardId()
    const center = await makeRect(wbId)
    const other1 = await makeRect(wbId)
    const other2 = await makeRect(wbId)
    const c1 = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: center.id,
      targetShapeId: other1.id,
    })
    const c2 = await createConnector({
      whiteboardId: wbId,
      sourceShapeId: other2.id,
      targetShapeId: center.id,
    })

    const result = await deleteShapeWithConnectors(center.id)
    expect(result).not.toBeNull()
    expect(result!.shape.id).toBe(center.id)
    expect(result!.connectors.map((c) => c.id).sort()).toEqual(
      [c1.id, c2.id].sort(),
    )

    // Exactly 3 rows removed: the shape + both connectors. The two other
    // shapes and zero dangling connectors remain.
    const remainingShapes = db
      .prepare('SELECT COUNT(*) as n FROM "Shape" WHERE "whiteboardId" = ?')
      .get(wbId) as { n: number }
    expect(remainingShapes.n).toBe(2)
    expect(await findConnectorsByWhiteboard(wbId)).toHaveLength(0)
  })

  it('returns null (not a throw) when the shape no longer exists — NOT_FOUND, not INTERNAL_ERROR', async () => {
    const wbId = makeWhiteboardId()
    const shape = await makeRect(wbId)
    db.prepare('DELETE FROM "Shape" WHERE "id" = ?').run(shape.id)

    const result = await deleteShapeWithConnectors(shape.id)
    expect(result).toBeNull()
  })
})

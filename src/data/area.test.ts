// src/data/area.test.ts
// Integration tests for the Area data layer (subject areas, GH #106) against a
// real in-memory SQLite database (DATABASE_URL=:memory:). Covers create, find,
// update, delete, whiteboard scoping, membership cleanup, and FK cascade.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createArea,
  deleteArea,
  findAreaById,
  findAreasByWhiteboard,
  removeTableFromAreas,
  updateArea,
} from './area'
import { db } from '@/db'
import {
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

/** Build the FK chain an Area requires: Project → Whiteboard. */
function makeWhiteboardId(): string {
  const p = makeProject()
  const wb = makeWhiteboard({ projectId: p.id })
  return wb.id
}

function baseArea(whiteboardId: string, over: Record<string, unknown> = {}) {
  return {
    whiteboardId,
    name: 'Billing',
    color: 'blue',
    positionX: 10,
    positionY: 20,
    width: 400,
    height: 300,
    ...over,
  }
}

beforeEach(() => resetDb())

describe('createArea', () => {
  it('inserts an area and returns the mapped model with empty members by default', async () => {
    const wbId = makeWhiteboardId()
    const area = await createArea(baseArea(wbId))

    expect(area.id).toBeTruthy()
    expect(area.whiteboardId).toBe(wbId)
    expect(area.name).toBe('Billing')
    expect(area.color).toBe('blue')
    expect(area.positionX).toBe(10)
    expect(area.width).toBe(400)
    expect(area.memberTableIds).toEqual([])
    expect(area.createdAt).toBeInstanceOf(Date)
  })

  it('persists seeded member table ids', async () => {
    const wbId = makeWhiteboardId()
    const t1 = makeTable({ whiteboardId: wbId, name: 't1' })
    const t2 = makeTable({ whiteboardId: wbId, name: 't2' })
    const area = await createArea(
      baseArea(wbId, { memberTableIds: [t1.id, t2.id] }),
    )
    expect(area.memberTableIds).toEqual([t1.id, t2.id])

    const reloaded = await findAreaById(area.id)
    expect(reloaded?.memberTableIds).toEqual([t1.id, t2.id])
  })

  it('rejects a color outside the palette', async () => {
    const wbId = makeWhiteboardId()
    await expect(
      createArea(baseArea(wbId, { color: 'chartreuse' })),
    ).rejects.toThrow()
  })
})

describe('findAreasByWhiteboard', () => {
  it('returns only areas for the given whiteboard, in creation order', async () => {
    const wbA = makeWhiteboardId()
    const wbB = makeWhiteboardId()
    const a1 = await createArea(baseArea(wbA, { name: 'A1' }))
    const a2 = await createArea(baseArea(wbA, { name: 'A2' }))
    await createArea(baseArea(wbB, { name: 'B1' }))

    const areas = await findAreasByWhiteboard(wbA)
    expect(areas.map((a) => a.id)).toEqual([a1.id, a2.id])
  })
})

describe('updateArea', () => {
  it('updates only the provided fields', async () => {
    const wbId = makeWhiteboardId()
    const area = await createArea(baseArea(wbId))

    const updated = await updateArea(area.id, { name: 'Payments', color: 'red' })
    expect(updated.name).toBe('Payments')
    expect(updated.color).toBe('red')
    // untouched fields preserved
    expect(updated.positionX).toBe(10)
    expect(updated.width).toBe(400)
  })

  it('replaces membership when memberTableIds is provided', async () => {
    const wbId = makeWhiteboardId()
    const t1 = makeTable({ whiteboardId: wbId, name: 't1' })
    const t2 = makeTable({ whiteboardId: wbId, name: 't2' })
    const area = await createArea(baseArea(wbId, { memberTableIds: [t1.id] }))

    const updated = await updateArea(area.id, { memberTableIds: [t2.id] })
    expect(updated.memberTableIds).toEqual([t2.id])
  })
})

describe('deleteArea', () => {
  it('removes the area but leaves member tables intact', async () => {
    const wbId = makeWhiteboardId()
    const t1 = makeTable({ whiteboardId: wbId, name: 't1' })
    const area = await createArea(baseArea(wbId, { memberTableIds: [t1.id] }))

    await deleteArea(area.id)

    expect(await findAreaById(area.id)).toBeNull()
    const tableStill = db
      .prepare('SELECT "id" FROM "DiagramTable" WHERE "id" = ?')
      .get(t1.id)
    expect(tableStill).toBeTruthy()
  })

  it('throws when the area does not exist', async () => {
    await expect(deleteArea('00000000-0000-0000-0000-000000000000')).rejects.toThrow()
  })
})

describe('removeTableFromAreas', () => {
  it('drops a table id from only the areas that contained it', async () => {
    const wbId = makeWhiteboardId()
    const t1 = makeTable({ whiteboardId: wbId, name: 't1' })
    const t2 = makeTable({ whiteboardId: wbId, name: 't2' })
    const withT1 = await createArea(
      baseArea(wbId, { name: 'has-t1', memberTableIds: [t1.id, t2.id] }),
    )
    const withoutT1 = await createArea(
      baseArea(wbId, { name: 'no-t1', memberTableIds: [t2.id] }),
    )

    const affected = await removeTableFromAreas(wbId, t1.id)
    expect(affected.map((a) => a.id)).toEqual([withT1.id])

    expect((await findAreaById(withT1.id))?.memberTableIds).toEqual([t2.id])
    expect((await findAreaById(withoutT1.id))?.memberTableIds).toEqual([t2.id])
  })
})

describe('cascade on whiteboard delete', () => {
  it('deletes areas when their whiteboard is deleted', async () => {
    const wbId = makeWhiteboardId()
    const area = await createArea(baseArea(wbId))

    db.exec('PRAGMA foreign_keys = ON;')
    db.prepare('DELETE FROM "Whiteboard" WHERE "id" = ?').run(wbId)

    expect(await findAreaById(area.id)).toBeNull()
  })
})

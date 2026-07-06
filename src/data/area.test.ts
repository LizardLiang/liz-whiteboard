// src/data/area.test.ts
// Integration tests for the Area data layer (subject areas, GH #106) against a
// real in-memory SQLite database (DATABASE_URL=:memory:). Covers create, find,
// update, delete, whiteboard scoping, membership cleanup, and FK cascade.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createArea,
  deleteArea,
  findAreaById,
  findAreasByWhiteboard,
  moveAreaAndMembers,
  removeTableFromAreas,
  updateArea,
} from './area'
import type * as DbModule from '@/db'
import { db } from '@/db'
import {
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

// moveAreaAndMembers rollback test needs a way to force a write failure
// mid-transaction (the generic `update()` helper never throws on its own —
// an UPDATE against a nonexistent id just affects 0 rows). Mock `update` to
// throw for a sentinel id while delegating to the real implementation
// otherwise, so every other test in this file is unaffected.
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  return {
    ...actual,
    update: vi.fn(
      (table: string, id: string, values: Record<string, unknown>) => {
        if (id === 'FORCE_WRITE_FAILURE') {
          throw new Error('Simulated write failure')
        }
        return actual.update(table, id, values)
      },
    ),
  }
})

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

describe('moveAreaAndMembers', () => {
  it('updates both the area and all member rows in a single call', async () => {
    const wbId = makeWhiteboardId()
    const t1 = makeTable({ whiteboardId: wbId, name: 't1' })
    const t2 = makeTable({ whiteboardId: wbId, name: 't2' })
    const area = await createArea(
      baseArea(wbId, { memberTableIds: [t1.id, t2.id] }),
    )

    const updated = await moveAreaAndMembers(
      area.id,
      { positionX: 500, positionY: 600 },
      [
        { tableId: t1.id, positionX: 50, positionY: 60 },
        { tableId: t2.id, positionX: 70, positionY: 80 },
      ],
    )

    expect(updated.positionX).toBe(500)
    expect(updated.positionY).toBe(600)

    const row1 = db
      .prepare('SELECT "positionX", "positionY" FROM "DiagramTable" WHERE "id" = ?')
      .get(t1.id) as { positionX: number; positionY: number }
    const row2 = db
      .prepare('SELECT "positionX", "positionY" FROM "DiagramTable" WHERE "id" = ?')
      .get(t2.id) as { positionX: number; positionY: number }
    expect(row1).toEqual({ positionX: 50, positionY: 60 })
    expect(row2).toEqual({ positionX: 70, positionY: 80 })
  })

  it('supports a member-less area (empty members array)', async () => {
    const wbId = makeWhiteboardId()
    const area = await createArea(baseArea(wbId))

    const updated = await moveAreaAndMembers(
      area.id,
      { positionX: 33, positionY: 44 },
      [],
    )
    expect(updated.positionX).toBe(33)
    expect(updated.positionY).toBe(44)
  })

  it('rolls back the whole batch (area + members) when one row fails (all-or-nothing)', async () => {
    const wbId = makeWhiteboardId()
    const t1 = makeTable({ whiteboardId: wbId, name: 't1' })
    const area = await createArea(
      baseArea(wbId, {
        positionX: 10,
        positionY: 20,
        memberTableIds: [t1.id],
      }),
    )

    await expect(
      moveAreaAndMembers(
        area.id,
        { positionX: 999, positionY: 999 },
        [
          { tableId: t1.id, positionX: 111, positionY: 222 },
          { tableId: 'FORCE_WRITE_FAILURE', positionX: 0, positionY: 0 },
        ],
      ),
    ).rejects.toThrow()

    // Area position rolled back — the area update happens first in the
    // transaction, before the failing member update.
    const reloadedArea = await findAreaById(area.id)
    expect(reloadedArea?.positionX).toBe(10)
    expect(reloadedArea?.positionY).toBe(20)

    // Member position rolled back too — proves all-or-nothing, not
    // partial-commit.
    const row1 = db
      .prepare('SELECT "positionX", "positionY" FROM "DiagramTable" WHERE "id" = ?')
      .get(t1.id) as { positionX: number; positionY: number }
    expect(row1).toEqual({ positionX: 0, positionY: 0 })
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

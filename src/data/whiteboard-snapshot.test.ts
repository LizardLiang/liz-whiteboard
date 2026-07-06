// src/data/whiteboard-snapshot.test.ts
// Integration tests for the WhiteboardSnapshot data layer (GH #107) against a
// real in-memory SQLite database (DATABASE_URL=:memory:). Mirrors
// src/data/area.test.ts's style (real FK chain, real transaction rollback
// injection via vi.mock('@/db')).

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureWhiteboardState,
  createWhiteboardSnapshot,
  findSnapshotById,
  findSnapshotsByWhiteboardId,
  restoreWhiteboardFromSnapshot,
} from './whiteboard-snapshot'
import {
  createDiagramTable,
  findDiagramTablesByWhiteboardId,
} from './diagram-table'
import { createColumn } from './column'
import { createRelationship } from './relationship'
import { createArea, findAreaById, findAreasByWhiteboard } from './area'
import type * as DbModule from '@/db'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

// AC8 rollback test needs a way to force a write failure partway through the
// restore transaction. Mock `insert` to throw for the Relationship table
// while delegating to the real implementation otherwise, so every other
// test in this file is unaffected (mirrors area.test.ts's moveAreaAndMembers
// rollback test).
vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  return {
    ...actual,
    insert: vi.fn((table: string, values: Record<string, unknown>) => {
      if ((globalThis as any).__FORCE_INSERT_FAIL_TABLE__ === table) {
        throw new Error('Simulated write failure')
      }
      return actual.insert(table, values)
    }),
  }
})

/** Build the FK chain a whiteboard requires: Project -> Whiteboard. */
function makeWhiteboardId(): string {
  const p = makeProject()
  const wb = makeWhiteboard({ projectId: p.id })
  return wb.id
}

/** Seed a small but representative diagram: 2 tables, 1 relationship, 1 area. */
async function seedDiagram(whiteboardId: string) {
  const t1 = await createDiagramTable({
    whiteboardId,
    name: 'users',
    positionX: 0,
    positionY: 0,
  })
  const c1 = await createColumn({
    tableId: t1.id,
    name: 'id',
    dataType: 'uuid',
    isPrimaryKey: true,
    isForeignKey: false,
    isUnique: true,
    isNullable: false,
    order: 0,
  })
  const t2 = await createDiagramTable({
    whiteboardId,
    name: 'posts',
    positionX: 100,
    positionY: 100,
  })
  const c2 = await createColumn({
    tableId: t2.id,
    name: 'user_id',
    dataType: 'uuid',
    isForeignKey: true,
    isPrimaryKey: false,
    isUnique: false,
    isNullable: false,
    order: 0,
  })
  const rel = await createRelationship({
    whiteboardId,
    sourceTableId: t1.id,
    targetTableId: t2.id,
    sourceColumnId: c1.id,
    targetColumnId: c2.id,
    cardinality: 'ONE_TO_MANY',
    routingPoints: [{ x: 10, y: 20 }],
  })
  const area = await createArea({
    whiteboardId,
    name: 'Core',
    color: 'blue',
    positionX: 0,
    positionY: 0,
    width: 400,
    height: 300,
    memberTableIds: [t1.id, t2.id],
  })
  return { t1, c1, t2, c2, rel, area }
}

beforeEach(() => {
  resetDb()
  delete (globalThis as any).__FORCE_INSERT_FAIL_TABLE__
})

describe('captureWhiteboardState', () => {
  it('captures whiteboard scalars, tables with columns, relationships (incl. routingPoints), and areas (incl. memberTableIds)', async () => {
    const whiteboardId = makeWhiteboardId()
    const { t1, c1, rel, area } = await seedDiagram(whiteboardId)

    const payload = await captureWhiteboardState(whiteboardId)

    expect(payload.whiteboard.name).toBe('Test WB')
    expect(payload.tables).toHaveLength(2)
    const capturedT1 = payload.tables.find((t) => t.id === t1.id)!
    expect(capturedT1.columns.map((c) => c.id)).toEqual([c1.id])
    expect(payload.relationships).toHaveLength(1)
    expect(payload.relationships[0].id).toBe(rel.id)
    expect(payload.relationships[0].routingPoints).toEqual([{ x: 10, y: 20 }])
    expect(payload.areas).toHaveLength(1)
    expect(payload.areas[0].id).toBe(area.id)
    expect(payload.areas[0].memberTableIds).toEqual(area.memberTableIds)
  })

  it('captures an empty diagram with no tables/relationships/areas', async () => {
    const whiteboardId = makeWhiteboardId()
    const payload = await captureWhiteboardState(whiteboardId)
    expect(payload.tables).toEqual([])
    expect(payload.relationships).toEqual([])
    expect(payload.areas).toEqual([])
  })

  it('throws for a nonexistent whiteboard', async () => {
    await expect(
      captureWhiteboardState('99999999-9999-9999-9999-999999999999'),
    ).rejects.toThrow()
  })
})

describe('createWhiteboardSnapshot / findSnapshotsByWhiteboardId / findSnapshotById', () => {
  it('persists a snapshot, lists it WITHOUT payload, and loads it WITH payload by id', async () => {
    const whiteboardId = makeWhiteboardId()
    const author = makeUser({ username: 'alice' })
    await seedDiagram(whiteboardId)
    const payload = await captureWhiteboardState(whiteboardId)

    const snapshot = await createWhiteboardSnapshot({
      whiteboardId,
      label: 'v1',
      createdByUserId: author.id,
      isAuto: false,
      payload,
    })

    const list = await findSnapshotsByWhiteboardId(whiteboardId)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(snapshot.id)
    expect(list[0].label).toBe('v1')
    expect(list[0].authorName).toBe('alice')
    expect(list[0].isAuto).toBe(false)
    expect((list[0] as any).payload).toBeUndefined()

    const full = await findSnapshotById(snapshot.id)
    expect(full?.payload.tables).toHaveLength(2)
    expect(full?.payload.relationships).toHaveLength(1)
    expect(full?.payload.areas).toHaveLength(1)
  })

  it('lists snapshots newest-first', async () => {
    const whiteboardId = makeWhiteboardId()
    const payload = await captureWhiteboardState(whiteboardId)
    const first = await createWhiteboardSnapshot({
      whiteboardId,
      label: 'v1',
      createdByUserId: null,
      isAuto: false,
      payload,
    })
    const second = await createWhiteboardSnapshot({
      whiteboardId,
      label: 'v2',
      createdByUserId: null,
      isAuto: false,
      payload,
    })

    const list = await findSnapshotsByWhiteboardId(whiteboardId)
    expect(list.map((s) => s.id)).toEqual([second.id, first.id])
  })

  it('returns null for a nonexistent snapshot id', async () => {
    expect(
      await findSnapshotById('99999999-9999-9999-9999-999999999999'),
    ).toBeNull()
  })
})

describe('restoreWhiteboardFromSnapshot', () => {
  it('replaces the live diagram with the snapshot payload, reusing original ids and preserving area membership (D3)', async () => {
    const whiteboardId = makeWhiteboardId()
    const { t1, t2, area } = await seedDiagram(whiteboardId)
    const payload = await captureWhiteboardState(whiteboardId)

    // Mutate live state after capture.
    await createDiagramTable({ whiteboardId, name: 'extra_table' })

    await restoreWhiteboardFromSnapshot(whiteboardId, payload)

    const tables = await findDiagramTablesByWhiteboardId(whiteboardId)
    expect(tables.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort())
    expect(tables.some((t) => t.name === 'extra_table')).toBe(false)

    const restoredArea = await findAreaById(area.id)
    expect(restoredArea?.memberTableIds.slice().sort()).toEqual(
      [t1.id, t2.id].sort(),
    )

    const areas = await findAreasByWhiteboard(whiteboardId)
    expect(areas).toHaveLength(1)
  })

  it('restores whiteboard scalars (name, canvasState, textSource)', async () => {
    const whiteboardId = makeWhiteboardId()
    const payload = await captureWhiteboardState(whiteboardId)
    payload.whiteboard.name = 'Renamed Board'
    payload.whiteboard.textSource = 'erDiagram\n  users'

    await restoreWhiteboardFromSnapshot(whiteboardId, payload)

    const db = (await import('@/db')).db
    const row = db
      .prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?')
      .get(whiteboardId) as any
    expect(row.name).toBe('Renamed Board')
    expect(row.textSource).toBe('erDiagram\n  users')
  })

  it('leaves the live diagram completely unchanged when a write fails partway through (AC8)', async () => {
    const whiteboardId = makeWhiteboardId()
    const { t1, t2 } = await seedDiagram(whiteboardId)
    const payload = await captureWhiteboardState(whiteboardId)

    ;(globalThis as any).__FORCE_INSERT_FAIL_TABLE__ = 'Relationship'

    await expect(
      restoreWhiteboardFromSnapshot(whiteboardId, payload),
    ).rejects.toThrow('Simulated write failure')

    delete (globalThis as any).__FORCE_INSERT_FAIL_TABLE__

    // Original diagram must be completely intact — not half-wiped, even
    // though DELETE + table/column inserts ran before the forced failure.
    const tables = await findDiagramTablesByWhiteboardId(whiteboardId)
    expect(tables.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort())
  })
})

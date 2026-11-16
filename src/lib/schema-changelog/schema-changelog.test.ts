// src/lib/schema-changelog/schema-changelog.test.ts
// Every data write function records its SchemaChangeEvent in the same
// transaction as the write. Runs against the in-memory database.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  SYSTEM,
  acceptBatchId,
  diffFields,
  recordChange,
  splitCategory,
  userContext,
  withBatch,
} from './index'
import type { ActorContext } from './index'
import {
  createArea,
  deleteArea,
  moveAreaAndMembers,
  removeTableFromAreas,
  updateArea,
} from '@/data/area'
import {
  createColumn,
  createColumns,
  deleteColumn,
  duplicateColumn,
  reorderColumns,
  updateColumn,
  updateColumnOrder,
} from '@/data/column'
import {
  createDiagramTable,
  deleteDiagramTable,
  initDiagramTablePosition,
  updateDiagramTable,
  updateDiagramTablePosition,
} from '@/data/diagram-table'
import {
  createRelationship,
  deleteRelationship,
  updateRelationship,
} from '@/data/relationship'
import {
  createTableReference,
  deleteTableReference,
  updateTableReference,
} from '@/data/table-reference'
import { db } from '@/db'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

interface EventRow {
  id: string
  whiteboardId: string
  batchId: string | null
  batchKind: string | null
  actorUserId: string | null
  actorName: string
  viaAgent: number
  category: string
  entityType: string
  action: string
  entityId: string
  entityName: string | null
  tableId: string | null
  tableName: string | null
  before: string | null
  after: string | null
}

function events(whiteboardId?: string): Array<EventRow> {
  const sql = whiteboardId
    ? 'SELECT * FROM "SchemaChangeEvent" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC, rowid ASC'
    : 'SELECT * FROM "SchemaChangeEvent" ORDER BY "createdAt" ASC, rowid ASC'
  const stmt = db.prepare(sql)
  return (whiteboardId
    ? stmt.all(whiteboardId)
    : stmt.all()) as unknown as Array<EventRow>
}

const json = (v: string | null): unknown => (v === null ? null : JSON.parse(v))

interface Fixture {
  ctx: ActorContext
  whiteboardId: string
  userId: string
}

let userCounter = 0

function setup(viaAgent = false): Fixture {
  const user = makeUser({ username: `ada${++userCounter}` })
  const project = makeProject({ ownerId: user.id })
  const whiteboardId = makeWhiteboard({ projectId: project.id }).id
  return {
    ctx: userContext(whiteboardId, user.id, { viaAgent }),
    whiteboardId,
    userId: user.id,
  }
}

beforeEach(() => resetDb())

describe('helpers', () => {
  it('recordChange writes nothing for SYSTEM', () => {
    recordChange(SYSTEM, {
      category: 'schema',
      entityType: 'table',
      action: 'create',
      entityId: 'x',
    })
    expect(events()).toHaveLength(0)
  })

  it('diffFields returns only the changed keys', () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b'])).toEqual({
      before: { b: 2 },
      after: { b: 3 },
    })
    expect(diffFields({ a: 1 }, { a: 1 }, ['a'])).toBeNull()
  })

  it('splitCategory puts position and size in layout', () => {
    const split = splitCategory({
      before: { name: 'a', positionX: 1, height: 2 },
      after: { name: 'b', positionX: 5, height: 9 },
    })
    expect(Object.keys(split.schema!.after)).toEqual(['name'])
    expect(Object.keys(split.layout!.after)).toEqual(['positionX', 'height'])
  })

  it('userContext stores a null actor id for a user that does not exist', () => {
    const ctx = userContext('wb', 'no-such-user')
    expect(ctx.actorUserId).toBeNull()
    expect(ctx.actorName).toBe('Unknown user')
  })

  it('acceptBatchId refuses a batch another user owns', async () => {
    const a = setup()
    const b = setup()
    await createDiagramTable(
      { whiteboardId: a.whiteboardId, name: 't' },
      withBatch(a.ctx, 'batch-1', 'sql-import'),
    )
    expect(acceptBatchId(b.ctx, 'batch-1', 'agent-batch')).toBe(b.ctx)
    const same = acceptBatchId(a.ctx, 'batch-1', 'agent-batch') as ActorContext
    expect(same.batchId).toBe('batch-1')
  })
})

describe('tables', () => {
  it('logs a create with the actor and the full row', async () => {
    const { ctx, whiteboardId, userId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    const [event] = events(whiteboardId)
    expect(event).toMatchObject({
      actorUserId: userId,
      actorName: expect.stringMatching(/^ada\d+$/),
      viaAgent: 0,
      category: 'schema',
      entityType: 'table',
      action: 'create',
      entityId: table.id,
      tableName: 'Users',
    })
    expect(json(event.after)).toMatchObject({ name: 'Users' })
  })

  it('marks events from an agent socket', async () => {
    const { ctx, whiteboardId } = setup(true)
    await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    expect(events()[0].viaAgent).toBe(1)
  })

  it('logs a rename and a move as one schema and one layout event', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    await updateDiagramTable(
      table.id,
      { name: 'Accounts', positionX: 40, positionY: 50 },
      ctx,
    )
    const [, schema, layout] = events(whiteboardId)
    expect(schema).toMatchObject({ category: 'schema', action: 'update' })
    expect(json(schema.before)).toEqual({ name: 'Users' })
    expect(json(schema.after)).toEqual({ name: 'Accounts' })
    expect(layout).toMatchObject({ category: 'layout', action: 'move' })
    expect(json(layout.after)).toEqual({ positionX: 40, positionY: 50 })
  })

  it('logs a resize as layout and writes nothing for an update that changes nothing', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    await updateDiagramTable(table.id, { width: 300 }, ctx)
    await updateDiagramTable(table.id, { name: 'Users' }, ctx)
    const all = events(whiteboardId)
    expect(all).toHaveLength(2)
    expect(all[1]).toMatchObject({ category: 'layout', action: 'resize' })
  })

  it('logs updateDiagramTablePosition as a layout move', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable(
      { whiteboardId, name: 'Users', positionX: 1, positionY: 1 },
      ctx,
    )
    await updateDiagramTablePosition(table.id, 9, 8, ctx)
    expect(events(whiteboardId)[1]).toMatchObject({
      category: 'layout',
      action: 'move',
    })
  })

  it('does not log initDiagramTablePosition under SYSTEM', async () => {
    const { whiteboardId } = setup()
    const { id } = makeTable({ whiteboardId, name: 'T' })
    db.prepare(
      'UPDATE "DiagramTable" SET "positionX" = NULL WHERE "id" = ?',
    ).run(id)
    const result = await initDiagramTablePosition(id, 5, 6, SYSTEM)
    expect(result.changes).toBe(1)
    expect(events()).toHaveLength(0)
  })

  it('rolls the write back when the event cannot be recorded', async () => {
    const { ctx, whiteboardId } = setup()
    const broken: ActorContext = { ...ctx, whiteboardId: 'no-such-board' }
    await expect(
      createDiagramTable({ whiteboardId, name: 'Users' }, broken),
    ).rejects.toThrow()
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM "DiagramTable"').get(),
    ).toEqual({ n: 0 })
  })

  it('logs a table delete with its columns and relationships in one batch', async () => {
    const { ctx, whiteboardId } = setup()
    const users = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    const orders = await createDiagramTable(
      { whiteboardId, name: 'Orders' },
      ctx,
    )
    const uid = await createColumn(
      { tableId: users.id, name: 'id', dataType: 'uuid' },
      ctx,
    )
    const oid = await createColumn(
      { tableId: orders.id, name: 'user_id', dataType: 'uuid' },
      ctx,
    )
    await createRelationship(
      {
        whiteboardId,
        sourceTableId: orders.id,
        targetTableId: users.id,
        sourceColumnId: oid.id,
        targetColumnId: uid.id,
        cardinality: 'MANY_TO_ONE',
      },
      ctx,
    )
    const before = events(whiteboardId).length
    await deleteDiagramTable(users.id, ctx)
    const added = events(whiteboardId).slice(before)
    expect(added.map((e) => `${e.entityType}:${e.action}`).sort()).toEqual([
      'column:delete',
      'relationship:delete',
      'table:delete',
    ])
    const batchIds = new Set(added.map((e) => e.batchId))
    expect(batchIds.size).toBe(1)
    expect([...batchIds][0]).toBeTruthy()
    expect(new Set(added.map((e) => e.batchKind))).toEqual(
      new Set(['table-delete']),
    )
    expect(added.every((e) => e.tableName === 'Users')).toBe(true)
  })

  it('keeps the event after the table is deleted', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    await deleteDiagramTable(table.id, ctx)
    const rows = events(whiteboardId)
    expect(rows.map((e) => e.action)).toEqual(['create', 'delete'])
    expect(rows[1].entityName).toBe('Users')
  })
})

describe('columns', () => {
  it('logs create, update, reorder and delete', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    const column = await createColumn(
      { tableId: table.id, name: 'mail', dataType: 'string' },
      ctx,
    )
    await updateColumn(column.id, { name: 'email' }, ctx)
    await updateColumnOrder(column.id, 3, ctx)
    await deleteColumn(column.id, ctx)
    const rows = events(whiteboardId).filter((e) => e.entityType === 'column')
    expect(rows.map((e) => e.action)).toEqual([
      'create',
      'update',
      'reorder',
      'delete',
    ])
    expect(json(rows[1].before)).toEqual({ name: 'mail' })
    expect(json(rows[1].after)).toEqual({ name: 'email' })
    expect(rows[1].tableName).toBe('Users')
  })

  it('logs one event per column of a batch create and a reorder', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    const created = await createColumns(
      [
        { tableId: table.id, name: 'a', dataType: 'string', order: 0 },
        { tableId: table.id, name: 'b', dataType: 'string', order: 1 },
      ],
      ctx,
    )
    expect(
      events(whiteboardId).filter((e) => e.action === 'create'),
    ).toHaveLength(3)
    await reorderColumns(table.id, [created[1].id, created[0].id], ctx)
    const reorders = events(whiteboardId).filter((e) => e.action === 'reorder')
    expect(reorders).toHaveLength(2)
  })

  it('logs a duplicate as a create', async () => {
    const { ctx, whiteboardId } = setup()
    const table = await createDiagramTable({ whiteboardId, name: 'Users' }, ctx)
    const column = await createColumn(
      { tableId: table.id, name: 'id', dataType: 'uuid' },
      ctx,
    )
    const copy = await duplicateColumn(column.id, ctx)
    const last = events(whiteboardId).at(-1)!
    expect(last).toMatchObject({ action: 'create', entityId: copy.id })
  })

  it('rolls a column create back when the event cannot be recorded', async () => {
    const { ctx, whiteboardId } = setup()
    const { id: tableId } = makeTable({ whiteboardId, name: 'T' })
    const broken: ActorContext = { ...ctx, whiteboardId: 'no-such-board' }
    await expect(
      createColumn({ tableId, name: 'x', dataType: 'string' }, broken),
    ).rejects.toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM "Column"').get()).toEqual({
      n: 0,
    })
  })
})

describe('relationships', () => {
  it('logs create, update and delete with a readable name', async () => {
    const { ctx, whiteboardId } = setup()
    const a = makeTable({ whiteboardId, name: 'Orders' })
    const b = makeTable({ whiteboardId, name: 'Users' })
    const ac = makeColumn({ tableId: a.id, name: 'user_id' })
    const bc = makeColumn({ tableId: b.id, name: 'id' })
    const rel = await createRelationship(
      {
        whiteboardId,
        sourceTableId: a.id,
        targetTableId: b.id,
        sourceColumnId: ac.id,
        targetColumnId: bc.id,
        cardinality: 'MANY_TO_ONE',
      },
      ctx,
    )
    await updateRelationship(rel.id, { cardinality: 'ONE_TO_ONE' }, ctx)
    await deleteRelationship(rel.id, ctx)
    const rows = events(whiteboardId)
    expect(rows.map((e) => e.action)).toEqual(['create', 'update', 'delete'])
    expect(rows[0].entityName).toBe('Orders.user_id -> Users.id')
    expect(json(rows[1].after)).toEqual({ cardinality: 'ONE_TO_ONE' })
  })
})

describe('areas', () => {
  const base = (whiteboardId: string) => ({
    whiteboardId,
    name: 'Billing',
    color: 'blue',
    positionX: 0,
    positionY: 0,
    width: 400,
    height: 300,
  })

  it('logs create, rename, move and delete', async () => {
    const { ctx, whiteboardId } = setup()
    const area = await createArea(base(whiteboardId), ctx)
    await updateArea(area.id, { name: 'Payments' }, ctx)
    await updateArea(area.id, { positionX: 9 }, ctx)
    await deleteArea(area.id, ctx)
    const rows = events(whiteboardId)
    expect(rows.map((e) => `${e.category}:${e.action}`)).toEqual([
      'schema:create',
      'schema:update',
      'layout:move',
      'schema:delete',
    ])
  })

  it('shares one batch between an area move and its member tables', async () => {
    const { ctx, whiteboardId } = setup()
    const t = makeTable({ whiteboardId, name: 'T' })
    const area = await createArea(
      { ...base(whiteboardId), memberTableIds: [t.id] },
      ctx,
    )
    await moveAreaAndMembers(
      area.id,
      { positionX: 50, positionY: 60 },
      [{ tableId: t.id, positionX: 70, positionY: 80 }],
      ctx,
    )
    const moves = events(whiteboardId).filter((e) => e.action === 'move')
    expect(moves.map((e) => e.entityType).sort()).toEqual(['area', 'table'])
    expect(new Set(moves.map((e) => e.batchId)).size).toBe(1)
    expect(moves[0].batchKind).toBe('area-move')
  })

  it('logs the membership change a table delete causes', async () => {
    const { ctx, whiteboardId } = setup()
    const t = makeTable({ whiteboardId, name: 'T' })
    const area = await createArea(
      { ...base(whiteboardId), memberTableIds: [t.id] },
      ctx,
    )
    await removeTableFromAreas(whiteboardId, t.id, ctx)
    const last = events(whiteboardId).at(-1)!
    expect(last).toMatchObject({
      entityType: 'area',
      action: 'update',
      entityId: area.id,
    })
  })
})

describe('table references', () => {
  it('logs create, update and delete of a reference', async () => {
    const { ctx, whiteboardId } = setup()
    const projectId = (
      db
        .prepare('SELECT "projectId" FROM "Whiteboard" WHERE "id" = ?')
        .get(whiteboardId) as { projectId: string }
    ).projectId
    const source = makeWhiteboard({ projectId, name: 'Billing' })
    const sourceTable = makeTable({ whiteboardId: source.id, name: 'orders' })
    const c1 = makeColumn({ tableId: sourceTable.id, name: 'id', order: 0 })
    const c2 = makeColumn({ tableId: sourceTable.id, name: 'total', order: 1 })

    const ref = await createTableReference(
      {
        whiteboardId,
        sourceWhiteboardId: source.id,
        sourceTableId: sourceTable.id,
        sourceColumnIds: [c1.id],
      },
      ctx,
    )
    await updateTableReference(
      ref.table.id,
      { sourceColumnIds: [c1.id, c2.id] },
      ctx,
    )
    await deleteTableReference(ref.table.id, ctx)
    const rows = events(whiteboardId)
    expect(rows.map((e) => `${e.entityType}:${e.action}`)).toEqual([
      'reference:create',
      'reference:update',
      'reference:delete',
    ])
    expect(json(rows[0].after)).toMatchObject({ columns: ['id'] })
  })
})

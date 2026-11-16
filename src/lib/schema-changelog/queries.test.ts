// @vitest-environment node
// src/lib/schema-changelog/queries.test.ts
// Read API of the change log: paging, batch collapse, filters, facets and the
// VIEWER+ gate. Runs against the in-memory database.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  getSchemaChangeBatchHandler,
  listChangeLogFacetsHandler,
  listSchemaChangesHandler,
} from './handlers'
import { recordChange, userContext } from './index'
import type { ActorContext } from './index'
import type { AuthContext } from '@/lib/auth/middleware'
import { ForbiddenError } from '@/lib/auth/require-role'
import { upsertProjectMember } from '@/data/permission'
import { db } from '@/db'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

function authFor(userId: string): AuthContext {
  return {
    user: { id: userId, username: 'u', email: 'u@example.com' },
    session: { id: 's', expiresAt: new Date(Date.now() + 3_600_000) },
  }
}

function setup() {
  const owner = makeUser({ username: 'alice' })
  const bob = makeUser({ username: 'bob' })
  const project = makeProject({ ownerId: owner.id })
  const wb = makeWhiteboard({ projectId: project.id })
  return { owner, bob, project, wb }
}

/** Insert an event with an explicit time, so ordering and ranges are exact. */
function log(
  ctx: ActorContext,
  at: number,
  fields: Partial<Parameters<typeof recordChange>[1]> = {},
) {
  recordChange(ctx, {
    category: 'schema',
    entityType: 'column',
    action: 'update',
    entityId: 'e',
    entityName: 'col',
    tableId: 't1',
    tableName: 'users',
    before: { name: 'mail' },
    after: { name: 'email' },
    ...fields,
  })
  db.prepare(
    'UPDATE "SchemaChangeEvent" SET "createdAt" = ? WHERE "rowid" = (SELECT MAX("rowid") FROM "SchemaChangeEvent")',
  ).run(at)
}

/** A context placed in a batch. */
function inBatch(
  ctx: ActorContext,
  batchId: string,
  batchKind: NonNullable<ActorContext['batchKind']>,
): ActorContext {
  return { ...ctx, batchId, batchKind }
}

beforeEach(() => resetDb())

describe('listSchemaChangesHandler', () => {
  it('lists newest first and pages by cursor', async () => {
    const { owner, wb } = setup()
    const ctx = userContext(wb.id, owner.id)
    for (let i = 0; i < 5; i++)
      log(ctx, 1000 + i, { entityId: `c${i}`, entityName: `col${i}` })

    const first = await listSchemaChangesHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      limit: 2,
      includeLayout: false,
    })
    expect(
      first.items.map((i) => i.kind === 'event' && i.event.entityName),
    ).toEqual(['col4', 'col3'])
    expect(first.nextCursor).not.toBeNull()

    const second = await listSchemaChangesHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      limit: 5,
      cursor: first.nextCursor!,
      includeLayout: false,
    })
    expect(
      second.items.map((i) => i.kind === 'event' && i.event.entityName),
    ).toEqual(['col2', 'col1', 'col0'])
    expect(second.nextCursor).toBeNull()
  })

  it('breaks a createdAt tie by insertion order', async () => {
    const { owner, wb } = setup()
    const ctx = userContext(wb.id, owner.id)
    log(ctx, 5000, { entityName: 'first' })
    log(ctx, 5000, { entityName: 'second' })
    const res = await listSchemaChangesHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      limit: 10,
      includeLayout: false,
    })
    expect(
      res.items.map((i) => i.kind === 'event' && i.event.entityName),
    ).toEqual(['second', 'first'])
  })

  it('collapses a batch to one summary row with counts', async () => {
    const { owner, wb } = setup()
    const batch = inBatch(userContext(wb.id, owner.id), 'b1', 'sql-import')
    log(batch, 100, { entityType: 'table', action: 'create', entityName: 'a' })
    log(batch, 101, { entityType: 'table', action: 'create', entityName: 'b' })
    log(batch, 102, { entityType: 'column', action: 'create', entityName: 'c' })
    log(userContext(wb.id, owner.id), 50, { entityName: 'single' })

    const res = await listSchemaChangesHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      limit: 10,
      includeLayout: false,
    })
    expect(res.items).toHaveLength(2)
    const [top, bottom] = res.items
    expect(top.kind).toBe('batch')
    if (top.kind === 'batch') {
      expect(top.batch).toMatchObject({
        batchId: 'b1',
        batchKind: 'sql-import',
        total: 3,
        actorName: 'alice',
        createdAt: 102,
      })
      expect(top.batch.counts).toEqual(
        expect.arrayContaining([
          { entityType: 'table', action: 'create', count: 2 },
          { entityType: 'column', action: 'create', count: 1 },
        ]),
      )
    }
    expect(bottom.kind).toBe('event')
  })

  it('hides layout events until includeLayout is set', async () => {
    const { owner, wb } = setup()
    const ctx = userContext(wb.id, owner.id)
    log(ctx, 10, { entityName: 'renamed' })
    log(ctx, 20, {
      category: 'layout',
      entityType: 'table',
      action: 'move',
      entityName: 'moved',
    })
    const base = { whiteboardId: wb.id, limit: 10 }
    const hidden = await listSchemaChangesHandler(authFor(owner.id), {
      ...base,
      includeLayout: false,
    })
    const shown = await listSchemaChangesHandler(authFor(owner.id), {
      ...base,
      includeLayout: true,
    })
    expect(hidden.items).toHaveLength(1)
    expect(shown.items).toHaveLength(2)
  })

  it('filters by table, person, agent, date range and text', async () => {
    const { owner, bob, wb } = setup()
    const alice = userContext(wb.id, owner.id)
    const bobCtx = userContext(wb.id, bob.id)
    const agent = userContext(wb.id, owner.id, { viaAgent: true })
    log(alice, 100, {
      tableName: 'users',
      entityName: 'mail',
      before: { note: 'left' },
      after: { note: 'right' },
    })
    log(bobCtx, 200, {
      tableName: 'orders',
      entityName: 'total',
      before: { note: 'x' },
      after: { note: 'y' },
    })
    log(agent, 300, {
      tableName: 'orders',
      entityName: 'status',
      before: { note: 'p' },
      after: { note: 'q' },
    })
    const run = async (filters: object) =>
      (
        await listSchemaChangesHandler(authFor(owner.id), {
          whiteboardId: wb.id,
          limit: 10,
          includeLayout: false,
          ...filters,
        })
      ).items.map((i) => (i.kind === 'event' ? i.event.entityName : '?'))

    expect(await run({ tableName: 'orders' })).toEqual(['status', 'total'])
    expect(await run({ actorUserId: bob.id })).toEqual(['total'])
    expect(await run({ viaAgent: true })).toEqual(['status'])
    expect(await run({ from: 150, to: 250 })).toEqual(['total'])
    expect(await run({ q: 'MAIL' })).toEqual(['mail'])
    expect(await run({ q: 'bob' })).toEqual(['total'])
    expect(await run({ q: 'right' })).toEqual(['mail'])
    expect(await run({ q: '100%' })).toEqual([])
  })

  it('returns only the requested whiteboard', async () => {
    const { owner, project, wb } = setup()
    const other = makeWhiteboard({ projectId: project.id })
    log(userContext(other.id, owner.id), 10, { entityName: 'elsewhere' })
    const res = await listSchemaChangesHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      limit: 10,
      includeLayout: false,
    })
    expect(res.items).toEqual([])
  })

  it('restore batch carries the restored version from its marker', async () => {
    const { owner, wb } = setup()
    const ctx = inBatch(userContext(wb.id, owner.id), 'r1', 'restore')
    log(ctx, 10, { entityName: 'gone', action: 'delete' })
    log(ctx, 11, {
      entityType: 'board',
      tableId: null,
      tableName: null,
      entityName: 'v1',
      before: null,
      after: {
        restoredVersion: {
          snapshotId: 's1',
          label: 'v1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    const res = await listSchemaChangesHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      limit: 10,
      includeLayout: false,
    })
    const item = res.items[0]
    expect(item.kind === 'batch' && item.batch.restoredVersion).toEqual({
      snapshotId: 's1',
      label: 'v1',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('refuses a user with no role on the project', async () => {
    const { wb } = setup()
    const stranger = makeUser()
    await expect(
      listSchemaChangesHandler(authFor(stranger.id), {
        whiteboardId: wb.id,
        limit: 10,
        includeLayout: false,
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('lets a VIEWER read', async () => {
    const { owner, project, wb } = setup()
    const viewer = makeUser()
    await upsertProjectMember({
      projectId: project.id,
      userId: viewer.id,
      role: 'VIEWER',
    })
    log(userContext(wb.id, owner.id), 10)
    const res = await listSchemaChangesHandler(authFor(viewer.id), {
      whiteboardId: wb.id,
      limit: 10,
      includeLayout: false,
    })
    expect(res.items).toHaveLength(1)
  })
})

describe('getSchemaChangeBatchHandler', () => {
  it('returns batch items in order and pages by cursor', async () => {
    const { owner, wb } = setup()
    const batch = inBatch(userContext(wb.id, owner.id), 'b1', 'sql-import')
    for (let i = 0; i < 5; i++) log(batch, 10 + i, { entityName: `n${i}` })
    log(userContext(wb.id, owner.id), 99, { entityName: 'outside' })

    const first = await getSchemaChangeBatchHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      batchId: 'b1',
      limit: 3,
      includeLayout: false,
    })
    expect(first.events.map((e) => e.entityName)).toEqual(['n0', 'n1', 'n2'])
    expect(first.nextCursor).not.toBeNull()
    const second = await getSchemaChangeBatchHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      batchId: 'b1',
      limit: 3,
      cursor: first.nextCursor!,
      includeLayout: false,
    })
    expect(second.events.map((e) => e.entityName)).toEqual(['n3', 'n4'])
    expect(second.nextCursor).toBeNull()
  })

  it('does not return a batch of another whiteboard', async () => {
    const { owner, project, wb } = setup()
    const other = makeWhiteboard({ projectId: project.id })
    log(inBatch(userContext(other.id, owner.id), 'b9', 'sql-import'), 10)
    const res = await getSchemaChangeBatchHandler(authFor(owner.id), {
      whiteboardId: wb.id,
      batchId: 'b9',
      limit: 10,
      includeLayout: false,
    })
    expect(res.events).toEqual([])
  })
})

describe('listChangeLogFacetsHandler', () => {
  it('lists table names, people and whether an agent edited', async () => {
    const { owner, bob, wb } = setup()
    log(userContext(wb.id, owner.id), 1, { tableName: 'users' })
    log(userContext(wb.id, bob.id), 2, { tableName: 'orders' })
    log(userContext(wb.id, owner.id, { viaAgent: true }), 3, {
      tableName: 'orders',
    })
    log(userContext(wb.id, owner.id), 4, { tableName: null })
    const facets = await listChangeLogFacetsHandler(authFor(owner.id), {
      whiteboardId: wb.id,
    })
    expect(facets.tables).toEqual(['orders', 'users'])
    expect(facets.actors.map((a) => a.name).sort()).toEqual(['alice', 'bob'])
    expect(facets.hasAgentEdits).toBe(true)
  })
})

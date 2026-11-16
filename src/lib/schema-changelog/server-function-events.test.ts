// @vitest-environment node
// src/lib/schema-changelog/server-function-events.test.ts
// The server functions that write a table, column, position or table reference
// build a ChangeContext from the session user. Each test calls the real
// server function against the in-memory database and reads the event row.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// createServerFn needs the Start runtime; this stand-in runs validator then
// handler in process, so each test calls the real handler body.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      validator(fn: (data: unknown) => unknown) {
        validate = fn
        return builder
      },
      handler(fn: (input: { data: unknown }) => unknown) {
        return ({ data }: { data: unknown }) => fn({ data: validate(data) })
      },
    }
    return builder
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
}))

vi.mock('@/lib/auth/cookies', () => ({
  getSessionFromCookie: vi.fn(),
}))

// eslint-disable-next-line import/first
import { getSessionFromCookie } from '@/lib/auth/cookies'
// eslint-disable-next-line import/first
import {
  createColumnFn,
  createColumnsFn,
  deleteColumnFn,
  updateColumnFn,
  updateColumnOrderFn,
} from '@/routes/api/columns'
// eslint-disable-next-line import/first
import {
  createTableReferenceFn,
  deleteTableReferenceFn,
  updateTablePosition,
  updateTablePositionsBulk,
  updateTableReferenceFn,
} from '@/lib/server-functions'
// eslint-disable-next-line import/first
import { db } from '@/db'
// eslint-disable-next-line import/first
import {
  makeColumn,
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

interface EventRow {
  entityType: string
  action: string
  category: string
  entityName: string | null
  tableName: string | null
  actorName: string
  actorUserId: string | null
  whiteboardId: string
  batchId: string | null
  batchKind: string | null
  viaAgent: number
}

function events(): Array<EventRow> {
  return db
    .prepare('SELECT * FROM "SchemaChangeEvent" ORDER BY "createdAt", "rowid"')
    .all() as unknown as Array<EventRow>
}

async function setup() {
  const user = makeUser({ username: 'sf_editor' })
  const project = makeProject({ ownerId: user.id })
  const wb = makeWhiteboard({ projectId: project.id })
  const other = makeWhiteboard({ projectId: project.id, name: 'Other' })
  const table = makeTable({ whiteboardId: wb.id, name: 'accounts' })
  const column = makeColumn({ tableId: table.id, name: 'mail' })
  vi.mocked(getSessionFromCookie).mockResolvedValue({
    user: { id: user.id, username: 'sf_editor', email: 'x@example.com' },
    session: {
      id: 's',
      tokenHash: 'h',
      userId: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    },
  } as never)
  return { user, project, wb, other, table, column }
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
})

describe('column server functions record an event as the session user', () => {
  it('createColumnFn', async () => {
    const { user, wb, table } = await setup()
    await createColumnFn({
      data: { tableId: table.id, name: 'phone', dataType: 'string', order: 1 },
    })
    expect(events()).toMatchObject([
      {
        entityType: 'column',
        action: 'create',
        entityName: 'phone',
        tableName: 'accounts',
        actorName: 'sf_editor',
        actorUserId: user.id,
        whiteboardId: wb.id,
        viaAgent: 0,
      },
    ])
  })

  it('createColumnsFn logs one event per column, in the client batch', async () => {
    const { wb, table } = await setup()
    await createColumnsFn({
      data: {
        batchId: 'import-batch-1',
        batchKind: 'sql-import',
        columns: [
          { tableId: table.id, name: 'a', dataType: 'string', order: 1 },
          { tableId: table.id, name: 'b', dataType: 'string', order: 2 },
        ],
      },
    })
    const rows = events()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.whiteboardId === wb.id)).toBe(true)
    expect(rows.every((r) => r.batchId === 'import-batch-1')).toBe(true)
    expect(rows.every((r) => r.batchKind === 'sql-import')).toBe(true)
  })

  it('updateColumnFn', async () => {
    const { column } = await setup()
    await updateColumnFn({
      data: { id: column.id, data: { name: 'email' } },
    })
    expect(events()).toMatchObject([
      {
        entityType: 'column',
        action: 'update',
        entityName: 'email',
        tableName: 'accounts',
        actorName: 'sf_editor',
      },
    ])
  })

  it('updateColumnOrderFn', async () => {
    const { column } = await setup()
    await updateColumnOrderFn({ data: { id: column.id, order: 5 } })
    expect(events()).toMatchObject([
      { entityType: 'column', action: 'reorder', actorName: 'sf_editor' },
    ])
  })

  it('deleteColumnFn', async () => {
    const { column } = await setup()
    await deleteColumnFn({ data: column.id })
    expect(events()).toMatchObject([
      {
        entityType: 'column',
        action: 'delete',
        entityName: 'mail',
        tableName: 'accounts',
        actorName: 'sf_editor',
      },
    ])
  })
})

describe('position server functions record layout events', () => {
  it('updateTablePosition', async () => {
    const { table, wb } = await setup()
    await updateTablePosition({
      data: { id: table.id, positionX: 120, positionY: 80 },
    })
    expect(events()).toMatchObject([
      {
        entityType: 'table',
        action: 'move',
        category: 'layout',
        tableName: 'accounts',
        actorName: 'sf_editor',
        whiteboardId: wb.id,
      },
    ])
  })

  it('updateTablePositionsBulk shares one batch of the caller kind', async () => {
    const { table, wb } = await setup()
    const second = makeTable({ whiteboardId: wb.id, name: 'orders' })
    await updateTablePositionsBulk({
      data: {
        whiteboardId: wb.id,
        batchKind: 'auto-layout',
        positions: [
          { id: table.id, positionX: 10, positionY: 20 },
          { id: second.id, positionX: 30, positionY: 40 },
        ],
      },
    } as never)
    const rows = events()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1)
    expect(rows[0].batchId).not.toBeNull()
    expect(rows.every((r) => r.batchKind === 'auto-layout')).toBe(true)
    expect(rows.every((r) => r.category === 'layout')).toBe(true)
  })
})

describe('table reference server functions record events', () => {
  it('create, update and delete', async () => {
    const { wb, other, table, column } = await setup()
    const idCol = makeColumn({ tableId: table.id, name: 'id', order: 2 })

    const created = (await createTableReferenceFn({
      data: {
        whiteboardId: other.id,
        sourceWhiteboardId: wb.id,
        sourceTableId: table.id,
        sourceColumnIds: [column.id],
      },
    })) as { table: { id: string } }
    await updateTableReferenceFn({
      data: { tableId: created.table.id, sourceColumnIds: [idCol.id] },
    })
    await deleteTableReferenceFn({
      data: { tableId: created.table.id },
    })

    const rows = events().filter((r) => r.entityType === 'reference')
    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'delete'])
    expect(rows.every((r) => r.actorName === 'sf_editor')).toBe(true)
    expect(rows.every((r) => r.whiteboardId === other.id)).toBe(true)
  })
})

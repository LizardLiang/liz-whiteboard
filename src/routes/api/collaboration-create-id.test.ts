// src/routes/api/collaboration-create-id.test.ts
// Client-supplied ids on the ER create handlers ("Creates Are Safe To
// Repeat"). Drives the REAL socket handlers registered by
// `setupCollaborationEventHandlers` against an in-memory SQLite database
// (DATABASE_URL=:memory:). Only the role check is mocked.
//
// For each create event:
//   - a new id is stored as the row's id
//   - an id a row on the SAME whiteboard already has is refused with
//     ALREADY_EXISTS and the stored row is unchanged
//   - an id a row on ANOTHER whiteboard has is refused with the generic
//     "Failed to create <noun>" failure, which names no id and no existence,
//     and the stored row is unchanged
//   - no id keeps today's behaviour: the server assigns a fresh id
//   - a non-UUID id is rejected with VALIDATION_ERROR and nothing is written

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCollaborationEventHandlers } from './collaboration'
import type * as RequireRoleModule from '@/lib/auth/require-role'
import { db } from '@/db'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'
import { createTableHandler } from '@/lib/diagram-table/handlers'
import { createRelationshipHandler } from '@/lib/diagram-relationship/handlers'
import { createTableReference } from '@/data/table-reference'
import { AlreadyExistsError } from '@/data/already-exists'

vi.mock('@/lib/auth/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof RequireRoleModule>()
  return {
    ...actual,
    requireRole: vi.fn().mockResolvedValue(false),
    requireServerFnRole: vi.fn().mockResolvedValue(undefined),
  }
})

const USER_ID = 'user-create-id'

type Ack = { ok: boolean; code?: string; message?: string; entity?: any }
type Handler = (data: unknown, cb?: (res: Ack) => void) => Promise<void>

function makeSocket(whiteboardId: string) {
  const handlers: Record<string, Handler> = {}
  const socket = {
    id: 'socket-create-id',
    data: { userId: USER_ID, sessionExpiresAt: Date.now() + 60_000 },
    on: (event: string, handler: Handler) => {
      handlers[event] = handler
    },
    emit: vi.fn(),
    broadcast: { emit: vi.fn() },
    disconnect: vi.fn(),
  }
  setupCollaborationEventHandlers(socket, whiteboardId, USER_ID)
  return { socket, handlers }
}

async function send(
  handlers: Record<string, Handler>,
  event: string,
  data: unknown,
): Promise<Ack> {
  let ack: Ack | undefined
  await handlers[event](data, (res) => {
    ack = res
  })
  if (!ack) throw new Error(`${event} sent no ack`)
  return ack
}

function row(table: string, id: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT * FROM "${table}" WHERE "id" = ?`).get(id)
}

function count(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS "n" FROM "${table}"`).get() as {
      n: number
    }
  ).n
}

interface Fixture {
  whiteboardId: string
  otherWhiteboardId: string
  tableId: string
  otherTableId: string
  sourceColumnId: string
  targetColumnId: string
  otherColumnId: string
}

function makeFixture(): Fixture {
  const project = makeProject()
  const whiteboardId = makeWhiteboard({ projectId: project.id }).id
  const otherWhiteboardId = makeWhiteboard({ projectId: project.id }).id
  const tableId = makeTable({ whiteboardId, name: 'orders' }).id
  const otherTableId = makeTable({
    whiteboardId: otherWhiteboardId,
    name: 'elsewhere',
  }).id
  const sourceColumnId = makeColumn({ tableId, name: 'user_id' }).id
  const targetColumnId = makeColumn({ tableId, name: 'id' }).id
  const otherColumnId = makeColumn({ tableId: otherTableId, name: 'x' }).id
  return {
    whiteboardId,
    otherWhiteboardId,
    tableId,
    otherTableId,
    sourceColumnId,
    targetColumnId,
    otherColumnId,
  }
}

interface CreateCase {
  event: string
  table: string
  /** The handler's generic failure text. */
  generic: string
  payload: (f: Fixture) => Record<string, unknown>
  /** The id of an existing row of `table` that lives on the OTHER whiteboard. */
  takenId: (f: Fixture) => string
  /** The id of an existing row of `table` on the caller's own whiteboard. */
  ownId: (f: Fixture) => string
}

function insertRelationship(f: Fixture, whiteboardId: string): string {
  const id = randomUUID()
  const ts = Date.now()
  const onMine = whiteboardId === f.whiteboardId
  const tableId = onMine ? f.tableId : f.otherTableId
  const columnId = onMine ? f.sourceColumnId : f.otherColumnId
  db.prepare(
    'INSERT INTO "Relationship" ("id","whiteboardId","sourceTableId","targetTableId","sourceColumnId","targetColumnId","cardinality","label","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(id, whiteboardId, tableId, tableId, columnId, columnId, 'ONE_TO_ONE', 'theirs', ts, ts)
  return id
}

function insertArea(whiteboardId: string): string {
  const id = randomUUID()
  const ts = Date.now()
  db.prepare(
    'INSERT INTO "Area" ("id","whiteboardId","name","color","positionX","positionY","width","height","memberTableIds","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, whiteboardId, 'Theirs', 'red', 5, 5, 50, 50, '[]', ts, ts)
  return id
}

const CASES: Array<CreateCase> = [
  {
    event: 'table:create',
    table: 'DiagramTable',
    generic: 'Failed to create table',
    payload: () => ({ name: 'customers', positionX: 1, positionY: 2 }),
    takenId: (f) => f.otherTableId,
    ownId: (f) => f.tableId,
  },
  {
    event: 'column:create',
    table: 'Column',
    generic: 'Failed to create column',
    payload: (f) => ({ tableId: f.tableId, name: 'email', dataType: 'string' }),
    takenId: (f) => f.otherColumnId,
    ownId: (f) => f.sourceColumnId,
  },
  {
    event: 'relationship:create',
    table: 'Relationship',
    generic: 'Failed to create relationship',
    payload: (f) => ({
      sourceTableId: f.tableId,
      targetTableId: f.tableId,
      sourceColumnId: f.sourceColumnId,
      targetColumnId: f.targetColumnId,
      cardinality: 'MANY_TO_ONE',
    }),
    takenId: (f) => insertRelationship(f, f.otherWhiteboardId),
    ownId: (f) => insertRelationship(f, f.whiteboardId),
  },
  {
    event: 'area:create',
    table: 'Area',
    generic: 'Failed to create area',
    payload: () => ({
      name: 'Billing',
      color: 'blue',
      positionX: 0,
      positionY: 0,
      width: 300,
      height: 200,
    }),
    takenId: (f) => insertArea(f.otherWhiteboardId),
    ownId: (f) => insertArea(f.whiteboardId),
  },
]

beforeEach(() => {
  resetDb()
})

describe.each(CASES)('$event with a client id', (c) => {
  it('stores the row under the given id', async () => {
    const f = makeFixture()
    const { handlers } = makeSocket(f.whiteboardId)
    const id = randomUUID()

    const ack = await send(handlers, c.event, { ...c.payload(f), id })

    expect(ack).toMatchObject({ ok: true })
    expect(ack.entity.id).toBe(id)
    expect(row(c.table, id)).toBeDefined()
  })

  it('refuses an id on another whiteboard with the generic failure, revealing nothing', async () => {
    const f = makeFixture()
    const { handlers, socket } = makeSocket(f.whiteboardId)
    const takenId = c.takenId(f)
    const before = row(c.table, takenId)
    const rowsBefore = count(c.table)

    const ack = await send(handlers, c.event, { ...c.payload(f), id: takenId })

    expect(ack).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: c.generic,
    })
    const errorEvent = socket.emit.mock.calls.find(([e]) => e === 'error')
    expect(errorEvent?.[1]).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: c.generic,
    })
    expect(JSON.stringify(errorEvent?.[1])).not.toContain(takenId)
    expect(row(c.table, takenId)).toEqual(before)
    expect(count(c.table)).toBe(rowsBefore)
    expect(socket.broadcast.emit).not.toHaveBeenCalled()
  })

  it('refuses an id on its own whiteboard with ALREADY_EXISTS and leaves that row unchanged', async () => {
    const f = makeFixture()
    const { handlers, socket } = makeSocket(f.whiteboardId)
    const ownId = c.ownId(f)
    const before = row(c.table, ownId)
    const rowsBefore = count(c.table)

    const ack = await send(handlers, c.event, { ...c.payload(f), id: ownId })

    expect(ack).toMatchObject({ ok: false, code: 'ALREADY_EXISTS' })
    expect(row(c.table, ownId)).toEqual(before)
    expect(count(c.table)).toBe(rowsBefore)
    expect(socket.broadcast.emit).not.toHaveBeenCalled()
  })

  it('refuses a repeat of its own create (a re-sent create) without a second row', async () => {
    const f = makeFixture()
    const { handlers } = makeSocket(f.whiteboardId)
    const id = randomUUID()
    const payload = { ...c.payload(f), id }

    expect(await send(handlers, c.event, payload)).toMatchObject({ ok: true })
    const stored = row(c.table, id)
    const rowsAfterFirst = count(c.table)

    const again = await send(handlers, c.event, payload)

    expect(again).toMatchObject({ ok: false, code: 'ALREADY_EXISTS' })
    expect(row(c.table, id)).toEqual(stored)
    expect(count(c.table)).toBe(rowsAfterFirst)
  })

  it('assigns a fresh id when the create carries none', async () => {
    const f = makeFixture()
    const { handlers } = makeSocket(f.whiteboardId)

    const ack = await send(handlers, c.event, c.payload(f))

    expect(ack).toMatchObject({ ok: true })
    expect(ack.entity.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(row(c.table, ack.entity.id)).toBeDefined()
  })

  it('rejects a non-UUID id with VALIDATION_ERROR and writes nothing', async () => {
    const f = makeFixture()
    const { handlers } = makeSocket(f.whiteboardId)
    const rowsBefore = count(c.table)

    const ack = await send(handlers, c.event, {
      ...c.payload(f),
      id: 'not-a-uuid',
    })

    expect(ack).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(count(c.table)).toBe(rowsBefore)
    expect(row(c.table, 'not-a-uuid')).toBeUndefined()
  })
})

describe('a refused foreign id looks like any other failed create in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('table:create acks the same as a create that fails on a duplicate name', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const f = makeFixture()
    const { handlers } = makeSocket(f.whiteboardId)

    const foreign = await send(handlers, 'table:create', {
      name: 'fresh_name',
      id: f.otherTableId,
    })
    const duplicateName = await send(handlers, 'table:create', {
      name: 'orders',
    })

    expect(foreign).toEqual(duplicateName)
  })
})

describe('update schemas do not take an id', () => {
  it('table:update ignores an id in the payload', async () => {
    const f = makeFixture()
    const { handlers } = makeSocket(f.whiteboardId)
    const newId = randomUUID()

    const ack = await send(handlers, 'table:update', {
      tableId: f.tableId,
      id: newId,
      name: 'orders_renamed',
    })

    expect(ack).toMatchObject({ ok: true })
    expect(row('DiagramTable', f.tableId)?.name).toBe('orders_renamed')
    expect(row('DiagramTable', newId)).toBeUndefined()
  })
})

describe('server functions that share the create schemas', () => {
  const auth = { user: { id: USER_ID } } as any

  it('createTableHandler stores a new id and refuses a taken one', async () => {
    const f = makeFixture()
    const id = randomUUID()

    const created = await createTableHandler(auth, {
      id,
      whiteboardId: f.whiteboardId,
      name: 'invoices',
    })
    expect(created.id).toBe(id)

    const before = row('DiagramTable', f.otherTableId)
    const foreign = createTableHandler(auth, {
      id: f.otherTableId,
      whiteboardId: f.whiteboardId,
      name: 'stolen',
    })
    await expect(foreign).rejects.toThrow('Failed to create table')
    await expect(foreign).rejects.not.toThrow(/exist/i)
    expect(row('DiagramTable', f.otherTableId)).toEqual(before)

    await expect(
      createTableHandler(auth, {
        id,
        whiteboardId: f.whiteboardId,
        name: 'invoices_again',
      }),
    ).rejects.toThrow('already exists')
  })

  it('createRelationshipHandler refuses a taken id', async () => {
    const f = makeFixture()
    const relationship = (id: string) => ({
      id,
      whiteboardId: f.whiteboardId,
      sourceTableId: f.tableId,
      targetTableId: f.tableId,
      sourceColumnId: f.sourceColumnId,
      targetColumnId: f.targetColumnId,
      cardinality: 'MANY_TO_ONE' as const,
    })
    const takenId = CASES[2].takenId(f)
    const before = row('Relationship', takenId)

    const foreign = createRelationshipHandler(auth, relationship(takenId))
    await expect(foreign).rejects.toThrow('Failed to create relationship')
    await expect(foreign).rejects.not.toBeInstanceOf(AlreadyExistsError)
    expect(row('Relationship', takenId)).toEqual(before)

    await expect(
      createRelationshipHandler(auth, relationship(CASES[2].ownId(f))),
    ).rejects.toBeInstanceOf(AlreadyExistsError)
  })
})

describe('createTableReference with a client id', () => {
  it('stores the node under the given id and refuses a taken one', async () => {
    const f = makeFixture()
    const id = randomUUID()

    const reference = await createTableReference({
      id,
      whiteboardId: f.whiteboardId,
      sourceWhiteboardId: f.otherWhiteboardId,
      sourceTableId: f.otherTableId,
      sourceColumnIds: [f.otherColumnId],
    })
    expect(reference.table.id).toBe(id)

    const referenceWith = (refId: string) => ({
      id: refId,
      whiteboardId: f.whiteboardId,
      sourceWhiteboardId: f.otherWhiteboardId,
      sourceTableId: f.otherTableId,
      sourceColumnIds: [f.otherColumnId],
    })
    const before = row('DiagramTable', f.tableId)
    await expect(
      createTableReference(referenceWith(f.tableId)),
    ).rejects.toBeInstanceOf(AlreadyExistsError)
    expect(row('DiagramTable', f.tableId)).toEqual(before)

    const foreignBefore = row('DiagramTable', f.otherTableId)
    const foreign = createTableReference(referenceWith(f.otherTableId))
    await expect(foreign).rejects.toThrow('Failed to create table reference')
    await expect(foreign).rejects.not.toBeInstanceOf(AlreadyExistsError)
    expect(row('DiagramTable', f.otherTableId)).toEqual(foreignBefore)
  })
})

// src/routes/api/collaboration-create-id.test.ts
// Client-supplied ids on the ER create handlers ("Creates Are Safe To
// Repeat"). Drives the REAL socket handlers registered by
// `setupCollaborationEventHandlers` against an in-memory SQLite database
// (DATABASE_URL=:memory:). Only the role check is mocked.
//
// For each create event:
//   - a new id is stored as the row's id
//   - an id some row already has (on another whiteboard) is refused with
//     ALREADY_EXISTS and the stored row is unchanged
//   - no id keeps today's behaviour: the server assigns a fresh id
//   - a non-UUID id is rejected with VALIDATION_ERROR and nothing is written

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  payload: (f: Fixture) => Record<string, unknown>
  /** The id of an existing row of `table` that lives on the OTHER whiteboard. */
  takenId: (f: Fixture) => string
}

const CASES: Array<CreateCase> = [
  {
    event: 'table:create',
    table: 'DiagramTable',
    payload: () => ({ name: 'customers', positionX: 1, positionY: 2 }),
    takenId: (f) => f.otherTableId,
  },
  {
    event: 'column:create',
    table: 'Column',
    payload: (f) => ({ tableId: f.tableId, name: 'email', dataType: 'string' }),
    takenId: (f) => f.otherColumnId,
  },
  {
    event: 'relationship:create',
    table: 'Relationship',
    payload: (f) => ({
      sourceTableId: f.tableId,
      targetTableId: f.tableId,
      sourceColumnId: f.sourceColumnId,
      targetColumnId: f.targetColumnId,
      cardinality: 'MANY_TO_ONE',
    }),
    takenId: (f) => {
      const id = randomUUID()
      const ts = Date.now()
      db.prepare(
        'INSERT INTO "Relationship" ("id","whiteboardId","sourceTableId","targetTableId","sourceColumnId","targetColumnId","cardinality","label","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        f.otherWhiteboardId,
        f.otherTableId,
        f.otherTableId,
        f.otherColumnId,
        f.otherColumnId,
        'ONE_TO_ONE',
        'theirs',
        ts,
        ts,
      )
      return id
    },
  },
  {
    event: 'area:create',
    table: 'Area',
    payload: () => ({
      name: 'Billing',
      color: 'blue',
      positionX: 0,
      positionY: 0,
      width: 300,
      height: 200,
    }),
    takenId: (f) => {
      const id = randomUUID()
      const ts = Date.now()
      db.prepare(
        'INSERT INTO "Area" ("id","whiteboardId","name","color","positionX","positionY","width","height","memberTableIds","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).run(id, f.otherWhiteboardId, 'Theirs', 'red', 5, 5, 50, 50, '[]', ts, ts)
      return id
    },
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

  it('refuses an id that exists on another whiteboard and leaves that row unchanged', async () => {
    const f = makeFixture()
    const { handlers, socket } = makeSocket(f.whiteboardId)
    const takenId = c.takenId(f)
    const before = row(c.table, takenId)
    const rowsBefore = count(c.table)

    const ack = await send(handlers, c.event, { ...c.payload(f), id: takenId })

    expect(ack).toMatchObject({ ok: false, code: 'ALREADY_EXISTS' })
    expect(row(c.table, takenId)).toEqual(before)
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
    await expect(
      createTableHandler(auth, {
        id: f.otherTableId,
        whiteboardId: f.whiteboardId,
        name: 'stolen',
      }),
    ).rejects.toThrow('already exists')
    expect(row('DiagramTable', f.otherTableId)).toEqual(before)
  })

  it('createRelationshipHandler refuses a taken id', async () => {
    const f = makeFixture()
    const takenId = CASES[2].takenId(f)
    const before = row('Relationship', takenId)

    await expect(
      createRelationshipHandler(auth, {
        id: takenId,
        whiteboardId: f.whiteboardId,
        sourceTableId: f.tableId,
        targetTableId: f.tableId,
        sourceColumnId: f.sourceColumnId,
        targetColumnId: f.targetColumnId,
        cardinality: 'MANY_TO_ONE',
      }),
    ).rejects.toBeInstanceOf(AlreadyExistsError)
    expect(row('Relationship', takenId)).toEqual(before)
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

    const before = row('DiagramTable', f.tableId)
    await expect(
      createTableReference({
        id: f.tableId,
        whiteboardId: f.whiteboardId,
        sourceWhiteboardId: f.otherWhiteboardId,
        sourceTableId: f.otherTableId,
        sourceColumnIds: [f.otherColumnId],
      }),
    ).rejects.toBeInstanceOf(AlreadyExistsError)
    expect(row('DiagramTable', f.tableId)).toEqual(before)
  })
})

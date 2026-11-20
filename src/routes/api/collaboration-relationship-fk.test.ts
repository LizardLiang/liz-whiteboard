// src/routes/api/collaboration-relationship-fk.test.ts
// The relationship socket handlers deliver the source column's FK change:
// collaborators get a column:updated broadcast, the sender gets the same event
// (as 'system') plus the change in the ack. Real handlers, in-memory SQLite.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCollaborationEventHandlers } from './collaboration'
import type * as RequireRoleModule from '@/lib/auth/require-role'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

vi.mock('@/lib/auth/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof RequireRoleModule>()
  return { ...actual, requireRole: vi.fn().mockResolvedValue(false) }
})

type Ack = { ok: boolean; entity?: any; columnUpdates?: Array<any> }
type Handler = (data: unknown, cb?: (res: Ack) => void) => Promise<void>

function setup() {
  const project = makeProject()
  const whiteboardId = makeWhiteboard({ projectId: project.id }).id
  const orders = makeTable({ whiteboardId, name: 'orders' }).id
  const users = makeTable({ whiteboardId, name: 'users' }).id
  const sourceColumnId = makeColumn({ tableId: orders, name: 'user_id' }).id
  const targetColumnId = makeColumn({ tableId: users, name: 'id' }).id
  const handlers: Record<string, Handler> = {}
  const broadcast = vi.fn()
  const emit = vi.fn()
  const socket: any = {
    id: 's1',
    data: { userId: 'u1', sessionExpiresAt: Date.now() + 60_000 },
    on: (e: string, h: Handler) => {
      handlers[e] = h
    },
    emit,
    broadcast: { emit: broadcast },
    disconnect: vi.fn(),
  }
  setupCollaborationEventHandlers(socket, whiteboardId, 'u1')
  const call = async (event: string, data: unknown) => {
    let ack: Ack | undefined
    await handlers[event](data, (r) => {
      ack = r
    })
    return ack!
  }
  return {
    whiteboardId,
    orders,
    users,
    sourceColumnId,
    targetColumnId,
    broadcast,
    emit,
    call,
  }
}

const columnUpdates = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.filter(([e]) => e === 'column:updated').map(([, p]) => p)

beforeEach(() => resetDb())

describe('relationship:create / relationship:delete column delivery', () => {
  it('broadcasts the FK on to collaborators and acks it to the sender', async () => {
    const s = setup()
    const ack = await s.call('relationship:create', {
      sourceTableId: s.orders,
      targetTableId: s.users,
      sourceColumnId: s.sourceColumnId,
      targetColumnId: s.targetColumnId,
      cardinality: 'MANY_TO_ONE',
    })

    expect(ack.ok).toBe(true)
    const expected = {
      columnId: s.sourceColumnId,
      tableId: s.orders,
      isForeignKey: true,
    }
    expect(ack.columnUpdates).toEqual([expected])
    expect(columnUpdates(s.broadcast)).toEqual([
      { ...expected, updatedBy: 'u1' },
    ])
    expect(columnUpdates(s.emit)).toEqual([
      { ...expected, updatedBy: 'system' },
    ])
  })

  it('broadcasts the FK off when the last relationship is deleted', async () => {
    const s = setup()
    const created = await s.call('relationship:create', {
      sourceTableId: s.orders,
      targetTableId: s.users,
      sourceColumnId: s.sourceColumnId,
      targetColumnId: s.targetColumnId,
      cardinality: 'MANY_TO_ONE',
    })
    s.broadcast.mockClear()
    s.emit.mockClear()

    const ack = await s.call('relationship:delete', {
      relationshipId: created.entity.id,
    })

    expect(ack.ok).toBe(true)
    const expected = {
      columnId: s.sourceColumnId,
      tableId: s.orders,
      isForeignKey: false,
    }
    expect(ack.columnUpdates).toEqual([expected])
    expect(columnUpdates(s.broadcast)).toEqual([
      { ...expected, updatedBy: 'u1' },
    ])
  })
})

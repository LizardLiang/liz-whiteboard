// src/routes/api/collaboration-table-delete-batch.test.ts
// `table:delete` always logs under the `table-delete` batch kind, also when
// the client sent its own batchId. Drives the real socket handler against the
// in-memory database; only the role check is mocked.

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

vi.mock('@/lib/auth/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof RequireRoleModule>()
  return {
    ...actual,
    requireRole: vi.fn().mockResolvedValue(false),
    requireServerFnRole: vi.fn().mockResolvedValue(undefined),
  }
})

const USER_ID = 'user-table-delete-batch'

type Handler = (
  data: unknown,
  cb?: (res: { ok: boolean }) => void,
) => Promise<void>

function makeSocket(whiteboardId: string) {
  const handlers: Record<string, Handler> = {}
  const socket = {
    id: 'socket-table-delete-batch',
    data: { userId: USER_ID, sessionExpiresAt: Date.now() + 60_000 },
    on: (event: string, handler: Handler) => {
      handlers[event] = handler
    },
    emit: vi.fn(),
    broadcast: { emit: vi.fn() },
    disconnect: vi.fn(),
  }
  setupCollaborationEventHandlers(socket, whiteboardId, USER_ID)
  return handlers
}

function logged(whiteboardId: string) {
  return db
    .prepare(
      'SELECT "batchId","batchKind","entityType","action" FROM "SchemaChangeEvent" WHERE "whiteboardId" = ?',
    )
    .all(whiteboardId) as Array<{
    batchId: string | null
    batchKind: string | null
    entityType: string
    action: string
  }>
}

beforeEach(() => resetDb())

describe('table:delete batch kind', () => {
  for (const clientBatchId of [undefined, 'client-batch-1']) {
    it(`uses table-delete ${clientBatchId ? 'with' : 'without'} a client batchId`, async () => {
      const project = makeProject()
      const whiteboardId = makeWhiteboard({ projectId: project.id }).id
      const tableId = makeTable({ whiteboardId, name: 'orders' }).id
      makeColumn({ tableId, name: 'id' })
      const handlers = makeSocket(whiteboardId)

      let acked = false
      await handlers['table:delete'](
        { tableId, ...(clientBatchId ? { batchId: clientBatchId } : {}) },
        () => {
          acked = true
        },
      )
      expect(acked).toBe(true)

      const rows = logged(whiteboardId)
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows.map((r) => r.batchKind))).toEqual(
        new Set(['table-delete']),
      )
      if (clientBatchId) {
        expect(new Set(rows.map((r) => r.batchId))).toEqual(
          new Set([clientBatchId]),
        )
      }
    })
  }
})

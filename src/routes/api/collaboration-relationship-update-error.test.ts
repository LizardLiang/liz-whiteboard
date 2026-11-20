// src/routes/api/collaboration-relationship-update-error.test.ts
// relationship:update must not send raw driver text (SQLite constraint
// messages) to the client when the endpoint integrity check throws.

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCollaborationEventHandlers } from './collaboration'
import type * as RequireRoleModule from '@/lib/auth/require-role'
import type * as RelationshipModule from '@/data/relationship'
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
  return { ...actual, requireRole: vi.fn().mockResolvedValue(false) }
})

vi.mock('@/data/relationship', async (importOriginal) => {
  const actual = await importOriginal<typeof RelationshipModule>()
  return {
    ...actual,
    assertRelationshipEndpointsValid: vi
      .fn()
      .mockRejectedValue(
        new Error(
          'SQLITE_CONSTRAINT: FOREIGN KEY constraint failed (table Relationship, /var/lib/app.db)',
        ),
      ),
  }
})

type Ack = { ok: boolean; code?: string; message?: string }

beforeEach(() => resetDb())
afterEach(() => vi.unstubAllEnvs())

describe('relationship:update integrity failure', () => {
  it('sends a generic message, not raw SQLite text, in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const project = makeProject()
    const whiteboardId = makeWhiteboard({ projectId: project.id }).id
    const tableId = makeTable({ whiteboardId, name: 't' }).id
    const columnId = makeColumn({ tableId, name: 'c' }).id
    const relationshipId = randomUUID()
    const ts = Date.now()
    db.prepare(
      'INSERT INTO "Relationship" ("id","whiteboardId","sourceTableId","targetTableId","sourceColumnId","targetColumnId","cardinality","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(relationshipId, whiteboardId, tableId, tableId, columnId, columnId, 'ONE_TO_ONE', ts, ts)

    const handlers: Record<string, (d: unknown, cb?: (r: Ack) => void) => Promise<void>> = {}
    const emitted: Array<any> = []
    const socket: any = {
      id: 's1',
      data: { userId: 'u1', sessionExpiresAt: Date.now() + 60_000 },
      on: (e: string, h: any) => {
        handlers[e] = h
      },
      emit: (_e: string, payload: unknown) => emitted.push(payload),
      broadcast: { emit: vi.fn() },
      disconnect: vi.fn(),
    }
    setupCollaborationEventHandlers(socket, whiteboardId, 'u1')

    let ack: Ack | undefined
    await handlers['relationship:update'](
      { relationshipId, sourceColumnId: columnId },
      (r) => {
        ack = r
      },
    )

    expect(ack?.ok).toBe(false)
    expect(ack?.message).toBe('Referential integrity violation')
    expect(JSON.stringify([ack, emitted])).not.toMatch(/SQLITE|app\.db/)
  })
})

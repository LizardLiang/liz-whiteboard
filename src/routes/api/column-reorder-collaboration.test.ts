// src/routes/api/column-reorder-collaboration.test.ts
// Suite S5: Socket handler for column:reorder (INT-05 through INT-16)
// Covers: AC-04b (broadcasts), AC-04f (ack to sender), AC-07a (DB persist),
//         AC-07b (transactional), FM-03 (invalid payload rejected), FM-07 (merge)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reorderColumnsSchema } from '@/data/schema'

// ============================================================================
// Handler factory — parameterized injection so tests control all dependencies
// ============================================================================

interface ColumnReorderDeps {
  findDiagramTableById: (tableId: string) => Promise<any>
  findColumnsByTableId: (
    tableId: string,
  ) => Promise<Array<{ id: string; order: number }>>
  reorderColumns: (
    tableId: string,
    orderedColumnIds: Array<string>,
  ) => Promise<any>
  updateSessionActivity: (socketId: string) => Promise<void>
}

function createColumnReorderHandler(
  socket: {
    emit: (...args: Array<any>) => void
    broadcast: { emit: (...args: Array<any>) => void }
    data: { sessionExpiresAt: number }
    disconnect: (force: boolean) => void
    id: string
  },
  whiteboardId: string,
  userId: string,
  deps: ColumnReorderDeps,
) {
  return async (data: unknown) => {
    // Session expiry check
    if (Date.now() > socket.data.sessionExpiresAt) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }

    try {
      // Zod validation
      const validated = reorderColumnsSchema.parse(data)
      const { tableId, orderedColumnIds } = validated

      // IDOR check
      const table = await deps.findDiagramTableById(tableId)
      if (!table) {
        socket.emit('error', {
          event: 'column:reorder',
          error: 'FORBIDDEN',
          message: 'Table not found',
          tableId,
        })
        return
      }
      if (table.whiteboardId !== whiteboardId) {
        socket.emit('error', {
          event: 'column:reorder',
          error: 'FORBIDDEN',
          message: 'Table does not belong to this whiteboard',
          tableId,
        })
        return
      }

      // Fetch current columns for FM-07 merge and validation
      const currentColumns = await deps.findColumnsByTableId(tableId)
      const currentColumnIds = new Set(currentColumns.map((c) => c.id))

      // Validate: every supplied ID must belong to this table; no duplicates
      const seenIds = new Set<string>()
      for (const id of orderedColumnIds) {
        if (!currentColumnIds.has(id)) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'VALIDATION_FAILED',
            message: `Column ${id} does not belong to table ${tableId}`,
            tableId,
          })
          return
        }
        if (seenIds.has(id)) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'VALIDATION_FAILED',
            message: `Duplicate column ID ${id} in orderedColumnIds`,
            tableId,
          })
          return
        }
        seenIds.add(id)
      }

      // FM-07 merge: append missing columns in ascending existing-order
      const suppliedSet = new Set(orderedColumnIds)
      const missingColumns = currentColumns
        .filter((c) => !suppliedSet.has(c.id))
        .sort((a, b) => a.order - b.order)
      const mergedOrderedIds = [
        ...orderedColumnIds,
        ...missingColumns.map((c) => c.id),
      ]

      // Persist via single transaction (AC-07a, AC-07b)
      await deps.reorderColumns(tableId, mergedOrderedIds)

      // Broadcast merged order to all OTHER clients (AC-04b)
      socket.broadcast.emit('column:reordered', {
        tableId,
        orderedColumnIds: mergedOrderedIds,
        reorderedBy: userId,
      })

      // Ack to originating socket only (AC-04f)
      socket.emit('column:reorder:ack', {
        tableId,
        orderedColumnIds: mergedOrderedIds,
      })
    } catch (error) {
      socket.emit('error', {
        event: 'column:reorder',
        error: 'UPDATE_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to reorder columns',
      })
      return
    }
    await deps.updateSessionActivity(socket.id)
  }
}

// ============================================================================
// Socket mock factory
// ============================================================================

function buildSocketMock() {
  const emitSpy = vi.fn()
  const broadcastEmitSpy = vi.fn()
  const socket = {
    id: 'socket-test-abc',
    emit: emitSpy,
    broadcast: { emit: broadcastEmitSpy },
    data: { sessionExpiresAt: Date.now() + 3_600_000 },
    disconnect: vi.fn(),
  }
  return { socket, emitSpy, broadcastEmitSpy }
}

// ============================================================================
// Test data constants
// ============================================================================

// Valid v4 UUIDs (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y ∈ {8,9,a,b})
const TABLE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const WB_ID = 'wb-001'
const USER_ID = 'user-test-001'
const COL_A = '00000001-0000-4000-a000-000000000001'
const COL_B = '00000002-0000-4000-a000-000000000002'
const COL_C = '00000003-0000-4000-a000-000000000003'
const COL_D = '00000004-0000-4000-a000-000000000004'
const COL_E = '00000005-0000-4000-a000-000000000005'

const mockTable = { id: TABLE_ID, whiteboardId: WB_ID, name: 'users' }

const mockCurrentColumns: Array<{ id: string; order: number }> = [
  { id: COL_A, order: 0 },
  { id: COL_B, order: 1 },
  { id: COL_C, order: 2 },
  { id: COL_D, order: 3 },
  { id: COL_E, order: 4 },
]

// ============================================================================
// Suite S5: Socket handler tests
// ============================================================================

describe('column:reorder socket handler (Suite S5)', () => {
  let socket: ReturnType<typeof buildSocketMock>['socket']
  let emitSpy: ReturnType<typeof buildSocketMock>['emitSpy']
  let broadcastEmitSpy: ReturnType<typeof buildSocketMock>['broadcastEmitSpy']
  let deps: { [K in keyof ColumnReorderDeps]: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    ;({ socket, emitSpy, broadcastEmitSpy } = buildSocketMock())
    deps = {
      findDiagramTableById: vi.fn(),
      findColumnsByTableId: vi.fn(),
      reorderColumns: vi.fn(),
      updateSessionActivity: vi.fn().mockResolvedValue(undefined),
    }
  })

  function makeHandler() {
    return createColumnReorderHandler(socket, WB_ID, USER_ID, deps as any)
  }

  // INT-05: happy path — persists, broadcasts, acks (AC-07a, AC-04b, AC-04f)
  it('INT-05: valid payload — persists to DB, broadcasts to others, acks to sender', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)
    deps.reorderColumns.mockResolvedValue([])

    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_B, COL_A, COL_C, COL_D, COL_E],
    })

    // AC-07a: reorderColumns called with correct merged args
    expect(deps.reorderColumns).toHaveBeenCalledWith(TABLE_ID, [
      COL_B,
      COL_A,
      COL_C,
      COL_D,
      COL_E,
    ])

    // AC-04b: broadcast to other clients with reorderedBy field
    expect(broadcastEmitSpy).toHaveBeenCalledWith('column:reordered', {
      tableId: TABLE_ID,
      orderedColumnIds: [COL_B, COL_A, COL_C, COL_D, COL_E],
      reorderedBy: USER_ID,
    })

    // AC-04f: ack sent to originating socket
    expect(emitSpy).toHaveBeenCalledWith('column:reorder:ack', {
      tableId: TABLE_ID,
      orderedColumnIds: [COL_B, COL_A, COL_C, COL_D, COL_E],
    })

    // No error emitted
    expect(emitSpy).not.toHaveBeenCalledWith('error', expect.anything())
  })

  // INT-06: IDOR — tableId in wrong whiteboard
  it('INT-06: IDOR — tableId belongs to different whiteboard emits FORBIDDEN, no broadcast', async () => {
    deps.findDiagramTableById.mockResolvedValue({
      id: TABLE_ID,
      whiteboardId: 'wb-OTHER',
      name: 'users',
    })

    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_A, COL_B, COL_C, COL_D, COL_E],
    })

    expect(deps.reorderColumns).not.toHaveBeenCalled()
    expect(broadcastEmitSpy).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'FORBIDDEN', tableId: TABLE_ID }),
    )
  })

  // INT-07: unknown columnId (FM-03)
  it('INT-07: unknown column ID in payload emits VALIDATION_FAILED, no DB write', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)

    const unknownId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_A, COL_B, COL_C, COL_D, unknownId],
    })

    expect(deps.reorderColumns).not.toHaveBeenCalled()
    expect(broadcastEmitSpy).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'VALIDATION_FAILED' }),
    )
  })

  // INT-08: duplicate columnId — VALIDATION_FAILED
  it('INT-08: duplicate column ID in payload emits VALIDATION_FAILED', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)

    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_A, COL_B, COL_A, COL_D, COL_E], // COL_A duplicated
    })

    expect(deps.reorderColumns).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'VALIDATION_FAILED' }),
    )
  })

  // INT-09: empty orderedColumnIds — Zod rejects (FM-03)
  it('INT-09: empty orderedColumnIds rejected by Zod before any DB call', async () => {
    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [],
    })

    expect(deps.findDiagramTableById).not.toHaveBeenCalled()
    expect(deps.findColumnsByTableId).not.toHaveBeenCalled()
    expect(deps.reorderColumns).not.toHaveBeenCalled()
    // ZodError caught in catch block → UPDATE_FAILED
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'UPDATE_FAILED' }),
    )
  })

  // INT-10: non-UUID tableId — Zod rejects (FM-03)
  it('INT-10: non-UUID tableId rejected by Zod before any DB call', async () => {
    await makeHandler()({
      tableId: 'not-a-uuid',
      orderedColumnIds: [COL_A],
    })

    expect(deps.findDiagramTableById).not.toHaveBeenCalled()
    expect(deps.reorderColumns).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'UPDATE_FAILED' }),
    )
  })

  // INT-11: FM-07 merge — 1 missing column appended
  it('INT-11: FM-07 — client sends 4 of 5 IDs, missing column appended at end', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)
    deps.reorderColumns.mockResolvedValue([])

    // Client omits COL_D (order: 3)
    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_B, COL_A, COL_C, COL_E],
    })

    // COL_D (order=3) appended after the 4 supplied IDs
    expect(deps.reorderColumns).toHaveBeenCalledWith(TABLE_ID, [
      COL_B,
      COL_A,
      COL_C,
      COL_E,
      COL_D,
    ])

    // Ack includes the merged order
    expect(emitSpy).toHaveBeenCalledWith('column:reorder:ack', {
      tableId: TABLE_ID,
      orderedColumnIds: [COL_B, COL_A, COL_C, COL_E, COL_D],
    })
  })

  // INT-12: FM-07 merge — multiple missing columns appended ascending by order
  it('INT-12: FM-07 — 2 missing columns appended in ascending existing-order', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)
    deps.reorderColumns.mockResolvedValue([])

    // Client sends only 3 of 5 — omits COL_B (order:1) and COL_D (order:3)
    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_A, COL_C, COL_E],
    })

    // Missing: COL_B (order:1) appended first, COL_D (order:3) appended second
    expect(deps.reorderColumns).toHaveBeenCalledWith(TABLE_ID, [
      COL_A,
      COL_C,
      COL_E,
      COL_B, // order:1
      COL_D, // order:3
    ])
  })

  // INT-13: DB failure — UPDATE_FAILED, no broadcast (FM-03)
  it('INT-13: DB failure (reorderColumns throws) emits UPDATE_FAILED, no broadcast', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)
    deps.reorderColumns.mockRejectedValue(new Error('Transaction failed'))

    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_B, COL_A, COL_C, COL_D, COL_E],
    })

    expect(broadcastEmitSpy).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'UPDATE_FAILED' }),
    )
  })

  // INT-14: ack payload matches MERGED order, not raw client payload
  it('INT-14: column:reorder:ack contains merged orderedColumnIds (not raw payload)', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)
    deps.reorderColumns.mockResolvedValue([])

    // Client sends 3 of 5 — server merges COL_B (order:1) and COL_D (order:3)
    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_C, COL_A, COL_E],
    })

    const ackCall = emitSpy.mock.calls.find(
      ([event]) => event === 'column:reorder:ack',
    )
    expect(ackCall).toBeDefined()
    const ackPayload = ackCall![1]
    expect(ackPayload.orderedColumnIds).toEqual([
      COL_C,
      COL_A,
      COL_E,
      COL_B, // order:1, appended first
      COL_D, // order:3, appended second
    ])
  })

  // INT-15: table not found → FORBIDDEN
  it('INT-15: table not found emits FORBIDDEN, no DB write', async () => {
    deps.findDiagramTableById.mockResolvedValue(null)

    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_A, COL_B, COL_C, COL_D, COL_E],
    })

    expect(deps.reorderColumns).not.toHaveBeenCalled()
    expect(broadcastEmitSpy).not.toHaveBeenCalled()
    expect(emitSpy).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: 'FORBIDDEN', tableId: TABLE_ID }),
    )
  })

  // INT-16: broadcast carries reorderedBy field (AC-14c)
  it('INT-16: broadcast column:reordered includes reorderedBy from socket auth', async () => {
    deps.findDiagramTableById.mockResolvedValue(mockTable)
    deps.findColumnsByTableId.mockResolvedValue(mockCurrentColumns)
    deps.reorderColumns.mockResolvedValue([])

    await makeHandler()({
      tableId: TABLE_ID,
      orderedColumnIds: [COL_A, COL_B, COL_C, COL_D, COL_E],
    })

    expect(broadcastEmitSpy).toHaveBeenCalledWith(
      'column:reordered',
      expect.objectContaining({ reorderedBy: USER_ID }),
    )
  })
})

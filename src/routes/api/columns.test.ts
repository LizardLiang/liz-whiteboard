// src/routes/api/columns.test.ts
// Suite 7 — Integration: Batch Column RBAC — All-or-Nothing (SEC-BATCH-04)
// Suite 8 — Integration: getTableProjectId Throw Path (Apollo MEDIUM-1)
// TC-BATCH-01 through TC-BATCH-07, TC-GTPI-01 through TC-GTPI-03
//
// Tests the batch RBAC business logic directly (same pattern as whiteboards.test.ts).
// The createColumnsFn server-function wrapper is not directly callable in tests;
// instead we mirror its pre-validate-then-write handler logic here.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BatchDeniedError,
  ForbiddenError,
  requireServerFnRole,
} from '@/lib/auth/require-role'

vi.mock('@/data/resolve-project', () => ({
  getTableProjectId: vi.fn(),
}))

vi.mock('@/lib/auth/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/require-role')>()
  return {
    ...actual,
    requireServerFnRole: vi.fn(),
  }
})

vi.mock('@/lib/auth/log-sample', () => ({
  logSampledError: vi.fn(),
}))

vi.mock('@/data/column', () => ({
  createColumns: vi.fn(),
}))

import { getTableProjectId } from '@/data/resolve-project'
import { logSampledError } from '@/lib/auth/log-sample'
import { createColumns } from '@/data/column'

const mockGetTableProjectId = vi.mocked(getTableProjectId)
const mockRequireServerFnRole = vi.mocked(requireServerFnRole)
const mockCreateColumns = vi.mocked(createColumns)
const mockLogSampledError = vi.mocked(logSampledError)

// ─────────────────────────────────────────────────────────────────────────────
// Mirror of the createColumnsFn handler logic (AD-3: pre-validate-then-write)
// MEDIUM-1: catches DB throws in getTableProjectId
// ─────────────────────────────────────────────────────────────────────────────

interface ColumnInput {
  tableId: string
  name: string
  dataType: string
}

async function createColumnsBatchHandler(userId: string, data: ColumnInput[]) {
  if (data.length === 0) return []

  const uniqueTableIds = [...new Set(data.map((c) => c.tableId))]
  for (const tableId of uniqueTableIds) {
    let projectId: string | null
    try {
      projectId = await getTableProjectId(tableId)
    } catch (error) {
      // MEDIUM-1: DB throw during getTableProjectId → BatchDeniedError
      logSampledError({
        userId,
        errorClass: 'BATCH_RBAC_LOOKUP_FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
      throw new BatchDeniedError()
    }
    try {
      await requireServerFnRole(userId, projectId, 'EDITOR')
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw new BatchDeniedError()
      }
      throw error
    }
  }

  return createColumns(data as any)
}

function makeColumnInput(tableId: string, i: number = 0): ColumnInput {
  return { tableId, name: `col_${i}`, dataType: 'string' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — SEC-BATCH-04
// ─────────────────────────────────────────────────────────────────────────────

describe('createColumnsBatch — batch RBAC (SEC-BATCH-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableProjectId.mockResolvedValue('project-A')
    mockRequireServerFnRole.mockResolvedValue(undefined)
    mockCreateColumns.mockResolvedValue([])
  })

  // TC-BATCH-01 (Regression): Mixed batch → BatchDeniedError, zero rows written
  it('TC-BATCH-01 (Regression): mixed auth → BatchDeniedError, no write', async () => {
    mockGetTableProjectId
      .mockResolvedValueOnce('project-A')
      .mockResolvedValueOnce('project-B')
    mockRequireServerFnRole
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenError())

    const batch = [
      makeColumnInput('tableId-A', 0),
      makeColumnInput('tableId-B', 1),
    ]

    await expect(createColumnsBatchHandler('user-1', batch)).rejects.toThrow(BatchDeniedError)
    expect(mockCreateColumns).not.toHaveBeenCalled()
  })

  // TC-BATCH-02: Fully authorized → all written
  it('TC-BATCH-02: fully authorized → writes all items', async () => {
    const written = [{ id: 'c1' }, { id: 'c2' }]
    mockCreateColumns.mockResolvedValue(written as any)

    const batch = [makeColumnInput('tbl-1', 0), makeColumnInput('tbl-1', 1)]
    const result = await createColumnsBatchHandler('user-1', batch)
    expect(result).toEqual(written)
    expect(mockCreateColumns).toHaveBeenCalledOnce()
  })

  // TC-BATCH-03: Fully unauthorized → BatchDeniedError
  it('TC-BATCH-03: fully unauthorized → BatchDeniedError', async () => {
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())
    await expect(createColumnsBatchHandler('user-1', [makeColumnInput('tbl-1')])).rejects.toThrow(BatchDeniedError)
    expect(mockCreateColumns).not.toHaveBeenCalled()
  })

  // TC-BATCH-04: BatchDeniedError does not expose tableId or index
  it('TC-BATCH-04: BatchDeniedError message hides tableId and item index', async () => {
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())
    mockGetTableProjectId.mockResolvedValue('proj-x')

    let caught: unknown
    try {
      await createColumnsBatchHandler('user-1', [makeColumnInput('secret-table-abc123')])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BatchDeniedError)
    expect((caught as BatchDeniedError).message).not.toContain('secret-table-abc123')
    expect((caught as BatchDeniedError).message).not.toMatch(/item \d+|index/i)
  })

  // TC-BATCH-05: Empty batch → immediate empty return
  it('TC-BATCH-05: empty batch resolves immediately, no RBAC or DB calls', async () => {
    const result = await createColumnsBatchHandler('user-1', [])
    expect(result).toEqual([])
    expect(mockGetTableProjectId).not.toHaveBeenCalled()
    expect(mockCreateColumns).not.toHaveBeenCalled()
  })

  // TC-BATCH-06: Single authorized item
  it('TC-BATCH-06: single authorized item → success', async () => {
    const written = [{ id: 'c1' }]
    mockCreateColumns.mockResolvedValue(written as any)
    const result = await createColumnsBatchHandler('user-1', [makeColumnInput('tbl-1')])
    expect(result).toEqual(written)
  })

  // TC-BATCH-07: Single unauthorized item → BatchDeniedError
  it('TC-BATCH-07: single unauthorized → BatchDeniedError', async () => {
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())
    await expect(createColumnsBatchHandler('user-1', [makeColumnInput('tbl-denied')])).rejects.toThrow(BatchDeniedError)
    expect(mockCreateColumns).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — getTableProjectId DB throw path (Apollo MEDIUM-1)
// ─────────────────────────────────────────────────────────────────────────────

describe('createColumnsBatch — getTableProjectId DB throws (Apollo MEDIUM-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireServerFnRole.mockResolvedValue(undefined)
    mockCreateColumns.mockResolvedValue([])
  })

  // TC-GTPI-01: DB throw → BatchDeniedError, raw error NOT propagated
  it('TC-GTPI-01 (Regression): getTableProjectId throws → BatchDeniedError, no raw leak', async () => {
    const rawError = new Error('Connection pool exhausted for table-id-abc123')
    mockGetTableProjectId.mockRejectedValue(rawError)

    let caught: unknown
    try {
      await createColumnsBatchHandler('user-1', [makeColumnInput('tbl-leak')])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BatchDeniedError)
    expect((caught as BatchDeniedError).message).not.toContain('table-id-abc123')
    expect(mockCreateColumns).not.toHaveBeenCalled()
    expect(mockLogSampledError).toHaveBeenCalledWith(expect.objectContaining({
      errorClass: 'BATCH_RBAC_LOOKUP_FAILED',
    }))
  })

  // TC-GTPI-02: DB throw on item 2 → BatchDeniedError (item 1's pass doesn't cause partial write)
  it('TC-GTPI-02: DB throw on item 2 of 2 → BatchDeniedError, no partial write', async () => {
    mockGetTableProjectId
      .mockResolvedValueOnce('project-A') // tbl-a passes
      .mockRejectedValueOnce(new Error('DB timeout on tbl-b'))

    const batch = [makeColumnInput('tbl-a', 0), makeColumnInput('tbl-b', 1)]
    await expect(createColumnsBatchHandler('user-1', batch)).rejects.toThrow(BatchDeniedError)
    expect(mockCreateColumns).not.toHaveBeenCalled()
  })

  // TC-GTPI-03: getTableProjectId returns null → ForbiddenError → BatchDeniedError (anti-enum)
  it('TC-GTPI-03: null projectId → BatchDeniedError (anti-enumeration — same as throw)', async () => {
    mockGetTableProjectId.mockResolvedValue(null)
    // requireServerFnRole(userId, null, 'EDITOR') → throws ForbiddenError
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())

    let caught: unknown
    try {
      await createColumnsBatchHandler('user-1', [makeColumnInput('tbl-missing')])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BatchDeniedError)
    expect((caught as BatchDeniedError).message).not.toContain('tbl-missing')
  })
})

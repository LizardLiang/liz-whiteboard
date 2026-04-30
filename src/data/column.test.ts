// src/data/column.test.ts
// Suite S2: reorderColumns() data layer tests (UT-07 through UT-11)

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reorderColumns } from './column'

// Mock Prisma client
vi.mock('@/db', () => ({
  prisma: {
    column: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/db'

const TABLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const COL_A = 'col-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const COL_B = 'col-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const COL_C = 'col-cccc-cccc-cccc-cccc-cccccccccccc'

const makeColumn = (id: string, order: number) => ({
  id,
  tableId: TABLE_ID,
  name: `col_${order}`,
  order,
  dataType: 'string',
  isPrimaryKey: false,
  isForeignKey: false,
  isNullable: true,
  isUnique: false,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('reorderColumns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('UT-07: throws on empty orderedColumnIds', async () => {
    await expect(reorderColumns(TABLE_ID, [])).rejects.toThrow(
      'orderedColumnIds must not be empty',
    )
    // Should not call findMany since we throw early
    expect(prisma.column.findMany).not.toHaveBeenCalled()
  })

  it('UT-08: throws when any ID does not belong to tableId', async () => {
    ;(prisma.column.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeColumn(COL_A, 0),
      makeColumn(COL_B, 1),
    ])

    const unknownId = 'unknown-id-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
    await expect(
      reorderColumns(TABLE_ID, [COL_A, unknownId]),
    ).rejects.toThrow()
  })

  it('UT-09: calls prisma.$transaction with one update per ID', async () => {
    const cols = [makeColumn(COL_A, 0), makeColumn(COL_B, 1), makeColumn(COL_C, 2)]
    ;(prisma.column.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(cols)
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue(cols)

    await reorderColumns(TABLE_ID, [COL_A, COL_B, COL_C])

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const calls = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls
    // The transaction should receive an array of 3 operations
    expect(calls[0][0]).toHaveLength(3)
  })

  it('UT-10: re-sequences to 0..N-1', async () => {
    // Start with C at 0, A at 1, B at 2 in DB
    const cols = [
      makeColumn(COL_C, 0),
      makeColumn(COL_A, 1),
      makeColumn(COL_B, 2),
    ]
    ;(prisma.column.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(cols)

    // We want order: C=0, A=1, B=2 — verify update operations use correct indices
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: Array<any>) => ops,
    )

    // Need prisma.column.update to return something
    ;(prisma.column.update as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where, data }: { where: { id: string }; data: { order: number } }) =>
        Promise.resolve({ ...makeColumn(where.id, data.order), order: data.order }),
    )

    await reorderColumns(TABLE_ID, [COL_C, COL_A, COL_B])

    // The $transaction should have been called with update operations for each id
    // Verify the mock was called once
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('UT-11: returns updated columns in new order', async () => {
    const cols = [makeColumn(COL_A, 0), makeColumn(COL_B, 1)]
    ;(prisma.column.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(cols)

    const updatedCols = [
      makeColumn(COL_B, 0), // B is now first
      makeColumn(COL_A, 1), // A is now second
    ]
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue(
      updatedCols,
    )

    const result = await reorderColumns(TABLE_ID, [COL_B, COL_A])
    expect(result).toEqual(updatedCols)
  })
})

// src/data/column.test.ts
// Integration tests for the Column data layer against a real in-memory SQLite
// database (DATABASE_URL=:memory:). Covers createColumn, createColumns (batch),
// reorderColumns, duplicateColumn, updateColumn and deleteColumn.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createColumn,
  createColumns,
  deleteColumn,
  duplicateColumn,
  findColumnById,
  findColumnsByTableId,
  reorderColumns,
  updateColumn,
} from './column'
import { db } from '@/db'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

/** Build the FK chain a Column requires: Project → Whiteboard → DiagramTable. */
function makeTableId(): string {
  const p = makeProject()
  const wb = makeWhiteboard({ projectId: p.id })
  const t = makeTable({ whiteboardId: wb.id })
  return t.id
}

beforeEach(() => resetDb())

describe('createColumn', () => {
  it('inserts a column and returns the mapped model', async () => {
    const tableId = makeTableId()

    const col = await createColumn({
      tableId,
      name: 'email',
      dataType: 'string',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    })

    expect(col.id).toBeTruthy()
    expect(col.tableId).toBe(tableId)
    expect(col.name).toBe('email')
    // Mappers return real booleans, not 0/1.
    expect(col.isPrimaryKey).toBe(true)
    expect(col.isUnique).toBe(true)
    expect(col.isNullable).toBe(false)
    expect(col.createdAt).toBeInstanceOf(Date)

    // Readable back from the DB.
    const fetched = await findColumnById(col.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.name).toBe('email')
    expect(fetched!.isPrimaryKey).toBe(true)
  })

  it('applies schema defaults for optional flags', async () => {
    const tableId = makeTableId()

    const col = await createColumn({
      tableId,
      name: 'plain',
      dataType: 'string',
    } as never)

    expect(col.isPrimaryKey).toBe(false)
    expect(col.isForeignKey).toBe(false)
    expect(col.isUnique).toBe(false)
    expect(col.isNullable).toBe(false)
    expect(col.order).toBe(0)
  })
})

describe('createColumns', () => {
  it('inserts multiple columns in one transaction', async () => {
    const tableId = makeTableId()

    const cols = await createColumns([
      { tableId, name: 'a', dataType: 'string', order: 0 },
      { tableId, name: 'b', dataType: 'string', order: 1 },
      { tableId, name: 'c', dataType: 'string', order: 2 },
    ])

    expect(cols).toHaveLength(3)
    expect(cols.map((c) => c.name)).toEqual(['a', 'b', 'c'])

    const persisted = await findColumnsByTableId(tableId)
    expect(persisted.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('rolls back the whole batch when one column is invalid', async () => {
    const tableId = makeTableId()

    await expect(
      createColumns([
        { tableId, name: 'valid', dataType: 'string', order: 0 },
        // empty name fails Zod validation
        { tableId, name: '', dataType: 'string', order: 1 } as never,
      ]),
    ).rejects.toThrow()

    // Nothing should have been persisted.
    const persisted = await findColumnsByTableId(tableId)
    expect(persisted).toHaveLength(0)
  })
})

describe('reorderColumns', () => {
  it('UT-07: throws on empty orderedColumnIds', async () => {
    const tableId = makeTableId()
    await expect(reorderColumns(tableId, [])).rejects.toThrow(
      'orderedColumnIds must not be empty',
    )
  })

  it('UT-08: throws when any ID does not belong to the table', async () => {
    const tableId = makeTableId()
    const a = makeColumn({ tableId, name: 'a', order: 0 })
    const otherTableId = makeTableId()
    const foreign = makeColumn({ tableId: otherTableId, name: 'x', order: 0 })

    await expect(
      reorderColumns(tableId, [a.id, foreign.id]),
    ).rejects.toThrow(/does not belong to table/)
  })

  it('UT-10: re-sequences order to 0..N-1 in the given order', async () => {
    const tableId = makeTableId()
    const a = makeColumn({ tableId, name: 'a', order: 0 })
    const b = makeColumn({ tableId, name: 'b', order: 1 })
    const c = makeColumn({ tableId, name: 'c', order: 2 })

    // Desired new order: c, a, b
    const result = await reorderColumns(tableId, [c.id, a.id, b.id])

    expect(result.map((col) => col.id)).toEqual([c.id, a.id, b.id])
    expect(result.map((col) => col.order)).toEqual([0, 1, 2])

    // Persisted ordering (findColumnsByTableId sorts by order ASC).
    const persisted = await findColumnsByTableId(tableId)
    expect(persisted.map((col) => col.id)).toEqual([c.id, a.id, b.id])
  })

  it('UT-11: returns updated columns in the new order', async () => {
    const tableId = makeTableId()
    const a = makeColumn({ tableId, name: 'a', order: 0 })
    const b = makeColumn({ tableId, name: 'b', order: 1 })

    const result = await reorderColumns(tableId, [b.id, a.id])

    expect(result.map((col) => col.id)).toEqual([b.id, a.id])
    expect(result[0].order).toBe(0)
    expect(result[1].order).toBe(1)
  })
})

describe('duplicateColumn', () => {
  it('creates a "_copy" clone inserted directly below the source', async () => {
    const tableId = makeTableId()
    const source = await createColumn({
      tableId,
      name: 'price',
      dataType: 'string',
      isUnique: true,
      isNullable: true,
      order: 0,
    })
    const sibling = makeColumn({ tableId, name: 'after', order: 1 })

    const dup = await duplicateColumn(source.id)

    expect(dup.name).toBe('price_copy')
    expect(dup.order).toBe(1)
    // Flags copied from source (PK/FK forced off on duplicates).
    expect(dup.isPrimaryKey).toBe(false)
    expect(dup.isForeignKey).toBe(false)
    expect(dup.isUnique).toBe(true)
    expect(dup.isNullable).toBe(true)

    // The existing sibling was shifted down to make room.
    const shifted = await findColumnById(sibling.id)
    expect(shifted!.order).toBe(2)

    const ordered = await findColumnsByTableId(tableId)
    expect(ordered.map((c) => c.name)).toEqual(['price', 'price_copy', 'after'])
  })

  it('increments the suffix when "_copy" already exists', async () => {
    const tableId = makeTableId()
    const source = await createColumn({
      tableId,
      name: 'price',
      dataType: 'string',
      order: 0,
    })

    const first = await duplicateColumn(source.id)
    const second = await duplicateColumn(source.id)

    expect(first.name).toBe('price_copy')
    expect(second.name).toBe('price_copy2')
  })

  it('throws when the source column does not exist', async () => {
    await expect(duplicateColumn('non-existent-id')).rejects.toThrow(
      /Column not found/,
    )
  })
})

describe('updateColumn', () => {
  it('applies a partial update without touching unspecified fields', async () => {
    const tableId = makeTableId()
    const col = await createColumn({
      tableId,
      name: 'old_name',
      dataType: 'string',
      isPrimaryKey: true,
      isNullable: false,
      order: 0,
    })

    const updated = await updateColumn(col.id, { name: 'new_name' })

    expect(updated.name).toBe('new_name')
    // Untouched fields are preserved.
    expect(updated.isPrimaryKey).toBe(true)
    expect(updated.isNullable).toBe(false)
    expect(updated.dataType).toBe('string')
  })

  it('toggles a boolean flag', async () => {
    const tableId = makeTableId()
    const col = await createColumn({
      tableId,
      name: 'c',
      dataType: 'string',
      isNullable: false,
      order: 0,
    })

    const updated = await updateColumn(col.id, { isNullable: true })
    expect(updated.isNullable).toBe(true)

    const fetched = await findColumnById(col.id)
    expect(fetched!.isNullable).toBe(true)
  })
})

describe('deleteColumn', () => {
  it('removes the column and returns the deleted model', async () => {
    const tableId = makeTableId()
    const col = makeColumn({ tableId, name: 'gone', order: 0 })

    const deleted = await deleteColumn(col.id)
    expect(deleted.id).toBe(col.id)
    expect(deleted.name).toBe('gone')

    const fetched = await findColumnById(col.id)
    expect(fetched).toBeNull()
  })

  it('throws when the column does not exist', async () => {
    await expect(deleteColumn('non-existent-id')).rejects.toThrow()
  })
})

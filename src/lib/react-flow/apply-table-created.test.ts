// src/lib/react-flow/apply-table-created.test.ts
// Unit tests for the applyTableCreated helper (GH #125).
import { describe, expect, it } from 'vitest'
import { applyTableCreated } from './apply-table-created'
import type { Column, DiagramTable } from '@/data/models'

const baseTable: DiagramTable = {
  id: 'tbl-new',
  whiteboardId: 'wb-1',
  name: 'widgets',
  description: null,
  positionX: 100,
  positionY: 200,
  width: 240,
  height: 160,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const existingTable: DiagramTable & { columns: Array<Column> } = {
  id: 'tbl-existing',
  whiteboardId: 'wb-1',
  name: 'users',
  description: null,
  positionX: 0,
  positionY: 0,
  width: 240,
  height: 160,
  createdAt: new Date(),
  updatedAt: new Date(),
  columns: [],
}

describe('applyTableCreated', () => {
  it('inserts the new table, defaulting columns to []', () => {
    const old = { tables: [existingTable] }

    const result = applyTableCreated(old, baseTable)

    expect(result?.tables).toHaveLength(2)
    expect(result?.tables[1]).toMatchObject({ id: 'tbl-new', columns: [] })
  })

  it('is idempotent — a duplicate id does not double-insert', () => {
    const old = { tables: [existingTable, { ...baseTable, columns: [] }] }

    const result = applyTableCreated(old, baseTable)

    expect(result?.tables).toHaveLength(2)
    // No-op: same reference returned, proving no double-apply.
    expect(result).toBe(old)
  })

  it('returns old unchanged when the cache has not loaded yet', () => {
    const result = applyTableCreated(undefined, baseTable)

    expect(result).toBeUndefined()
  })

  it('returns old unchanged when old.tables is missing', () => {
    const old = { somethingElse: true } as any

    const result = applyTableCreated(old, baseTable)

    expect(result).toBe(old)
  })
})

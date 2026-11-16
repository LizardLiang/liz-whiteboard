// src/data/column-batch.test.ts
// createColumnsOnOneBoard: one board per request, one transaction.

import { beforeEach, describe, expect, it } from 'vitest'
import { CROSS_BOARD_MESSAGE, createColumnsOnOneBoard } from './column-batch'
import { db } from '@/db'
import {
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

beforeEach(() => resetDb())

const count = (table: string): number =>
  Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number })
      .n,
  )

function twoBoards() {
  const user = makeUser()
  const project = makeProject({ ownerId: user.id })
  const a = makeWhiteboard({ projectId: project.id })
  const b = makeWhiteboard({ projectId: project.id })
  return {
    user,
    boardA: a.id,
    tableA: makeTable({ whiteboardId: a.id, name: 'A' }).id,
    tableA2: makeTable({ whiteboardId: a.id, name: 'A2' }).id,
    tableB: makeTable({ whiteboardId: b.id, name: 'B' }).id,
  }
}

const col = (tableId: string, name: string) => ({
  tableId,
  name,
  dataType: 'string' as const,
})

describe('createColumnsOnOneBoard', () => {
  it('refuses a request that spans two whiteboards and writes nothing', async () => {
    const f = twoBoards()
    await expect(
      createColumnsOnOneBoard(f.user.id, {
        columns: [col(f.tableA, 'x'), col(f.tableB, 'y')],
      }),
    ).rejects.toThrow(CROSS_BOARD_MESSAGE)
    expect(count('Column')).toBe(0)
    expect(count('SchemaChangeEvent')).toBe(0)
  })

  it('writes columns of several tables on one board in one go, one event each', async () => {
    const f = twoBoards()
    const created = await createColumnsOnOneBoard(f.user.id, {
      columns: [col(f.tableA, 'x'), col(f.tableA2, 'y'), col(f.tableA, 'z')],
    })
    expect(created.map((c) => c.name)).toEqual(['x', 'y', 'z'])
    expect(count('SchemaChangeEvent')).toBe(3)
    const boards = db
      .prepare('SELECT DISTINCT "whiteboardId" FROM "SchemaChangeEvent"')
      .all()
    expect(boards).toEqual([{ whiteboardId: f.boardA }])
  })

  it('rolls every column back when one fails', async () => {
    const f = twoBoards()
    await expect(
      createColumnsOnOneBoard(f.user.id, {
        columns: [col(f.tableA, 'x'), col(f.tableA, 'x')],
      }),
    ).rejects.toThrow()
    expect(count('Column')).toBe(0)
  })
})

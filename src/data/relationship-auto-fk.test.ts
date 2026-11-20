// src/data/relationship-auto-fk.test.ts
// A relationship's source column is its foreign-key side (the DDL generator
// emits FOREIGN KEY (<source column>)). Writing a relationship keeps that
// column's isForeignKey flag in step: on while it sources a relationship,
// off when the last such relationship goes. Real in-memory SQLite.

import { beforeEach, describe, expect, it } from 'vitest'

import { deleteColumn, findColumnById, updateColumn } from './column'
import { deleteDiagramTable } from './diagram-table'
import {
  createRelationship,
  deleteRelationship,
  updateRelationship,
} from './relationship'
import type { ChangeContext } from '@/lib/schema-changelog'
import { db } from '@/db'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'
import { SYSTEM, userContext } from '@/lib/schema-changelog'

function board() {
  const project = makeProject()
  const whiteboardId = makeWhiteboard({ projectId: project.id }).id
  const orders = makeTable({ whiteboardId, name: 'orders' }).id
  const users = makeTable({ whiteboardId, name: 'users' }).id
  const products = makeTable({ whiteboardId, name: 'products' }).id
  return {
    whiteboardId,
    orders,
    users,
    products,
    orderUserId: makeColumn({ tableId: orders, name: 'user_id', order: 1 }).id,
    orderProductId: makeColumn({
      tableId: orders,
      name: 'product_id',
      order: 2,
    }).id,
    orderNote: makeColumn({ tableId: orders, name: 'note', order: 3 }).id,
    userPk: makeColumn({ tableId: users, name: 'id', isPrimaryKey: true }).id,
    productPk: makeColumn({ tableId: products, name: 'id', isPrimaryKey: true })
      .id,
  }
}

type Board = ReturnType<typeof board>

const actor = (b: Board) => userContext(b.whiteboardId, 'u1')

function link(
  b: Board,
  sourceTableId: string,
  sourceColumnId: string,
  targetTableId: string,
  targetColumnId: string,
  ctx: ChangeContext = SYSTEM,
) {
  return createRelationship(
    {
      whiteboardId: b.whiteboardId,
      sourceTableId,
      targetTableId,
      sourceColumnId,
      targetColumnId,
      cardinality: 'MANY_TO_ONE',
    },
    ctx,
  )
}

const isFk = async (id: string) => (await findColumnById(id))!.isForeignKey

function columnChanges(columnId: string): number {
  return Number(
    (
      db
        .prepare(
          `SELECT count(*) AS c FROM "SchemaChangeEvent" WHERE "entityType" = 'column' AND "entityId" = ?`,
        )
        .get(columnId) as { c: number }
    ).c,
  )
}

beforeEach(() => resetDb())

describe('createRelationship', () => {
  it('turns the source column FK on and leaves the target column alone', async () => {
    const b = board()
    await link(b, b.orders, b.orderUserId, b.users, b.userPk)

    expect(await isFk(b.orderUserId)).toBe(true)
    expect(await isFk(b.userPk)).toBe(false)
    expect(await isFk(b.orderNote)).toBe(false)
  })

  it('records the flag change in the schema changelog', async () => {
    const b = board()
    await link(b, b.orders, b.orderUserId, b.users, b.userPk, actor(b))

    const row = db
      .prepare(
        `SELECT "action","before","after" FROM "SchemaChangeEvent" WHERE "entityType" = 'column' AND "entityId" = ?`,
      )
      .get(b.orderUserId) as { action: string; before: string; after: string }
    expect(row.action).toBe('update')
    expect(JSON.parse(row.before).isForeignKey).toBe(false)
    expect(JSON.parse(row.after).isForeignKey).toBe(true)
  })

  it('records no extra change when the source column is already FK', async () => {
    const b = board()
    await updateColumn(b.orderUserId, { isForeignKey: true }, actor(b))
    const before = columnChanges(b.orderUserId)
    expect(before).toBe(1)

    await link(b, b.orders, b.orderUserId, b.users, b.userPk, actor(b))

    expect(await isFk(b.orderUserId)).toBe(true)
    expect(columnChanges(b.orderUserId)).toBe(before)
  })

  it('rolls the flag back when the relationship is refused', async () => {
    const b = board()
    await expect(
      link(b, b.orders, b.userPk, b.users, b.userPk),
    ).rejects.toThrow()
    expect(await isFk(b.userPk)).toBe(false)
  })
})

describe('deleteRelationship', () => {
  it('turns the FK off when the last relationship from the column goes', async () => {
    const b = board()
    const rel = await link(b, b.orders, b.orderUserId, b.users, b.userPk)

    await deleteRelationship(rel.id, SYSTEM)

    expect(await isFk(b.orderUserId)).toBe(false)
  })

  it('keeps the FK on while another relationship still has the column as source', async () => {
    const b = board()
    const first = await link(b, b.orders, b.orderUserId, b.users, b.userPk)
    await link(b, b.orders, b.orderUserId, b.products, b.productPk)

    await deleteRelationship(first.id, SYSTEM)

    expect(await isFk(b.orderUserId)).toBe(true)
  })

  it('leaves a column that is only a target untouched', async () => {
    const b = board()
    await updateColumn(b.userPk, { isForeignKey: true }, SYSTEM)
    const rel = await link(b, b.orders, b.orderUserId, b.users, b.userPk)

    await deleteRelationship(rel.id, SYSTEM)

    expect(await isFk(b.userPk)).toBe(true)
  })
})

describe('updateRelationship (reconnect)', () => {
  it('moves the FK from the old source column to the new one', async () => {
    const b = board()
    const rel = await link(b, b.orders, b.orderUserId, b.users, b.userPk)

    await updateRelationship(
      rel.id,
      { sourceColumnId: b.orderProductId },
      SYSTEM,
    )

    expect(await isFk(b.orderUserId)).toBe(false)
    expect(await isFk(b.orderProductId)).toBe(true)
  })
})

describe('cascade deletes', () => {
  it('turns the source FK off when its target column is deleted', async () => {
    const b = board()
    await link(b, b.orders, b.orderUserId, b.users, b.userPk)

    await deleteColumn(b.userPk, SYSTEM)

    expect(await isFk(b.orderUserId)).toBe(false)
  })

  it('keeps the source FK when another relationship survives the cascade', async () => {
    const b = board()
    await link(b, b.orders, b.orderUserId, b.users, b.userPk)
    await link(b, b.orders, b.orderUserId, b.products, b.productPk)

    await deleteColumn(b.userPk, SYSTEM)

    expect(await isFk(b.orderUserId)).toBe(true)
  })

  it('turns the source FK off when its target table is deleted', async () => {
    const b = board()
    await link(b, b.orders, b.orderUserId, b.users, b.userPk)

    await deleteDiagramTable(b.users, SYSTEM)

    expect(await isFk(b.orderUserId)).toBe(false)
  })
})

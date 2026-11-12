// src/data/retired-id.test.ts
// The RetiredId tombstones (schema-sql.ts triggers) and the rule built on them:
// a client-chosen id that last belonged to ANOTHER whiteboard is refused, so a
// deleted row's id cannot be squatted from another tenant. The id of the
// caller's own whiteboard stays claimable (undo-restore re-uses it).

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDiagramTable } from './diagram-table'
import { createColumn } from './column'
import { createRelationship } from './relationship'
import { createArea } from './area'
import { createCanvasBoard } from './canvas-board'
import { createCanvasElement } from './canvas-element'
import { db, insert } from '@/db'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

function retired(id: string): { entity: string; whiteboardId: string } | null {
  const row = db
    .prepare('SELECT "entity", "whiteboardId" FROM "RetiredId" WHERE "id" = ?')
    .get(id) as { entity: string; whiteboardId: string } | undefined
  return row ? { entity: row.entity, whiteboardId: row.whiteboardId } : null
}

function retiredCount(): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM "RetiredId"').get() as { n: number }
  ).n
}

function del(table: string, id: string): void {
  db.prepare(`DELETE FROM "${table}" WHERE "id" = ?`).run(id)
}

beforeEach(() => resetDb())

describe('RetiredId triggers', () => {
  it('records a deleted table, and its columns through the FK cascade', () => {
    const wb = makeWhiteboard({ projectId: makeProject().id })
    const table = makeTable({ whiteboardId: wb.id })
    const column = makeColumn({ tableId: table.id })

    del('DiagramTable', table.id)

    expect(retired(table.id)).toEqual({
      entity: 'DiagramTable',
      whiteboardId: wb.id,
    })
    expect(retired(column.id)).toEqual({
      entity: 'Column',
      whiteboardId: wb.id,
    })
  })

  it('records a column deleted on its own, with the whiteboard of its table', () => {
    const wb = makeWhiteboard({ projectId: makeProject().id })
    const table = makeTable({ whiteboardId: wb.id })
    const column = makeColumn({ tableId: table.id })

    del('Column', column.id)

    expect(retired(column.id)).toEqual({
      entity: 'Column',
      whiteboardId: wb.id,
    })
    expect(retired(table.id)).toBeNull()
  })

  it('records relationships and areas, including ones removed by a table cascade', async () => {
    const wb = makeWhiteboard({ projectId: makeProject().id })
    const a = makeTable({ whiteboardId: wb.id, name: 'a' })
    const b = makeTable({ whiteboardId: wb.id, name: 'b' })
    const ca = makeColumn({ tableId: a.id })
    const cb = makeColumn({ tableId: b.id })
    const rel = await createRelationship({
      whiteboardId: wb.id,
      sourceTableId: a.id,
      targetTableId: b.id,
      sourceColumnId: ca.id,
      targetColumnId: cb.id,
      cardinality: 'ONE_TO_MANY',
    })
    const area = await createArea({
      whiteboardId: wb.id,
      name: 'area',
      color: 'red',
      positionX: 0,
      positionY: 0,
      width: 100,
      height: 100,
      memberTableIds: [],
    })

    del('DiagramTable', a.id)
    del('Area', area.id)

    expect(retired(rel.id)).toEqual({
      entity: 'Relationship',
      whiteboardId: wb.id,
    })
    expect(retired(area.id)).toEqual({ entity: 'Area', whiteboardId: wb.id })
  })

  it('records a deleted canvas element against its board', async () => {
    const board = await createCanvasBoard({
      name: 'c',
      projectId: makeProject().id,
    })
    const el = await createCanvasElement({
      boardId: board.id,
      kind: 'rectangle',
      positionX: 0,
      positionY: 0,
      width: 10,
      height: 10,
      props: { kind: 'rectangle' },
    })

    del('CanvasElement', el.id)

    expect(retired(el.id)).toEqual({
      entity: 'CanvasElement',
      whiteboardId: board.id,
    })
  })

  it('updates the tombstone when a re-created id is deleted again', () => {
    const projectId = makeProject().id
    const first = makeWhiteboard({ projectId })
    const second = makeWhiteboard({ projectId })
    const id = randomUUID()
    const ts = Date.now()
    const row = (whiteboardId: string, name: string) =>
      insert('DiagramTable', {
        id,
        whiteboardId,
        name,
        createdAt: ts,
        updatedAt: ts,
      })
    row(first.id, 't')
    del('DiagramTable', id)
    row(second.id, 't')
    del('DiagramTable', id)

    expect(retired(id)?.whiteboardId).toBe(second.id)
    expect(retiredCount()).toBe(1)
  })

  it('prunes the tombstones of a deleted whiteboard, including its cascaded children', () => {
    const projectId = makeProject().id
    const wb = makeWhiteboard({ projectId })
    const keep = makeWhiteboard({ projectId })
    const table = makeTable({ whiteboardId: wb.id })
    makeColumn({ tableId: table.id })
    const keptTable = makeTable({ whiteboardId: keep.id })
    del('DiagramTable', keptTable.id)
    expect(retiredCount()).toBe(1)

    del('Whiteboard', wb.id)

    expect(retiredCount()).toBe(1)
    expect(retired(keptTable.id)?.whiteboardId).toBe(keep.id)
  })

  it('prunes a board whose whole project is deleted', async () => {
    const project = makeProject()
    const wb = makeWhiteboard({ projectId: project.id })
    makeColumn({ tableId: makeTable({ whiteboardId: wb.id }).id })
    del('DiagramTable', makeTable({ whiteboardId: wb.id, name: 'x' }).id)
    expect(retiredCount()).toBe(1)

    del('Project', project.id)

    expect(retiredCount()).toBe(0)
  })

  it('prunes the tombstones of a deleted canvas board', async () => {
    const board = await createCanvasBoard({
      name: 'c',
      projectId: makeProject().id,
    })
    const el = await createCanvasElement({
      boardId: board.id,
      kind: 'rectangle',
      positionX: 0,
      positionY: 0,
      width: 10,
      height: 10,
      props: { kind: 'rectangle' },
    })
    del('CanvasElement', el.id)
    expect(retiredCount()).toBe(1)

    del('CanvasBoard', board.id)

    expect(retiredCount()).toBe(0)
  })
})

describe('a client id that last belonged to another whiteboard', () => {
  it('cannot be claimed for a table or a column, but can on the home whiteboard', async () => {
    const home = makeWhiteboard({ projectId: makeProject().id })
    const elsewhere = makeWhiteboard({ projectId: makeProject().id })
    const table = makeTable({ whiteboardId: home.id })
    const column = makeColumn({ tableId: table.id })
    del('DiagramTable', table.id)

    await expect(
      createDiagramTable({
        id: table.id,
        whiteboardId: elsewhere.id,
        name: 'x',
      }),
    ).rejects.toThrow('Failed to create table')
    const squatTable = makeTable({ whiteboardId: elsewhere.id })
    await expect(
      createColumn({
        id: column.id,
        tableId: squatTable.id,
        name: 'INJECTED',
        dataType: 'text',
        order: 0,
      }),
    ).rejects.toThrow('Failed to create column')

    const back = await createDiagramTable({
      id: table.id,
      whiteboardId: home.id,
      name: 'x',
    })
    expect(back.id).toBe(table.id)
    const backColumn = await createColumn({
      id: column.id,
      tableId: back.id,
      name: 'c',
      dataType: 'text',
      order: 0,
    })
    expect(backColumn.id).toBe(column.id)
  })

  it('cannot be claimed for a relationship, an area or a canvas element', async () => {
    const home = makeWhiteboard({ projectId: makeProject().id })
    const elsewhere = makeWhiteboard({ projectId: makeProject().id })
    const area = await createArea({
      whiteboardId: home.id,
      name: 'a',
      color: 'red',
      positionX: 0,
      positionY: 0,
      width: 10,
      height: 10,
      memberTableIds: [],
    })
    del('Area', area.id)
    await expect(
      createArea({
        id: area.id,
        whiteboardId: elsewhere.id,
        name: 'a',
        color: 'red',
        positionX: 0,
        positionY: 0,
        width: 10,
        height: 10,
        memberTableIds: [],
      }),
    ).rejects.toThrow('Failed to create area')

    const homeBoard = await createCanvasBoard({
      name: 'h',
      projectId: makeProject().id,
    })
    const otherBoard = await createCanvasBoard({
      name: 'o',
      projectId: makeProject().id,
    })
    const el = await createCanvasElement({
      boardId: homeBoard.id,
      kind: 'rectangle',
      positionX: 0,
      positionY: 0,
      width: 10,
      height: 10,
      props: { kind: 'rectangle' },
    })
    del('CanvasElement', el.id)
    const attempt = (boardId: string) =>
      createCanvasElement({
        id: el.id,
        boardId,
        kind: 'rectangle',
        positionX: 0,
        positionY: 0,
        width: 10,
        height: 10,
        props: { kind: 'rectangle' },
      })
    await expect(attempt(otherBoard.id)).rejects.toThrow(
      'Failed to create canvas element',
    )
    expect((await attempt(homeBoard.id)).id).toBe(el.id)
  })
})

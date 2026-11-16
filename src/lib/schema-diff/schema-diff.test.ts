// src/lib/schema-diff/schema-diff.test.ts
import { describe, expect, it } from 'vitest'
import { diffBoards } from './index'
import type { DiffablePayload } from './index'

function col(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    dataType: 'int',
    isPrimaryKey: false,
    isForeignKey: false,
    isUnique: false,
    isNullable: true,
    description: null,
    order: 0,
    ...extra,
  }
}

function table(
  id: string,
  name: string,
  columns: Array<ReturnType<typeof col>>,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    description: null,
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 100,
    columns,
    ...extra,
  }
}

function rel(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    sourceTableId: 't2',
    targetTableId: 't1',
    sourceColumnId: 'c3',
    targetColumnId: 'c1',
    cardinality: 'MANY_TO_ONE',
    label: null,
    routingPoints: null,
    ...extra,
  }
}

function board(overrides: Partial<DiffablePayload> = {}): DiffablePayload {
  return {
    tables: [
      table('t1', 'User', [col('c1', 'id'), col('c2', 'mail')]),
      table('t2', 'Order', [col('c3', 'userId')]),
    ],
    relationships: [rel('r1')],
    areas: [],
    ...overrides,
  }
}

describe('diffBoards', () => {
  it('returns nothing for identical boards', () => {
    expect(diffBoards(board(), board())).toEqual({
      added: [],
      removed: [],
      changed: [],
    })
  })

  it('reports a renamed column as changed, old -> new, matched by id', () => {
    const newer = board({
      tables: [
        table('t1', 'User', [col('c1', 'id'), col('c2', 'email')]),
        table('t2', 'Order', [col('c3', 'userId')]),
      ],
    })
    const diff = diffBoards(board(), newer)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toMatchObject({
      entityType: 'column',
      name: 'email',
      tableName: 'User',
      fields: [
        { field: 'name', before: 'mail', after: 'email', layout: false },
      ],
    })
  })

  it('lists added and removed columns on a surviving table', () => {
    const newer = board({
      tables: [
        table('t1', 'User', [col('c1', 'id'), col('c9', 'age')]),
        table('t2', 'Order', [col('c3', 'userId')]),
      ],
    })
    const diff = diffBoards(board(), newer)
    expect(diff.added.map((e) => [e.entityType, e.name])).toEqual([
      ['column', 'age'],
    ])
    expect(diff.removed.map((e) => [e.entityType, e.name])).toEqual([
      ['column', 'mail'],
    ])
  })

  it('folds the columns of an added or removed table into its entry', () => {
    const newer = board({
      tables: [
        ...board().tables,
        table('t3', 'Invoice', [col('c7', 'id'), col('c8', 'total')]),
      ],
    })
    const diff = diffBoards(board(), newer)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toMatchObject({
      entityType: 'table',
      name: 'Invoice',
    })
    expect(diff.added[0].fields).toContainEqual({
      field: 'columns',
      before: null,
      after: 'id, total',
      layout: false,
    })
    const back = diffBoards(newer, board())
    expect(back.removed).toHaveLength(1)
    expect(back.removed[0].fields).toContainEqual({
      field: 'columns',
      before: 'id, total',
      after: null,
      layout: false,
    })
  })

  it('tags position and size changes as layout', () => {
    const newer = board({
      tables: [
        table('t1', 'User', [col('c1', 'id'), col('c2', 'mail')], {
          positionX: 50,
          width: 300,
          name: 'Account',
        }),
        table('t2', 'Order', [col('c3', 'userId')]),
      ],
    })
    const [entry] = diffBoards(board(), newer).changed
    const byField = Object.fromEntries(
      entry.fields.map((f) => [f.field, f.layout]),
    )
    expect(byField).toEqual({ name: false, positionX: true, width: true })
  })

  it('tags routingPoints as layout and reads relationship changes by name', () => {
    const newer = board({
      relationships: [
        rel('r1', {
          cardinality: 'ONE_TO_ONE',
          routingPoints: [{ x: 1, y: 2 }],
        }),
      ],
    })
    const [entry] = diffBoards(board(), newer).changed
    expect(entry.name).toBe('Order.userId -> User.id')
    expect(entry.fields.map((f) => [f.field, f.layout])).toEqual([
      ['cardinality', false],
      ['routingPoints', true],
    ])
  })

  it('does not ripple a column or table rename into relationships and areas', () => {
    const area = {
      id: 'a1',
      name: 'Core',
      color: 'blue',
      positionX: 0,
      positionY: 0,
      width: 1,
      height: 1,
      memberTableIds: ['t1'],
    }
    const newer = board({
      tables: [
        table('t1', 'Account', [col('c1', 'uid'), col('c2', 'mail')]),
        table('t2', 'Order', [col('c3', 'userId')]),
      ],
      areas: [area],
    })
    const diff = diffBoards(board({ areas: [area] }), newer)
    expect(diff.changed.map((e) => e.entityType).sort()).toEqual([
      'column',
      'table',
    ])
  })

  it('reports an added and a removed relationship', () => {
    const newer = board({ relationships: [rel('r2', { label: 'owns' })] })
    const diff = diffBoards(board(), newer)
    expect(diff.added.map((e) => e.name)).toEqual(['owns'])
    expect(diff.removed.map((e) => e.name)).toEqual(['Order.userId -> User.id'])
  })

  it('compares areas, resolving members to table names', () => {
    const older = board({
      areas: [
        {
          id: 'a1',
          name: 'Core',
          color: 'blue',
          positionX: 0,
          positionY: 0,
          width: 400,
          height: 300,
          memberTableIds: ['t1'],
        },
      ],
    })
    const newer = board({
      areas: [
        {
          id: 'a1',
          name: 'Core',
          color: 'blue',
          positionX: 0,
          positionY: 0,
          width: 400,
          height: 300,
          memberTableIds: ['t1', 't2'],
        },
      ],
    })
    const [entry] = diffBoards(older, newer).changed
    expect(entry.fields).toEqual([
      { field: 'members', before: 'User', after: 'Order, User', layout: false },
    ])
  })

  it('treats a payload without areas as having none', () => {
    const { areas: _areas, ...noAreas } = board()
    expect(diffBoards(noAreas, board()).changed).toEqual([])
  })

  it('keeps CJK names and long values', () => {
    const long = 'x'.repeat(500)
    const older = board({
      tables: [table('t1', '使用者', [col('c1', '編號')])],
      relationships: [],
    })
    const newer = board({
      tables: [
        table('t1', '使用者', [col('c1', '編號', { description: long })]),
      ],
      relationships: [],
    })
    const [entry] = diffBoards(older, newer).changed
    expect(entry.tableName).toBe('使用者')
    expect(entry.fields[0].after).toHaveLength(201)
  })

  it('orders entries by table, then kind', () => {
    const newer = board({
      tables: [
        table('t1', 'User', [
          col('c1', 'id'),
          col('c2', 'mail'),
          col('c9', 'a'),
        ]),
        table('t2', 'Order', [col('c3', 'userId'), col('c8', 'b')]),
        table('t5', 'Aaa', []),
      ],
    })
    expect(
      diffBoards(board(), newer).added.map((e) => `${e.entityType}:${e.name}`),
    ).toEqual(['table:Aaa', 'column:b', 'column:a'])
  })
})

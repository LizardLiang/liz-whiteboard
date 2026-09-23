import { describe, expect, it } from 'vitest'
import {
  buildJoinQueryPlan,
  generateJoinQuerySql,
  getJoinQueryTree,
  type JoinQueryRelationship,
  type JoinQueryTable,
} from './join-query-generator'

const table = (
  id: string,
  name: string,
  x: number,
  y: number,
  columns = ['id'],
): JoinQueryTable => ({
  id,
  name,
  position: { x, y },
  columns: columns.map((column, order) => ({
    id: `${id}-${column}`,
    name: column,
    order,
  })),
})

const relationship = (
  id: string,
  source: string,
  target: string,
  sourceColumn = 'id',
  targetColumn = 'id',
): JoinQueryRelationship => ({
  id,
  sourceTableId: source,
  targetTableId: target,
  sourceColumnId: `${source}-${sourceColumn}`,
  targetColumnId: `${target}-${targetColumn}`,
})

describe('join query generator', () => {
  it('partitions selected tables into JOIN components and singleton SELECTs', () => {
    const tables = [
      table('a', 'accounts', 0, 0, ['id', 'name']),
      table('b', 'orders', 200, 0, ['id', 'account_id']),
      table('c', 'audit log', 0, 300, ['event id']),
    ]
    const plan = buildJoinQueryPlan(tables, [
      relationship('r1', 'b', 'a', 'account_id'),
    ])

    expect(plan.components.map((component) => component.tableIds)).toEqual([
      ['a', 'b'],
      ['c'],
    ])
    expect(generateJoinQuerySql(plan, { dialect: 'postgres' })).toContain(
      'INNER JOIN "orders" AS "o" ON "o"."account_id" = "a"."id"',
    )
    expect(generateJoinQuerySql(plan, { dialect: 'postgres' })).toContain(
      'FROM "audit log" AS "al";',
    )
  })

  it('uses collision-safe aliases and quotes hostile identifiers per dialect', () => {
    const tables = [
      table('a', 'order', 0, 0, ['user`name']),
      table('b', 'order items', 200, 0, ['order_id']),
      table('c', 'order info', 400, 0, ['order_id']),
    ]
    const plan = buildJoinQueryPlan(tables, [
      relationship('r1', 'a', 'b', 'user`name', 'order_id'),
      relationship('r2', 'b', 'c', 'order_id', 'order_id'),
    ])
    const sql = generateJoinQuerySql(plan, { dialect: 'mysql' })

    expect(sql).toContain('`o`.`user``name` AS `o_user``name`')
    expect(sql).toContain('`oi`.`order_id` AS `oi_order_id`')
    expect(sql).toContain('`oi2`.`order_id` AS `oi2_order_id`')
  })

  it('requires a choice for parallel relationships and offers cycle edges', () => {
    const tables = [
      table('a', 'a', 0, 0, ['id', 'owner_id']),
      table('b', 'b', 100, 0, ['id', 'owner_id']),
      table('c', 'c', 200, 0, ['id']),
    ]
    const plan = buildJoinQueryPlan(tables, [
      relationship('ab1', 'a', 'b'),
      relationship('ab2', 'a', 'b', 'owner_id', 'owner_id'),
      relationship('bc', 'b', 'c'),
      relationship('ca', 'c', 'a'),
    ])

    expect(plan.components[0].ambiguousEdges[0].relationshipIds).toEqual([
      'ab1',
      'ab2',
    ])
    expect(plan.components[0].omittedRelationshipIds).toHaveLength(1)
    expect(() => generateJoinQuerySql(plan, { dialect: 'postgres' })).toThrow(
      /Choose a relationship/,
    )
    expect(
      generateJoinQuerySql(plan, {
        dialect: 'postgres',
        relationshipChoices: { 'a|b': 'ab2' },
        includedOmittedRelationshipIds:
          plan.components[0].omittedRelationshipIds,
      }),
    ).toContain('WHERE')
  })

  it('supports root overrides, join types, and rejects FULL for MySQL', () => {
    const plan = buildJoinQueryPlan(
      [table('a', 'authors', 0, 0), table('b', 'books', 100, 0)],
      [relationship('r1', 'a', 'b')],
    )

    expect(
      generateJoinQuerySql(plan, {
        dialect: 'mssql',
        rootTableIds: { [plan.components[0].id]: 'b' },
        joinTypes: { r1: 'LEFT' },
      }),
    ).toContain('FROM [books] AS [b]\nLEFT JOIN [authors] AS [a]')
    expect(() =>
      generateJoinQuerySql(plan, {
        dialect: 'mysql',
        joinTypes: { r1: 'FULL' },
      }),
    ).toThrow(/FULL OUTER JOIN is not supported by MySQL/)
  })

  it('recomputes the JOIN tree when the root changes', () => {
    const plan = buildJoinQueryPlan(
      [
        table('a', 'accounts', 0, 0),
        table('b', 'books', 100, 0),
        table('c', 'categories', 200, 0),
      ],
      [
        relationship('ab', 'a', 'b'),
        relationship('ac', 'a', 'c'),
        relationship('bc', 'b', 'c'),
      ],
    )
    const component = plan.components[0]

    expect(
      getJoinQueryTree(plan, component, 'a').map((edge) => edge.key),
    ).toEqual(['a|b', 'a|c'])
    expect(
      getJoinQueryTree(plan, component, 'c').map((edge) => edge.key),
    ).toEqual(['a|c', 'a|b'])
  })

  it('marks complete external tables and skips incomplete references', () => {
    const plan = buildJoinQueryPlan(
      [
        table('a', 'local', 0, 0),
        { ...table('x', 'remote', 100, 0), external: true },
        {
          ...table('missing', 'gone', 200, 0),
          external: true,
          incompleteReason: 'Source table is missing',
        },
      ],
      [relationship('r1', 'a', 'x')],
    )

    expect(plan.skippedTables).toEqual([
      { id: 'missing', name: 'gone', reason: 'Source table is missing' },
    ])
    expect(plan.components[0].externalTableIds).toEqual(['x'])
    expect(generateJoinQuerySql(plan, { dialect: 'postgres' })).toContain(
      '-- external table: "remote"',
    )
  })
})

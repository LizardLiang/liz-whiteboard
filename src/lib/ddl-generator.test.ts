// src/lib/ddl-generator.test.ts
// Unit tests for the client-side DDL generator port of internal/ddl
// (liz-whiteboard-mcp). Golden-output cases are ported 1:1 from
// internal/ddl/ddl_test.go so output stays byte-for-byte identical to the
// Go MCP server's get_table_ddl tool.

import { describe, expect, it } from 'vitest'
import {
  DIALECTS,
  generateTableDDL,
  getTypeMapKeys,
  isValidDialect,
  quoteIdent,
} from './ddl-generator'
import type { DiagramTableWithRelations } from '@/data/diagram-table'
import type { Column } from '@/data/models'
import { dataTypeSchema } from '@/data/schema'

// ---------------------------------------------------------------------------
// Fixture builders — minimal valid Column/DiagramTable/Relationship values
// with sensible defaults, overridable per test.
// ---------------------------------------------------------------------------

function makeColumn(
  overrides: Partial<Column> & {
    id: string
    tableId: string
    name: string
    dataType: string
  },
): Column {
  return {
    isPrimaryKey: false,
    isForeignKey: false,
    isUnique: false,
    isNullable: false,
    description: null,
    order: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

function makeTable(
  overrides: Partial<DiagramTableWithRelations> & { id: string; name: string },
): DiagramTableWithRelations {
  return {
    whiteboardId: 'wb-1',
    description: null,
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    columns: [],
    outgoingRelationships: [],
    incomingRelationships: [],
    ...overrides,
  }
}

function makeRelationship(
  overrides: Partial<
    DiagramTableWithRelations['outgoingRelationships'][number]
  > & {
    id: string
    sourceTableId: string
    targetTableId: string
    sourceColumnId: string
    targetColumnId: string
  },
): DiagramTableWithRelations['outgoingRelationships'][number] {
  return {
    whiteboardId: 'wb-1',
    cardinality: 'MANY_TO_ONE',
    label: null,
    routingPoints: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// quoteIdent / isValidDialect — ported from TestQuoteIdent / TestIsValidDialect
// ---------------------------------------------------------------------------

describe('quoteIdent', () => {
  it.each([
    ['postgres', 'users', '"users"'],
    ['postgres', 'w"eird', '"w""eird"'],
    ['mysql', 'users', '`users`'],
    ['mysql', 'w`eird', '`w``eird`'],
    ['mssql', 'users', '[users]'],
    ['mssql', 'w]eird', '[w]]eird]'],
  ] as const)('quoteIdent(%s, %s) === %s', (dialect, name, want) => {
    expect(quoteIdent(dialect, name)).toBe(want)
  })
})

describe('isValidDialect', () => {
  it('accepts all three dialects', () => {
    for (const d of DIALECTS) {
      expect(isValidDialect(d)).toBe(true)
    }
  })

  it('rejects unrecognized values', () => {
    expect(isValidDialect('sqlite')).toBe(false)
    expect(isValidDialect('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Type map completeness — ported from TestTypeMapCompleteness
// (internal/ddl/ddl_test.go:20). Fails if a data type is added to
// dataTypeSchema.options without a corresponding mapping in every dialect's
// type map, or vice versa.
// ---------------------------------------------------------------------------

describe('type map completeness', () => {
  const wantKeys = [...dataTypeSchema.options].sort()

  it.each(DIALECTS)(
    '%s type map covers exactly dataTypeSchema.options',
    (dialect) => {
      const gotKeys = getTypeMapKeys(dialect).sort()
      expect(gotKeys).toEqual(wantKeys)
    },
  )
})

// ---------------------------------------------------------------------------
// generateTableDDL — golden cases ported from buildBoard() +
// TestGenerateTableDDL_Golden in ddl_test.go.
//
// Two-table board: "users" (referenced target) and "posts" (table under
// test), with one outgoing FK from posts.authorId to users.id. posts has a
// single-column identity PK ("id", dataType "serial"), a NOT NULL UNIQUE
// string column ("slug"), and the FK column ("authorId").
// ---------------------------------------------------------------------------

function buildBoard(): Array<DiagramTableWithRelations> {
  const usersId = 'tbl-users'
  const postsId = 'tbl-posts'

  const usersIdCol = makeColumn({
    id: 'col-users-id',
    tableId: usersId,
    name: 'id',
    dataType: 'uuid',
    isPrimaryKey: true,
    isNullable: false,
  })

  const postsIdCol = makeColumn({
    id: 'col-posts-id',
    tableId: postsId,
    name: 'id',
    dataType: 'serial',
    isPrimaryKey: true,
    isNullable: false,
    order: 0,
  })
  const authorIdCol = makeColumn({
    id: 'col-posts-authorId',
    tableId: postsId,
    name: 'authorId',
    dataType: 'uuid',
    isForeignKey: true,
    isNullable: false,
    order: 1,
  })
  const slugCol = makeColumn({
    id: 'col-posts-slug',
    tableId: postsId,
    name: 'slug',
    dataType: 'varchar',
    isNullable: false,
    isUnique: true,
    order: 2,
  })

  const rel = makeRelationship({
    id: 'rel-1',
    sourceTableId: postsId,
    targetTableId: usersId,
    sourceColumnId: authorIdCol.id,
    targetColumnId: usersIdCol.id,
    cardinality: 'MANY_TO_ONE',
  })

  const users = makeTable({
    id: usersId,
    name: 'users',
    columns: [usersIdCol],
  })
  const posts = makeTable({
    id: postsId,
    name: 'posts',
    columns: [postsIdCol, authorIdCol, slugCol],
    outgoingRelationships: [rel],
  })

  return [users, posts]
}

describe('generateTableDDL — golden cases (parity with internal/ddl/ddl_test.go)', () => {
  it('postgres', () => {
    const got = generateTableDDL(buildBoard(), 'tbl-posts', 'postgres')
    expect(got).toBe(
      'CREATE TABLE "posts" (\n' +
        '  "id" SERIAL NOT NULL PRIMARY KEY,\n' +
        '  "authorId" UUID NOT NULL,\n' +
        '  "slug" VARCHAR NOT NULL UNIQUE,\n' +
        '  FOREIGN KEY ("authorId") REFERENCES "users"("id")\n' +
        ');',
    )
  })

  it('mysql', () => {
    const got = generateTableDDL(buildBoard(), 'tbl-posts', 'mysql')
    expect(got).toBe(
      'CREATE TABLE `posts` (\n' +
        '  `id` INT AUTO_INCREMENT NOT NULL PRIMARY KEY,\n' +
        '  `authorId` CHAR(36) NOT NULL,\n' +
        '  `slug` VARCHAR(255) NOT NULL UNIQUE,\n' +
        '  FOREIGN KEY (`authorId`) REFERENCES `users`(`id`)\n' +
        ');',
    )
  })

  it('mssql', () => {
    const got = generateTableDDL(buildBoard(), 'tbl-posts', 'mssql')
    expect(got).toBe(
      'CREATE TABLE [posts] (\n' +
        '  [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,\n' +
        '  [authorId] UNIQUEIDENTIFIER NOT NULL,\n' +
        '  [slug] NVARCHAR(255) NOT NULL UNIQUE,\n' +
        '  FOREIGN KEY ([authorId]) REFERENCES [users]([id])\n' +
        ');',
    )
  })
})

// ---------------------------------------------------------------------------
// Composite PK — ported from TestGenerateTableDDL_CompositePK
// ---------------------------------------------------------------------------

it('composite PK renders a table-level PRIMARY KEY (...) constraint, not inline', () => {
  const tblId = 'tbl-membership'
  const col1 = makeColumn({
    id: 'col-1',
    tableId: tblId,
    name: 'userId',
    dataType: 'uuid',
    isPrimaryKey: true,
    isNullable: false,
    order: 0,
  })
  const col2 = makeColumn({
    id: 'col-2',
    tableId: tblId,
    name: 'groupId',
    dataType: 'uuid',
    isPrimaryKey: true,
    isNullable: false,
    order: 1,
  })

  const tables = [
    makeTable({ id: tblId, name: 'membership', columns: [col1, col2] }),
  ]

  const got = generateTableDDL(tables, tblId, 'postgres')

  expect(got).toBe(
    'CREATE TABLE "membership" (\n' +
      '  "userId" UUID NOT NULL,\n' +
      '  "groupId" UUID NOT NULL,\n' +
      '  PRIMARY KEY ("userId", "groupId")\n' +
      ');',
  )
  expect(got).not.toContain('PRIMARY KEY",\n')
})

// ---------------------------------------------------------------------------
// Not found — ported from TestGenerateTableDDL_NotFound
// ---------------------------------------------------------------------------

it('throws when tableId is not found', () => {
  const tables = buildBoard()
  expect(() => generateTableDDL(tables, 'does-not-exist', 'postgres')).toThrow()
})

// ---------------------------------------------------------------------------
// Zero columns — ported from TestGenerateTableDDL_ZeroColumns
// ---------------------------------------------------------------------------

it('throws when the resolved table has no columns', () => {
  const tblId = 'tbl-empty'
  const tables = [makeTable({ id: tblId, name: 'empty', columns: [] })]

  expect(() => generateTableDDL(tables, tblId, 'postgres')).toThrow(
    /no columns/,
  )
  try {
    generateTableDDL(tables, tblId, 'postgres')
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(tblId)
    expect((err as Error).message).toContain('no columns')
  }
})

// ---------------------------------------------------------------------------
// Column order independence — ported from
// TestGenerateTableDDL_ColumnOrderIndependent
// ---------------------------------------------------------------------------

it('sorts columns by order regardless of array arrival order', () => {
  const tblId = 'tbl-scrambled'
  const colA = makeColumn({
    id: 'col-a',
    tableId: tblId,
    name: 'a_first',
    dataType: 'uuid',
    order: 0,
    isNullable: false,
  })
  const colB = makeColumn({
    id: 'col-b',
    tableId: tblId,
    name: 'b_second',
    dataType: 'uuid',
    order: 1,
    isNullable: false,
  })
  const colC = makeColumn({
    id: 'col-c',
    tableId: tblId,
    name: 'c_third',
    dataType: 'uuid',
    order: 2,
    isNullable: false,
  })

  // Columns arrive scrambled: c, a, b — order fields still say a, b, c.
  const tables = [
    makeTable({ id: tblId, name: 'scrambled', columns: [colC, colA, colB] }),
  ]

  const got = generateTableDDL(tables, tblId, 'postgres')

  expect(got).toBe(
    'CREATE TABLE "scrambled" (\n' +
      '  "a_first" UUID NOT NULL,\n' +
      '  "b_second" UUID NOT NULL,\n' +
      '  "c_third" UUID NOT NULL\n' +
      ');',
  )
})

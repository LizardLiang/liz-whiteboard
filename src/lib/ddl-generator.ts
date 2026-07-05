// src/lib/ddl-generator.ts
//
// Client-side port of the Go MCP server's `internal/ddl` package
// (dialect.go, typemap.go, ddl.go). Generates single-table CREATE TABLE DDL
// entirely in TypeScript so the whiteboard app never needs to call the
// OAuth-protected MCP tool just to copy DDL to the clipboard.
//
// Every behavior here — identifier quoting/escaping, per-dialect type maps,
// column ordering, single vs. composite primary key rendering, foreign key
// constraint emission, and error conditions — must match the Go
// implementation exactly. See internal/ddl/ddl_test.go in the sibling
// liz-whiteboard-mcp repo for the golden test cases this was ported from.

import type { DiagramTableWithRelations } from '@/data/diagram-table'

/** Supported SQL dialects for DDL generation. Mirrors Go's ddl.Dialects. */
export type Dialect = 'postgres' | 'mysql' | 'mssql'

/** Ordered list of valid dialect identifiers. Postgres is the default. */
export const DIALECTS: ReadonlyArray<Dialect> = ['postgres', 'mysql', 'mssql']

const dialectSet = new Set<string>(DIALECTS)

/** Reports whether s is a recognized DDL dialect. Mirrors ddl.IsValidDialect. */
export function isValidDialect(s: string): s is Dialect {
  return dialectSet.has(s)
}

/**
 * Quotes an identifier (table or column name) per dialect convention,
 * escaping any embedded delimiter character by doubling it. Mirrors
 * ddl.QuoteIdent exactly, including the "any unrecognized value falls back
 * to postgres quoting" behavior.
 */
export function quoteIdent(dialect: Dialect, name: string): string {
  switch (dialect) {
    case 'mysql':
      return '`' + name.replaceAll('`', '``') + '`'
    case 'mssql':
      return '[' + name.replaceAll(']', ']]') + ']'
    default: // postgres and any unrecognized value fall back to postgres quoting.
      return '"' + name.replaceAll('"', '""') + '"'
  }
}

// Type maps: one Record<string, string> per dialect, keyed by every value in
// dataTypeSchema.options (src/data/schema.ts), mapping the generic type to
// that dialect's native SQL type. Ported 1:1 from typemap.go — key set and
// values must stay in sync with the Go maps.

const postgresTypes: Record<string, string> = {
  int: 'INTEGER',
  bigint: 'BIGINT',
  smallint: 'SMALLINT',
  float: 'REAL',
  double: 'DOUBLE PRECISION',
  decimal: 'DECIMAL',
  serial: 'SERIAL',
  money: 'MONEY',
  string: 'VARCHAR',
  char: 'CHAR', // approximate mapping (generic char with no length on the Column model)
  varchar: 'VARCHAR',
  text: 'TEXT',
  boolean: 'BOOLEAN',
  bit: 'BIT', // approximate mapping (generic bit with no length defaults to BIT(1))
  date: 'DATE',
  datetime: 'TIMESTAMP', // approximate mapping (Postgres has no native DATETIME type)
  timestamp: 'TIMESTAMP',
  time: 'TIME',
  binary: 'BYTEA', // approximate mapping (Postgres has no fixed-length BINARY type)
  blob: 'BYTEA',
  json: 'JSON',
  xml: 'XML',
  array: 'TEXT[]', // approximate mapping (Column model carries no element type)
  enum: 'VARCHAR(255)', // approximate mapping (Column model carries no enum-values list)
  uuid: 'UUID',
}

const mysqlTypes: Record<string, string> = {
  int: 'INT',
  bigint: 'BIGINT',
  smallint: 'SMALLINT',
  float: 'FLOAT',
  double: 'DOUBLE',
  decimal: 'DECIMAL',
  serial: 'INT AUTO_INCREMENT',
  money: 'DECIMAL(19,4)', // approximate mapping (MySQL has no native MONEY type)
  string: 'VARCHAR(255)',
  char: 'CHAR(1)', // approximate mapping (generic char with no length on the Column model)
  varchar: 'VARCHAR(255)',
  text: 'TEXT',
  boolean: 'TINYINT(1)',
  bit: 'BIT(1)',
  date: 'DATE',
  datetime: 'DATETIME',
  timestamp: 'TIMESTAMP',
  time: 'TIME',
  binary: 'VARBINARY(255)', // approximate mapping (generic binary with no length on the Column model)
  blob: 'BLOB',
  json: 'JSON',
  xml: 'TEXT', // approximate mapping (MySQL has no native XML type)
  array: 'JSON', // approximate mapping (MySQL has no native ARRAY type)
  enum: 'VARCHAR(255)', // approximate mapping (Column model carries no enum-values list)
  uuid: 'CHAR(36)',
}

const mssqlTypes: Record<string, string> = {
  int: 'INT',
  bigint: 'BIGINT',
  smallint: 'SMALLINT',
  float: 'FLOAT',
  double: 'FLOAT(53)', // approximate mapping (MSSQL has no native DOUBLE type)
  decimal: 'DECIMAL',
  serial: 'INT IDENTITY(1,1)',
  money: 'MONEY',
  string: 'NVARCHAR(255)',
  char: 'NCHAR(1)', // approximate mapping (generic char with no length on the Column model)
  varchar: 'NVARCHAR(255)',
  text: 'NVARCHAR(MAX)',
  boolean: 'BIT',
  bit: 'BIT',
  date: 'DATE',
  datetime: 'DATETIME2', // approximate mapping (modern MSSQL equivalent)
  timestamp: 'DATETIME2', // approximate mapping (MSSQL TIMESTAMP is a rowversion type, not a datetime)
  time: 'TIME',
  binary: 'VARBINARY(MAX)',
  blob: 'VARBINARY(MAX)',
  json: 'NVARCHAR(MAX)',
  xml: 'XML',
  array: 'NVARCHAR(MAX)', // approximate mapping (MSSQL has no native ARRAY type)
  enum: 'NVARCHAR(255)', // approximate mapping (Column model carries no enum-values list)
  uuid: 'UNIQUEIDENTIFIER',
}

const typeMaps: Record<Dialect, Record<string, string>> = {
  postgres: postgresTypes,
  mysql: mysqlTypes,
  mssql: mssqlTypes,
}

/**
 * Exposes the key set of each dialect's type map, keyed by dialect. Used by
 * tests to assert the maps stay in sync with dataTypeSchema.options (mirrors
 * Go's TestTypeMapCompleteness in internal/ddl/ddl_test.go).
 */
export function getTypeMapKeys(dialect: Dialect): Array<string> {
  return Object.keys(typeMaps[dialect])
}

/**
 * Exposes the full forward type map (generic dataType -> native SQL type) for
 * dialect. Used by sql-type-map.ts's reverse-mapping test to assert every
 * value this module emits maps back to a sensible dataTypeSchema member —
 * keeps the SQL DDL import path (src/lib/parser/sql-type-map.ts) in sync with
 * this export path without duplicating the map data itself.
 */
export function getForwardTypeMap(
  dialect: Dialect,
): Readonly<Record<string, string>> {
  return typeMaps[dialect]
}

/**
 * Resolves dataType to its native SQL type for dialect. Falls back to the
 * raw dataType string unchanged if absent from the map — mirrors
 * ddl.mapDataType's total (never-throws) fallback behavior.
 */
function mapDataType(dialect: Dialect, dataType: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: typeMaps[dialect] is statically always defined, but this guards against a caller that bypasses the Dialect union via a cast.
  return typeMaps[dialect]?.[dataType] ?? dataType
}

/**
 * Renders a single-table CREATE TABLE statement for the table identified by
 * tableId within tables, in the given dialect. Mirrors ddl.GenerateTableDDL.
 *
 * tables must include every table on the board (not just the target), since
 * foreign-key constraints on the target table may reference columns owned
 * by other tables.
 *
 * Columns are sorted by their `order` field before rendering, so callers do
 * not need to pre-sort table.columns.
 *
 * Throws if tableId is not found in tables, or if the resolved table has no
 * columns.
 */
export function generateTableDDL(
  tables: Array<DiagramTableWithRelations>,
  tableId: string,
  dialect: Dialect,
): string {
  const tableById = new Map<string, DiagramTableWithRelations>()
  const columnById = new Map<
    string,
    DiagramTableWithRelations['columns'][number]
  >()
  for (const t of tables) {
    tableById.set(t.id, t)
    for (const c of t.columns) {
      columnById.set(c.id, c)
    }
  }

  const target = tableById.get(tableId)
  if (!target) {
    throw new Error(`table ${tableId} not found`)
  }

  // Render columns in their defined display order, independent of the order
  // they arrive in target.columns.
  const columns = [...target.columns].sort((a, b) => a.order - b.order)

  // Determine primary-key columns to decide inline vs. composite rendering.
  const pkCols = columns.filter((c) => c.isPrimaryKey)
  const singlePK = pkCols.length === 1

  const lines: Array<string> = []

  // Column lines.
  for (const c of columns) {
    let line =
      quoteIdent(dialect, c.name) + ' ' + mapDataType(dialect, c.dataType)
    if (!c.isNullable) line += ' NOT NULL'
    if (c.isUnique) line += ' UNIQUE'
    if (singlePK && c.isPrimaryKey) line += ' PRIMARY KEY'
    lines.push('  ' + line)
  }

  if (lines.length === 0) {
    throw new Error(`table ${tableId} has no columns`)
  }

  // Composite primary key constraint line.
  if (pkCols.length > 1) {
    const names = pkCols.map((c) => quoteIdent(dialect, c.name))
    lines.push('  PRIMARY KEY (' + names.join(', ') + ')')
  }

  // Foreign-key constraint lines, one per outgoing relationship.
  for (const rel of target.outgoingRelationships) {
    const srcCol = columnById.get(rel.sourceColumnId)
    if (!srcCol) continue
    const tgtTable = tableById.get(rel.targetTableId)
    if (!tgtTable) continue
    const tgtCol = columnById.get(rel.targetColumnId)
    if (!tgtCol) continue
    lines.push(
      '  FOREIGN KEY (' +
        quoteIdent(dialect, srcCol.name) +
        ') REFERENCES ' +
        quoteIdent(dialect, tgtTable.name) +
        '(' +
        quoteIdent(dialect, tgtCol.name) +
        ')',
    )
  }

  return (
    'CREATE TABLE ' +
    quoteIdent(dialect, target.name) +
    ' (\n' +
    lines.join(',\n') +
    '\n);'
  )
}

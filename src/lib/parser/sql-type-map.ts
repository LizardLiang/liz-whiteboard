// src/lib/parser/sql-type-map.ts
//
// Reverse type map for the SQL DDL import path: given a native SQL column
// type (as written in a pasted CREATE TABLE statement) and the dialect it
// was written in, resolves the generic `DataType` (dataTypeSchema member)
// the diagram's Column model should use.
//
// This is the inverse of the *forward* per-dialect type maps in
// ddl-generator.ts (postgresTypes/mysqlTypes/mssqlTypes), which map a generic
// DataType -> native SQL type for DDL export. That forward mapping is
// many-to-one and lossy (e.g. both 'string' and 'varchar' export to
// Postgres's VARCHAR), so the reverse tables below are hand-authored rather
// than derived programmatically — see sql-type-map.test.ts for the
// round-trip assertion that keeps the two directions from silently drifting
// apart as either module changes.
//
// Length/precision parameters (VARCHAR(255), DECIMAL(19,4)) are dropped —
// the Column model carries no such field, mirroring the same lossiness the
// DDL export already documents. A handful of dialect-specific parameter
// values change the *kind* of column being described rather than just its
// size (e.g. MySQL's TINYINT(1) convention for booleans, CHAR(36) for UUIDs
// stored as strings, or MSSQL's IDENTITY(seed,increment) for auto-increment
// columns) — those are recognized as quirks *before* generic parameter
// stripping, since stripping first would erase the distinction.

import type { Dialect } from '@/lib/ddl-generator'
import type { DataType } from '@/data/schema'

export interface SqlTypeMapResult {
  dataType: DataType
  /** Present only when the type could not be recognized and fell back to 'text'. */
  warning?: string
}

/** Uppercases and collapses internal whitespace runs to a single space. */
function normalize(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ')
}

/**
 * Strips length/precision parameter groups and a trailing array suffix —
 * e.g. "VARCHAR(255)" -> "VARCHAR", "NUMERIC(10,2)" -> "NUMERIC". Multiple
 * groups are stripped (defensive; real DDL never has more than one).
 */
function stripParams(normalized: string): string {
  return normalized
    .replace(/\([^)]*\)/g, '')
    .replace(/\[\]$/, '')
    .trim()
}

/** Postgres-only convention: any `TYPE[]` suffix — recognized before
 * dialect-specific lookup since Postgres is the only dialect that emits it,
 * and the array element type itself isn't representable in the Column model. */
const ARRAY_SUFFIX = /\[\]$/

interface Quirk {
  pattern: RegExp
  dataType: DataType
}

// Dialect-specific quirks that depend on the exact parameter value, checked
// BEFORE generic stripParams (which would otherwise erase the distinction
// that gives the quirk its meaning).
const QUIRKS: Record<Dialect, Array<Quirk>> = {
  postgres: [],
  mysql: [
    // MySQL's auto-increment modifier is a trailing bare word, not a type
    // parameter — matches ddl-generator's serial:'INT AUTO_INCREMENT'.
    { pattern: /^INT AUTO_INCREMENT$/, dataType: 'serial' },
    // MySQL convention: TINYINT(1) means boolean; any other TINYINT length
    // (or none) is a genuine small integer — see MYSQL_REVERSE.
    { pattern: /^TINYINT\s*\(\s*1\s*\)$/, dataType: 'boolean' },
    // MySQL convention: CHAR(36) stores a UUID as text; other CHAR(N) is a
    // plain fixed-length string — see MYSQL_REVERSE.
    { pattern: /^CHAR\s*\(\s*36\s*\)$/, dataType: 'uuid' },
  ],
  mssql: [
    // MSSQL's IDENTITY(seed,increment) column modifier — the seed/increment
    // values vary, so this must be a pattern rather than a literal key.
    { pattern: /^INT IDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)$/, dataType: 'serial' },
    // FLOAT(53) is double precision; bare FLOAT (or other precisions) is
    // MSSQL's single-precision float — see MSSQL_REVERSE.
    { pattern: /^FLOAT\s*\(\s*53\s*\)$/, dataType: 'double' },
    // NVARCHAR(MAX) is MSSQL's unbounded-text convention; NVARCHAR(255) (or
    // similar bounded lengths) is a plain varchar — see MSSQL_REVERSE.
    { pattern: /^NVARCHAR\s*\(\s*MAX\s*\)$/, dataType: 'text' },
  ],
}

// Reverse lookup keyed by normalized, parameter-stripped base SQL type.
// Where the forward map collapses multiple generic DataTypes onto the same
// native SQL type (e.g. Postgres 'string' and 'varchar' both -> VARCHAR), the
// entry below picks the single most sensible reverse target — round-tripping
// to the *original* generic type for every forward-map key is not the goal
// (impossible for a lossy many-to-one map); landing on *a* valid, sensible
// DataType for every value the forward map actually emits is (see
// sql-type-map.test.ts).
const POSTGRES_REVERSE: Record<string, DataType> = {
  INTEGER: 'int',
  BIGINT: 'bigint',
  SMALLINT: 'smallint',
  REAL: 'float',
  'DOUBLE PRECISION': 'double',
  DECIMAL: 'decimal',
  NUMERIC: 'decimal',
  SERIAL: 'serial',
  MONEY: 'money',
  VARCHAR: 'varchar',
  'CHARACTER VARYING': 'varchar',
  CHAR: 'char',
  CHARACTER: 'char',
  TEXT: 'text',
  BOOLEAN: 'boolean',
  BOOL: 'boolean',
  BIT: 'bit',
  DATE: 'date',
  TIMESTAMP: 'timestamp',
  'TIMESTAMP WITHOUT TIME ZONE': 'timestamp',
  'TIMESTAMP WITH TIME ZONE': 'timestamp',
  TIME: 'time',
  BYTEA: 'binary',
  JSON: 'json',
  JSONB: 'json',
  XML: 'xml',
  UUID: 'uuid',
}

const MYSQL_REVERSE: Record<string, DataType> = {
  INT: 'int',
  INTEGER: 'int',
  BIGINT: 'bigint',
  SMALLINT: 'smallint',
  // Bare TINYINT (no length, or a length other than 1) — dataTypeSchema has
  // no dedicated tinyint member; smallint is the closest generic fit.
  TINYINT: 'smallint',
  FLOAT: 'float',
  DOUBLE: 'double',
  DECIMAL: 'decimal',
  NUMERIC: 'decimal',
  VARCHAR: 'varchar',
  CHAR: 'char',
  TEXT: 'text',
  LONGTEXT: 'text',
  MEDIUMTEXT: 'text',
  TINYTEXT: 'text',
  BOOLEAN: 'boolean',
  BOOL: 'boolean',
  BIT: 'bit',
  DATE: 'date',
  DATETIME: 'datetime',
  TIMESTAMP: 'timestamp',
  TIME: 'time',
  VARBINARY: 'binary',
  BINARY: 'binary',
  BLOB: 'blob',
  LONGBLOB: 'blob',
  MEDIUMBLOB: 'blob',
  TINYBLOB: 'blob',
  JSON: 'json',
  UUID: 'uuid',
}

const MSSQL_REVERSE: Record<string, DataType> = {
  INT: 'int',
  BIGINT: 'bigint',
  SMALLINT: 'smallint',
  // Bare FLOAT (no precision, or a precision other than 53) — MSSQL's
  // default/single-precision float. FLOAT(53) is intercepted by QUIRKS above.
  FLOAT: 'float',
  DECIMAL: 'decimal',
  NUMERIC: 'decimal',
  MONEY: 'money',
  SMALLMONEY: 'money',
  NVARCHAR: 'varchar',
  VARCHAR: 'varchar',
  NCHAR: 'char',
  CHAR: 'char',
  // MSSQL has a single BIT type serving both boolean and generic-single-bit
  // roles; boolean/flag usage is overwhelmingly the common real-world case.
  BIT: 'boolean',
  DATE: 'date',
  DATETIME2: 'datetime',
  DATETIME: 'datetime',
  SMALLDATETIME: 'datetime',
  TIME: 'time',
  VARBINARY: 'binary',
  BINARY: 'binary',
  XML: 'xml',
  UNIQUEIDENTIFIER: 'uuid',
}

const REVERSE_MAPS: Record<Dialect, Record<string, DataType>> = {
  postgres: POSTGRES_REVERSE,
  mysql: MYSQL_REVERSE,
  mssql: MSSQL_REVERSE,
}

/**
 * Resolves rawType (as written in a pasted CREATE TABLE statement, in
 * dialect) to the DataType the diagram's Column model should use.
 *
 * Total (never throws) — an unrecognized type falls back to 'text' with a
 * warning, per the import feature's "never a hard failure" behavior.
 */
export function sqlTypeToDataType(
  rawType: string,
  dialect: Dialect,
): SqlTypeMapResult {
  const normalized = normalize(rawType)

  if (!normalized) {
    return {
      dataType: 'text',
      warning: 'Empty column type — defaulted to text',
    }
  }

  // Postgres array convention (TYPE[]) takes priority over everything else —
  // the element type itself isn't representable in the Column model.
  if (ARRAY_SUFFIX.test(normalized)) {
    return { dataType: 'array' }
  }

  for (const quirk of QUIRKS[dialect]) {
    if (quirk.pattern.test(normalized)) {
      return { dataType: quirk.dataType }
    }
  }

  const base = stripParams(normalized)
  const reverseMap = REVERSE_MAPS[dialect]
  if (Object.hasOwn(reverseMap, base)) {
    return { dataType: reverseMap[base] }
  }

  return {
    dataType: 'text',
    warning: `Unrecognized ${dialect} type "${rawType.trim()}" — defaulted to text`,
  }
}

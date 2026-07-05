// src/lib/parser/sql-type-map.test.ts
// Tests for the SQL DDL import reverse type map.

import { describe, expect, it } from 'vitest'
import { sqlTypeToDataType } from './sql-type-map'
import { DIALECTS, getForwardTypeMap } from '@/lib/ddl-generator'
import { dataTypeSchema } from '@/data/schema'

describe('sqlTypeToDataType', () => {
  it('round-trips every forward-map value to a valid dataTypeSchema member with no warning', () => {
    for (const dialect of DIALECTS) {
      const forward = getForwardTypeMap(dialect)
      for (const [genericType, sqlType] of Object.entries(forward)) {
        const result = sqlTypeToDataType(sqlType, dialect)
        expect(
          dataTypeSchema.safeParse(result.dataType).success,
          `${dialect}: ${genericType} -> "${sqlType}" -> "${result.dataType}" is not a valid DataType`,
        ).toBe(true)
        expect(
          result.warning,
          `${dialect}: "${sqlType}" (forward value of ${genericType}) should not warn`,
        ).toBeUndefined()
      }
    }
  })

  it('falls back to text with a warning for unrecognized types', () => {
    const result = sqlTypeToDataType('NOT_A_REAL_TYPE', 'postgres')
    expect(result.dataType).toBe('text')
    expect(result.warning).toBeDefined()
  })

  it('falls back to text with a warning for an empty type string', () => {
    const result = sqlTypeToDataType('   ', 'mysql')
    expect(result.dataType).toBe('text')
    expect(result.warning).toBeDefined()
  })

  it('strips length/precision parameters for common types', () => {
    expect(sqlTypeToDataType('VARCHAR(255)', 'postgres').dataType).toBe(
      'varchar',
    )
    expect(sqlTypeToDataType('DECIMAL(19,4)', 'mysql').dataType).toBe(
      'decimal',
    )
    expect(sqlTypeToDataType('NUMERIC(10,2)', 'mssql').dataType).toBe(
      'decimal',
    )
  })

  it('recognizes the Postgres TYPE[] array convention', () => {
    expect(sqlTypeToDataType('TEXT[]', 'postgres').dataType).toBe('array')
    expect(sqlTypeToDataType('INTEGER[]', 'postgres').dataType).toBe('array')
  })

  it('recognizes MySQL dialect quirks', () => {
    expect(sqlTypeToDataType('INT AUTO_INCREMENT', 'mysql').dataType).toBe(
      'serial',
    )
    expect(sqlTypeToDataType('TINYINT(1)', 'mysql').dataType).toBe('boolean')
    expect(sqlTypeToDataType('TINYINT(4)', 'mysql').dataType).toBe('smallint')
    expect(sqlTypeToDataType('TINYINT', 'mysql').dataType).toBe('smallint')
    expect(sqlTypeToDataType('CHAR(36)', 'mysql').dataType).toBe('uuid')
    expect(sqlTypeToDataType('CHAR(10)', 'mysql').dataType).toBe('char')
  })

  it('recognizes MSSQL dialect quirks', () => {
    expect(sqlTypeToDataType('INT IDENTITY(1,1)', 'mssql').dataType).toBe(
      'serial',
    )
    expect(sqlTypeToDataType('INT IDENTITY(100, 5)', 'mssql').dataType).toBe(
      'serial',
    )
    expect(sqlTypeToDataType('FLOAT(53)', 'mssql').dataType).toBe('double')
    expect(sqlTypeToDataType('FLOAT', 'mssql').dataType).toBe('float')
    expect(sqlTypeToDataType('NVARCHAR(MAX)', 'mssql').dataType).toBe('text')
    expect(sqlTypeToDataType('NVARCHAR(255)', 'mssql').dataType).toBe(
      'varchar',
    )
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(sqlTypeToDataType('varchar(255)', 'postgres').dataType).toBe(
      'varchar',
    )
    expect(sqlTypeToDataType('  INTEGER  ', 'postgres').dataType).toBe('int')
    expect(sqlTypeToDataType('Timestamp', 'postgres').dataType).toBe(
      'timestamp',
    )
  })
})

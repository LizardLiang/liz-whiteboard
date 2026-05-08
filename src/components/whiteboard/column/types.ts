/**
 * Shared types for column editing components
 */

import type { DataType } from '@/data/schema'

/**
 * Tracks which column field is currently in edit mode
 */
export interface EditingField {
  columnId: string
  field: 'name' | 'dataType'
}

/**
 * Payload for creating a new column
 */
export interface CreateColumnPayload {
  name: string
  dataType: DataType
  order: number
}

/**
 * Relationship info used in DeleteColumnDialog
 */
export interface ColumnRelationship {
  id: string
  sourceTableName: string
  sourceColumnName: string
  targetTableName: string
  targetColumnName: string
  cardinality: string
}

/**
 * Display labels for each data type
 */
export const DATA_TYPE_LABELS: Record<DataType, string> = {
  // Numeric
  int: 'Integer',
  bigint: 'BigInt',
  smallint: 'SmallInt',
  float: 'Float',
  double: 'Double',
  decimal: 'Decimal',
  serial: 'Serial',
  money: 'Money',
  // String
  string: 'String',
  char: 'Char',
  varchar: 'VarChar',
  text: 'Text',
  // Boolean
  boolean: 'Boolean',
  bit: 'Bit',
  // Date/Time
  date: 'Date',
  datetime: 'DateTime',
  timestamp: 'Timestamp',
  time: 'Time',
  // Binary
  binary: 'Binary',
  blob: 'Blob',
  // Structured
  json: 'JSON',
  xml: 'XML',
  array: 'Array',
  enum: 'Enum',
  // Identity
  uuid: 'UUID',
}

/**
 * Data types grouped by category for the type selector combobox.
 */
export const DATA_TYPE_GROUPS: Array<{
  heading: string
  types: Array<DataType>
}> = [
  {
    heading: 'Numeric',
    types: [
      'int',
      'bigint',
      'smallint',
      'float',
      'double',
      'decimal',
      'serial',
      'money',
    ],
  },
  {
    heading: 'String',
    types: ['string', 'char', 'varchar', 'text'],
  },
  {
    heading: 'Boolean',
    types: ['boolean', 'bit'],
  },
  {
    heading: 'Date / Time',
    types: ['date', 'datetime', 'timestamp', 'time'],
  },
  {
    heading: 'Binary',
    types: ['binary', 'blob'],
  },
  {
    heading: 'Structured',
    types: ['json', 'xml', 'array', 'enum'],
  },
  {
    heading: 'Identity',
    types: ['uuid'],
  },
]

/**
 * All valid data types (from Zod enum), grouped logically
 */
export const DATA_TYPES: Array<DataType> = [
  // Numeric
  'int',
  'bigint',
  'smallint',
  'float',
  'double',
  'decimal',
  'serial',
  'money',
  // String
  'string',
  'char',
  'varchar',
  'text',
  // Boolean
  'boolean',
  'bit',
  // Date/Time
  'date',
  'datetime',
  'timestamp',
  'time',
  // Binary
  'binary',
  'blob',
  // Structured
  'json',
  'xml',
  'array',
  'enum',
  // Identity
  'uuid',
]

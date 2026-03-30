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
  int: 'Integer',
  string: 'String',
  float: 'Float',
  boolean: 'Boolean',
  date: 'Date',
  text: 'Text',
  uuid: 'UUID',
  json: 'JSON',
}

/**
 * All valid data types (from Zod enum)
 */
export const DATA_TYPES: DataType[] = [
  'int',
  'string',
  'float',
  'boolean',
  'date',
  'text',
  'uuid',
  'json',
]

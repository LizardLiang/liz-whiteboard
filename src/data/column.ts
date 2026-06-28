// src/data/column.ts
// Data access layer for Column entity

import { createColumnSchema, updateColumnSchema } from './schema'
import type { CreateColumn, UpdateColumn } from './schema'
import type { Column } from './models'
import {
  db,
  genId,
  insert,
  mapColumn,
  nowMs,
  toDbBool,
  transaction,
  update,
} from '@/db'

function insertColumn(validated: CreateColumn): Column {
  const id = genId()
  const ts = nowMs()
  insert('Column', {
    id,
    tableId: validated.tableId,
    name: validated.name,
    dataType: validated.dataType,
    isPrimaryKey: toDbBool(validated.isPrimaryKey),
    isForeignKey: toDbBool(validated.isForeignKey),
    isUnique: toDbBool(validated.isUnique),
    isNullable: toDbBool(validated.isNullable),
    description: validated.description ?? null,
    order: validated.order,
    createdAt: ts,
    updatedAt: ts,
  })
  return mapColumn(db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id))!
}

/**
 * Create a new column
 */
export async function createColumn(data: CreateColumn): Promise<Column> {
  const validated = createColumnSchema.parse(data)
  try {
    return insertColumn(validated)
  } catch (error) {
    throw new Error(
      `Failed to create column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Create multiple columns in a single transaction
 */
export async function createColumns(
  columns: Array<CreateColumn>,
): Promise<Array<Column>> {
  const validated = columns.map((col) => createColumnSchema.parse(col))
  try {
    return transaction(() => validated.map((data) => insertColumn(data)))
  } catch (error) {
    throw new Error(
      `Failed to create columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all columns in a table (ordered by order field)
 */
export async function findColumnsByTableId(
  tableId: string,
): Promise<Array<Column>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Column" WHERE "tableId" = ? ORDER BY "order" ASC',
      )
      .all(tableId)
      .map((r) => mapColumn(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a column by ID
 */
export async function findColumnById(id: string): Promise<Column | null> {
  try {
    return mapColumn(
      db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a column
 */
export async function updateColumn(
  id: string,
  data: UpdateColumn,
): Promise<Column> {
  const validated = updateColumnSchema.parse(data)
  try {
    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    if (validated.dataType !== undefined) values.dataType = validated.dataType
    if (validated.isPrimaryKey !== undefined)
      values.isPrimaryKey = toDbBool(validated.isPrimaryKey)
    if (validated.isForeignKey !== undefined)
      values.isForeignKey = toDbBool(validated.isForeignKey)
    if (validated.isUnique !== undefined)
      values.isUnique = toDbBool(validated.isUnique)
    if (validated.isNullable !== undefined)
      values.isNullable = toDbBool(validated.isNullable)
    if (validated.description !== undefined)
      values.description = validated.description
    update('Column', id, values)
    return mapColumn(
      db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update column order (for reordering columns)
 */
export async function updateColumnOrder(
  id: string,
  order: number,
): Promise<Column> {
  try {
    update('Column', id, { order, updatedAt: nowMs() })
    return mapColumn(
      db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update column order: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a column (cascade deletes relationships referencing this column)
 */
export async function deleteColumn(id: string): Promise<Column> {
  try {
    const existing = mapColumn(
      db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Column not found')
    db.prepare('DELETE FROM "Column" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find primary key columns in a table
 */
export async function findPrimaryKeyColumnsByTableId(
  tableId: string,
): Promise<Array<Column>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Column" WHERE "tableId" = ? AND "isPrimaryKey" = 1 ORDER BY "order" ASC',
      )
      .all(tableId)
      .map((r) => mapColumn(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch primary key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Reorder all columns in a table in a single atomic transaction.
 * orderedColumnIds defines the desired order — each column is assigned
 * order = index (0-based). All IDs must belong to tableId.
 */
export async function reorderColumns(
  tableId: string,
  orderedColumnIds: Array<string>,
): Promise<Array<Column>> {
  if (orderedColumnIds.length === 0) {
    throw new Error('orderedColumnIds must not be empty')
  }

  const currentColumns = db
    .prepare('SELECT "id" FROM "Column" WHERE "tableId" = ?')
    .all(tableId)
  const ownedIds = new Set(currentColumns.map((c) => c.id as string))

  for (const id of orderedColumnIds) {
    if (!ownedIds.has(id)) {
      throw new Error(`Column ${id} does not belong to table ${tableId}`)
    }
  }

  try {
    return transaction(() => {
      const ts = nowMs()
      return orderedColumnIds.map((id, index) => {
        update('Column', id, { order: index, updatedAt: ts })
        return mapColumn(
          db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id),
        )!
      })
    })
  } catch (error) {
    throw new Error(
      `Failed to reorder columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Duplicate a column by ID, inserting it directly below the source.
 */
export async function duplicateColumn(columnId: string): Promise<Column> {
  const source = mapColumn(
    db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(columnId),
  )
  if (!source) {
    throw new Error(`Column not found: ${columnId}`)
  }

  const newOrder = source.order + 1

  // Shift all sibling columns with order >= newOrder down by 1 to make room
  db.prepare(
    'UPDATE "Column" SET "order" = "order" + 1 WHERE "tableId" = ? AND "order" >= ?',
  ).run(source.tableId, newOrder)

  // Build a unique name (try _copy, then _copy2, _copy3, …)
  const baseName = `${source.name}_copy`
  let candidateName = baseName
  let suffix = 2
  while (true) {
    const conflict = db
      .prepare('SELECT "id" FROM "Column" WHERE "tableId" = ? AND "name" = ?')
      .get(source.tableId, candidateName)
    if (!conflict) break
    candidateName = `${baseName}${suffix}`
    suffix++
  }

  return insertColumn({
    tableId: source.tableId,
    name: candidateName,
    dataType: source.dataType as CreateColumn['dataType'],
    isPrimaryKey: false,
    isForeignKey: false,
    isUnique: source.isUnique,
    isNullable: source.isNullable,
    description: source.description ?? undefined,
    order: newOrder,
  })
}

/**
 * Find foreign key columns in a table
 */
export async function findForeignKeyColumnsByTableId(
  tableId: string,
): Promise<Array<Column>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Column" WHERE "tableId" = ? AND "isForeignKey" = 1 ORDER BY "order" ASC',
      )
      .all(tableId)
      .map((r) => mapColumn(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch foreign key columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

// src/data/column.ts
// Data access layer for Column entity

import { createColumnSchema, updateColumnSchema } from './schema'
import {
  assertIdFree,
  isIdRefusal,
  refuseTakenIdAfterInsertError,
  whiteboardOfTable,
} from './already-exists'
import type { CreateColumn, CreateColumnInput, UpdateColumn } from './schema'
import type { Column } from './models'
import type { IdClaim } from './already-exists'
import type { ChangeContext } from '@/lib/schema-changelog'
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
import {
  eventRow,
  recordChange,
  recordUpdate,
  tableNameOf,
} from '@/lib/schema-changelog'

const COLUMN_EVENT_FIELDS = [
  'name',
  'dataType',
  'isPrimaryKey',
  'isForeignKey',
  'isUnique',
  'isNullable',
  'description',
  'order',
] as const

function readColumn(id: string): Column | null {
  return mapColumn(db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(id))
}

/** Write `values` to a column and record what changed, in one transaction. */
function writeColumnUpdate(
  id: string,
  values: Record<string, unknown>,
  ctx: ChangeContext,
  action: 'update' | 'reorder' = 'update',
): Column {
  return transaction(() => {
    const before = readColumn(id)
    update('Column', id, values)
    const after = readColumn(id)!
    if (before) {
      recordUpdate(
        ctx,
        {
          entityType: 'column',
          entityId: id,
          entityName: after.name,
          tableId: after.tableId,
          tableName: tableNameOf(after.tableId),
        },
        before,
        after,
        COLUMN_EVENT_FIELDS,
        action,
      )
    }
    return after
  })
}

/** A column create's id claim: it writes to the whiteboard of its table. */
function columnClaim(validated: CreateColumn): IdClaim {
  return {
    table: 'Column',
    id: validated.id,
    whiteboardId:
      validated.id === undefined
        ? undefined
        : whiteboardOfTable(validated.tableId),
    noun: 'column',
  }
}

/** Insert a column and record its creation. Callers own the transaction. */
function insertColumn(validated: CreateColumn, ctx: ChangeContext): Column {
  assertIdFree(columnClaim(validated))
  const id = validated.id ?? genId()
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
  const created = readColumn(id)!
  recordChange(ctx, {
    category: 'schema',
    entityType: 'column',
    action: 'create',
    entityId: id,
    entityName: created.name,
    tableId: created.tableId,
    tableName: tableNameOf(created.tableId),
    after: eventRow(created),
  })
  return created
}

function rethrowIdTaken(error: unknown, validated: CreateColumn): void {
  if (isIdRefusal(error)) throw error
  refuseTakenIdAfterInsertError(error, columnClaim(validated))
}

/** True when `error` is a UNIQUE violation and a stored column now holds one of the batch ids. */
function refusesAnyId(error: unknown, batch: Array<CreateColumn>): boolean {
  try {
    for (const data of batch) rethrowIdTaken(error, data)
  } catch {
    return true
  }
  return false
}

/**
 * Create a new column. A given `id` is stored as the column's id; an id any
 * column already has is refused (see already-exists.ts).
 */
export async function createColumn(
  data: CreateColumnInput,
  ctx: ChangeContext,
): Promise<Column> {
  const validated = createColumnSchema.parse(data)
  try {
    return transaction(() => insertColumn(validated, ctx))
  } catch (error) {
    rethrowIdTaken(error, validated)
    throw new Error(
      `Failed to create column: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Create multiple columns in a single transaction.
 *
 * A batch is all-or-nothing, so it never answers ALREADY_EXISTS: after the
 * rollback nothing is stored, and a caller that read "already exists" as
 * success would record columns that were never written. A batch that names the
 * same id twice is refused before the transaction; any other refusal inside it
 * surfaces as the plain batch failure.
 */
export async function createColumns(
  columns: Array<CreateColumnInput>,
  ctx: ChangeContext,
): Promise<Array<Column>> {
  const validated = columns.map((col) => createColumnSchema.parse(col))
  const ids = validated.flatMap((data) =>
    data.id === undefined ? [] : [data.id],
  )
  if (new Set(ids).size !== ids.length) {
    throw new Error('Failed to create columns: the batch repeats a column id')
  }
  try {
    return transaction(() => validated.map((data) => insertColumn(data, ctx)))
  } catch (error) {
    if (isIdRefusal(error) || refusesAnyId(error, validated)) {
      throw new Error('Failed to create columns')
    }
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
  ctx: ChangeContext,
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
    return writeColumnUpdate(id, values, ctx)
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
  ctx: ChangeContext,
): Promise<Column> {
  try {
    return writeColumnUpdate(id, { order, updatedAt: nowMs() }, ctx, 'reorder')
  } catch (error) {
    throw new Error(
      `Failed to update column order: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a column (cascade deletes relationships referencing this column)
 */
export async function deleteColumn(
  id: string,
  ctx: ChangeContext,
): Promise<Column> {
  try {
    return transaction(() => {
      const existing = readColumn(id)
      if (!existing) throw new Error('Column not found')
      recordChange(ctx, {
        category: 'schema',
        entityType: 'column',
        action: 'delete',
        entityId: id,
        entityName: existing.name,
        tableId: existing.tableId,
        tableName: tableNameOf(existing.tableId),
        before: eventRow(existing),
      })
      db.prepare('DELETE FROM "Column" WHERE "id" = ?').run(id)
      return existing
    })
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
  ctx: ChangeContext,
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
        const before = readColumn(id)
        update('Column', id, { order: index, updatedAt: ts })
        const after = readColumn(id)!
        if (before) {
          recordUpdate(
            ctx,
            {
              entityType: 'column',
              entityId: id,
              entityName: after.name,
              tableId: tableId,
              tableName: tableNameOf(tableId),
            },
            before,
            after,
            ['order'],
            'reorder',
          )
        }
        return after
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
export async function duplicateColumn(
  columnId: string,
  ctx: ChangeContext,
): Promise<Column> {
  const source = mapColumn(
    db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(columnId),
  )
  if (!source) {
    throw new Error(`Column not found: ${columnId}`)
  }

  return transaction(() => {
    const newOrder = source.order + 1

    // Shift all sibling columns with order >= newOrder down by 1 to make room
    db.prepare(
      'UPDATE "Column" SET "order" = "order" + 1 WHERE "tableId" = ? AND "order" >= ?',
    ).run(source.tableId, newOrder)

    // Build a unique name (try _copy, then _copy2, _copy3, …)
    const baseName = `${source.name}_copy`
    let candidateName = baseName
    let suffix = 2
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with an internal break once a unique name is found.
    while (true) {
      const conflict = db
        .prepare('SELECT "id" FROM "Column" WHERE "tableId" = ? AND "name" = ?')
        .get(source.tableId, candidateName)
      if (!conflict) break
      candidateName = `${baseName}${suffix}`
      suffix++
    }

    return insertColumn(
      {
        tableId: source.tableId,
        name: candidateName,
        dataType: source.dataType as CreateColumn['dataType'],
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: source.isUnique,
        isNullable: source.isNullable,
        description: source.description ?? undefined,
        order: newOrder,
      },
      ctx,
    )
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

// src/data/table-reference.ts
// Data access layer for cross-file table references (LizMeter #83).
//
// A reference node is NOT a new entity. It is a `DiagramTable` row on the board
// you are editing whose `sourceWhiteboardId`/`sourceTableId` point at a table in
// another whiteboard of the SAME project, plus `Column` stub rows (one per
// picked column) carrying `sourceColumnId`. Storing it this way is what lets
// relationships, auto-layout, search, snapshots and export keep working through
// the paths that already exist: `Relationship` has hard foreign keys into both
// `DiagramTable` and `Column`, so an edge can only ever point at real local rows.
//
// The stub rows are a fallback, not the truth. `resolveTableReferences` re-reads
// the source on every load, so a renamed table or column repaints itself, and a
// deleted one surfaces as `missing` rather than vanishing.

import { z } from 'zod'

import type { Column, DiagramTable } from './models'
import {
  db,
  genId,
  insert,
  mapColumn,
  mapDiagramTable,
  nowMs,
  toDbBool,
  transaction,
  update,
} from '@/db'

// ============================================================================
// Types
// ============================================================================

/** A reference node: its DiagramTable row plus the stub columns hanging off it. */
export interface TableReference {
  table: DiagramTable
  columns: Array<Column>
}

/** One stub column resolved against the source file. */
export interface ResolvedReferenceColumn {
  /** The local stub column's id — this is what a Relationship points at. */
  id: string
  /** The source column's id. */
  sourceColumnId: string | null
  /** Live name from the source, falling back to the stub's last-known name. */
  name: string
  dataType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  /** True when the source column no longer exists. */
  missing: boolean
}

/** A reference node resolved against its source file, ready to render. */
export interface ResolvedTableReference {
  table: DiagramTable
  /** Live source table name, falling back to the stub's last-known name. */
  sourceTableName: string
  /** Live source whiteboard name, or null when that file is gone. */
  sourceWhiteboardName: string | null
  columns: Array<ResolvedReferenceColumn>
  /** True when the source whiteboard or the source table no longer exists. */
  missing: boolean
}

/** One column offered by the reference picker. */
export interface ReferenceTargetColumn {
  id: string
  name: string
  dataType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
}

/** One table offered by the reference picker. */
export interface ReferenceTargetTable {
  id: string
  name: string
  columns: Array<ReferenceTargetColumn>
}

/** One file offered by the reference picker: another whiteboard of this project. */
export interface ReferenceTargetFile {
  whiteboardId: string
  whiteboardName: string
  tables: Array<ReferenceTargetTable>
}

export interface UpdateTableReferenceResult {
  reference: TableReference
  /**
   * How many relationships were removed because their endpoint stub column no
   * longer exists after the re-target. The UI confirms this count before
   * applying, and `update_table_reference` reports it back to MCP callers.
   */
  deletedRelationships: number
}

// ============================================================================
// Schemas
// ============================================================================

export const createTableReferenceSchema = z.object({
  whiteboardId: z.string().uuid(),
  sourceWhiteboardId: z.string().uuid(),
  sourceTableId: z.string().uuid(),
  sourceColumnIds: z.array(z.string().uuid()).min(1).max(100),
  positionX: z.number().finite().optional(),
  positionY: z.number().finite().optional(),
})

export const updateTableReferenceSchema = z.object({
  sourceWhiteboardId: z.string().uuid().optional(),
  sourceTableId: z.string().uuid().optional(),
  sourceColumnIds: z.array(z.string().uuid()).max(100).optional(),
})

export type CreateTableReferenceInput = z.input<
  typeof createTableReferenceSchema
>
export type UpdateTableReferenceInput = z.input<
  typeof updateTableReferenceSchema
>

// ============================================================================
// Helpers
// ============================================================================

/** True when this DiagramTable row is a cross-file reference, not a real table. */
export function isTableReference(table: DiagramTable): boolean {
  return table.sourceWhiteboardId !== null && table.sourceTableId !== null
}

function projectIdOf(whiteboardId: string): string | null {
  const row = db
    .prepare('SELECT "projectId" FROM "Whiteboard" WHERE "id" = ?')
    .get(whiteboardId) as { projectId?: string } | undefined
  return row?.projectId ?? null
}

function stubColumnsOf(tableId: string): Array<Column> {
  return db
    .prepare('SELECT * FROM "Column" WHERE "tableId" = ? ORDER BY "order" ASC')
    .all(tableId)
    .map((r) => mapColumn(r)!)
}

/**
 * Pick a name that will not collide with an existing table on this board.
 *
 * `DiagramTable` carries a UNIQUE (whiteboardId, name) index, and referencing
 * `orders` while the board already has a local `orders` is a normal thing to
 * want. The stored name is only a persistence detail — what renders comes from
 * live resolution — so a suffix here costs nothing.
 */
function uniqueNameOn(
  whiteboardId: string,
  desired: string,
  sourceFileName: string | null,
  excludeTableId?: string,
): string {
  const taken = new Set(
    (
      db
        .prepare(
          'SELECT "id", "name" FROM "DiagramTable" WHERE "whiteboardId" = ?',
        )
        .all(whiteboardId) as Array<{ id: string; name: string }>
    )
      .filter((r) => r.id !== excludeTableId)
      .map((r) => r.name),
  )
  if (!taken.has(desired)) return desired
  const qualified = sourceFileName ? `${desired} (${sourceFileName})` : desired
  if (!taken.has(qualified)) return qualified
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${qualified} ${n}`
    if (!taken.has(candidate)) return candidate
  }
  // 1000 collisions on one board is not a real scenario; fail loudly rather
  // than looping forever or silently overwriting.
  throw new Error(`Could not find a free name for reference "${desired}"`)
}

/**
 * Load the source table and its picked columns, asserting the whole chain:
 * same project, different whiteboard, table on that whiteboard, columns on
 * that table. Throws with a message the UI and MCP layers surface verbatim.
 */
function loadSource(opts: {
  whiteboardId: string
  sourceWhiteboardId: string
  sourceTableId: string
  sourceColumnIds: Array<string>
}): { sourceTable: DiagramTable; sourceColumns: Array<Column> } {
  if (opts.sourceWhiteboardId === opts.whiteboardId) {
    throw new Error(
      'A table reference cannot point at the same whiteboard it lives on',
    )
  }
  const localProject = projectIdOf(opts.whiteboardId)
  const sourceProject = projectIdOf(opts.sourceWhiteboardId)
  if (!localProject) throw new Error('Whiteboard not found')
  if (!sourceProject) throw new Error('Source whiteboard not found')
  if (localProject !== sourceProject) {
    throw new Error(
      'A table reference must point at a whiteboard in the same project',
    )
  }

  const sourceTable = mapDiagramTable(
    db
      .prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?')
      .get(opts.sourceTableId),
  )
  if (!sourceTable) throw new Error('Source table not found')
  if (sourceTable.whiteboardId !== opts.sourceWhiteboardId) {
    throw new Error('Source table does not belong to the source whiteboard')
  }

  const sourceColumns = opts.sourceColumnIds.map((columnId) => {
    const column = mapColumn(
      db.prepare('SELECT * FROM "Column" WHERE "id" = ?').get(columnId),
    )
    if (!column) throw new Error(`Source column ${columnId} not found`)
    if (column.tableId !== opts.sourceTableId) {
      throw new Error(
        `Source column ${columnId} does not belong to the source table`,
      )
    }
    return column
  })

  return { sourceTable, sourceColumns }
}

/** Insert one stub column mirroring a source column. */
function insertStubColumn(
  tableId: string,
  source: Column,
  order: number,
): void {
  const ts = nowMs()
  insert('Column', {
    id: genId(),
    tableId,
    name: source.name,
    dataType: source.dataType,
    isPrimaryKey: toDbBool(source.isPrimaryKey),
    isForeignKey: toDbBool(source.isForeignKey),
    isUnique: toDbBool(source.isUnique),
    isNullable: toDbBool(source.isNullable),
    description: source.description ?? null,
    order,
    sourceColumnId: source.id,
    createdAt: ts,
    updatedAt: ts,
  })
}

function readReference(tableId: string): TableReference {
  const table = mapDiagramTable(
    db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(tableId),
  )
  if (!table) throw new Error('Table reference not found')
  return { table, columns: stubColumnsOf(tableId) }
}

function requireReference(tableId: string): DiagramTable {
  const table = mapDiagramTable(
    db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(tableId),
  )
  if (!table) throw new Error('Table not found')
  if (!isTableReference(table)) {
    throw new Error('Table is not a table reference')
  }
  return table
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a cross-file reference node on `whiteboardId`.
 *
 * The DiagramTable row and every stub column are written in ONE transaction:
 * a half-built reference (a node with no connectable column) would render as a
 * node the user cannot wire up and cannot tell apart from a real failure.
 */
export async function createTableReference(
  data: CreateTableReferenceInput,
): Promise<TableReference> {
  const validated = createTableReferenceSchema.parse(data)
  const { sourceTable, sourceColumns } = loadSource(validated)

  const sourceFileName =
    (
      db
        .prepare('SELECT "name" FROM "Whiteboard" WHERE "id" = ?')
        .get(validated.sourceWhiteboardId) as { name?: string } | undefined
    )?.name ?? null

  const id = genId()
  const ts = nowMs()
  const name = uniqueNameOn(
    validated.whiteboardId,
    sourceTable.name,
    sourceFileName,
  )

  return transaction(() => {
    insert('DiagramTable', {
      id,
      whiteboardId: validated.whiteboardId,
      name,
      description: sourceTable.description ?? null,
      positionX: validated.positionX ?? null,
      positionY: validated.positionY ?? null,
      width: null,
      height: null,
      sourceWhiteboardId: validated.sourceWhiteboardId,
      sourceTableId: validated.sourceTableId,
      createdAt: ts,
      updatedAt: ts,
    })
    sourceColumns.forEach((column, index) => {
      insertStubColumn(id, column, index)
    })
    return readReference(id)
  })
}

/**
 * Everything the reference picker needs, in one read: every OTHER whiteboard of
 * this whiteboard's project, each with its real tables and their columns.
 *
 * Reference nodes are excluded from the table lists — a reference to a
 * reference would resolve to a stub rather than to a real table, so it is not
 * something the picker should ever offer.
 */
export async function listReferenceTargets(
  whiteboardId: string,
): Promise<Array<ReferenceTargetFile>> {
  const projectId = projectIdOf(whiteboardId)
  if (!projectId) throw new Error('Whiteboard not found')

  const files = db
    .prepare(
      'SELECT "id", "name" FROM "Whiteboard" WHERE "projectId" = ? AND "id" != ? ORDER BY "name" ASC',
    )
    .all(projectId, whiteboardId) as Array<{ id: string; name: string }>

  return files.map((file) => {
    const tables = db
      .prepare(
        'SELECT "id", "name" FROM "DiagramTable" WHERE "whiteboardId" = ? AND "sourceTableId" IS NULL ORDER BY "name" ASC',
      )
      .all(file.id) as Array<{ id: string; name: string }>

    return {
      whiteboardId: file.id,
      whiteboardName: file.name,
      tables: tables.map((table) => ({
        id: table.id,
        name: table.name,
        columns: (
          db
            .prepare(
              'SELECT "id", "name", "dataType", "isPrimaryKey", "isForeignKey" FROM "Column" WHERE "tableId" = ? ORDER BY "order" ASC',
            )
            .all(table.id) as Array<{
            id: string
            name: string
            dataType: string
            isPrimaryKey: unknown
            isForeignKey: unknown
          }>
        ).map((column) => ({
          id: column.id,
          name: column.name,
          dataType: column.dataType,
          isPrimaryKey: Boolean(Number(column.isPrimaryKey)),
          isForeignKey: Boolean(Number(column.isForeignKey)),
        })),
      })),
    }
  })
}

/** Every reference node on a whiteboard, ordinary tables excluded. */
export async function listTableReferences(
  whiteboardId: string,
): Promise<Array<TableReference>> {
  const tables = db
    .prepare(
      'SELECT * FROM "DiagramTable" WHERE "whiteboardId" = ? AND "sourceTableId" IS NOT NULL AND "sourceWhiteboardId" IS NOT NULL ORDER BY "createdAt" ASC',
    )
    .all(whiteboardId)
    .map((r) => mapDiagramTable(r)!)
  return tables.map((table) => ({
    table,
    columns: stubColumnsOf(table.id),
  }))
}

/**
 * Read every reference on a whiteboard and repaint it from its source.
 *
 * This is the live-resolution step: the stub rows only supply a last-known
 * fallback for whatever the source no longer provides. A reference whose source
 * whiteboard or table is gone comes back with `missing: true` and its stub
 * values intact — the caller renders a broken node and keeps the edges, so the
 * user can re-target or delete it deliberately.
 */
export async function resolveTableReferences(
  whiteboardId: string,
): Promise<Array<ResolvedTableReference>> {
  const references = await listTableReferences(whiteboardId)

  return references.map(({ table, columns }) => {
    const sourceWhiteboardName =
      (
        db
          .prepare('SELECT "name" FROM "Whiteboard" WHERE "id" = ?')
          .get(table.sourceWhiteboardId!) as { name?: string } | undefined
      )?.name ?? null

    const sourceTable = mapDiagramTable(
      db
        .prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?')
        .get(table.sourceTableId!),
    )
    // A source table that survived but moved to another file is as broken as a
    // deleted one — the reference no longer describes what it claims to.
    const sourceIsLive =
      sourceWhiteboardName !== null &&
      sourceTable !== null &&
      sourceTable.whiteboardId === table.sourceWhiteboardId

    const resolvedColumns = columns.map((stub) => {
      const live = stub.sourceColumnId
        ? mapColumn(
            db
              .prepare('SELECT * FROM "Column" WHERE "id" = ?')
              .get(stub.sourceColumnId),
          )
        : null
      const liveBelongs = live !== null && live.tableId === table.sourceTableId
      return {
        id: stub.id,
        sourceColumnId: stub.sourceColumnId,
        name: liveBelongs ? live.name : stub.name,
        dataType: liveBelongs ? live.dataType : stub.dataType,
        isPrimaryKey: liveBelongs ? live.isPrimaryKey : stub.isPrimaryKey,
        isForeignKey: liveBelongs ? live.isForeignKey : stub.isForeignKey,
        missing: !liveBelongs,
      }
    })

    return {
      table,
      sourceTableName: sourceIsLive ? sourceTable.name : table.name,
      sourceWhiteboardName,
      columns: resolvedColumns,
      missing: !sourceIsLive,
    }
  })
}

/**
 * Re-target a reference node, keeping its id and every relationship whose
 * endpoint column survives the change.
 *
 * A stub column is kept when the new selection still names the source column it
 * mirrors AND the source table did not change. Dropping the others deletes
 * their relationships through `Relationship`'s ON DELETE CASCADE on
 * sourceColumnId/targetColumnId — counted first, so the caller can confirm the
 * number before it happens.
 */
export async function updateTableReference(
  tableId: string,
  data: UpdateTableReferenceInput,
): Promise<UpdateTableReferenceResult> {
  const validated = updateTableReferenceSchema.parse(data)
  const existing = requireReference(tableId)

  const sourceWhiteboardId =
    validated.sourceWhiteboardId ?? existing.sourceWhiteboardId!
  const sourceTableId = validated.sourceTableId ?? existing.sourceTableId!
  const currentStubs = stubColumnsOf(tableId)
  const sourceColumnIds =
    validated.sourceColumnIds ??
    currentStubs
      .map((c) => c.sourceColumnId)
      .filter((id): id is string => id !== null)

  if (sourceColumnIds.length === 0) {
    throw new Error('A table reference needs at least one column')
  }

  const { sourceTable, sourceColumns } = loadSource({
    whiteboardId: existing.whiteboardId,
    sourceWhiteboardId,
    sourceTableId,
    sourceColumnIds,
  })

  // Only a stub of the SAME source table can survive: a different table's
  // column of the same name is a different thing entirely.
  const tableUnchanged = sourceTableId === existing.sourceTableId
  const keptIds = new Set(sourceColumnIds)
  const survivors = tableUnchanged
    ? currentStubs.filter(
        (c) => c.sourceColumnId !== null && keptIds.has(c.sourceColumnId),
      )
    : []
  const doomed = currentStubs.filter((c) => !survivors.includes(c))

  const deletedRelationships = doomed.reduce((total, column) => {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS n FROM "Relationship" WHERE "sourceColumnId" = ? OR "targetColumnId" = ?',
      )
      .get(column.id, column.id) as { n: number }
    return total + Number(row.n)
  }, 0)

  const sourceFileName =
    (
      db
        .prepare('SELECT "name" FROM "Whiteboard" WHERE "id" = ?')
        .get(sourceWhiteboardId) as { name?: string } | undefined
    )?.name ?? null

  const reference = transaction(() => {
    for (const column of doomed) {
      // Relationship's ON DELETE CASCADE on sourceColumnId/targetColumnId
      // removes the edges with the column.
      db.prepare('DELETE FROM "Column" WHERE "id" = ?').run(column.id)
    }

    const survivingSourceIds = new Set(
      survivors.map((c) => c.sourceColumnId as string),
    )
    let order = survivors.length
    for (const column of sourceColumns) {
      if (survivingSourceIds.has(column.id)) continue
      insertStubColumn(tableId, column, order)
      order += 1
    }

    update('DiagramTable', tableId, {
      name: tableUnchanged
        ? existing.name
        : uniqueNameOn(
            existing.whiteboardId,
            sourceTable.name,
            sourceFileName,
            tableId,
          ),
      sourceWhiteboardId,
      sourceTableId,
      updatedAt: nowMs(),
    })

    return readReference(tableId)
  })

  return { reference, deletedRelationships }
}

/**
 * Delete a reference node. Its stub columns and their relationships go with it
 * through the existing ON DELETE CASCADE chain.
 */
export async function deleteTableReference(
  tableId: string,
): Promise<TableReference> {
  requireReference(tableId)
  const existing = readReference(tableId)
  db.prepare('DELETE FROM "DiagramTable" WHERE "id" = ?').run(tableId)
  return existing
}

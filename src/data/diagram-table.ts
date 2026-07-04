// src/data/diagram-table.ts
// Data access layer for DiagramTable entity

import { createTableSchema, updateTableSchema } from './schema'
import type { CreateTable, UpdateTable } from './schema'
import type { Column, DiagramTable, Relationship } from './models'
import {
  db,
  genId,
  insert,
  mapColumn,
  mapDiagramTable,
  mapRelationship,
  nowMs,
  update,
} from '@/db'

/**
 * DiagramTable with columns and relationships
 */
export type DiagramTableWithRelations = DiagramTable & {
  columns: Array<Column>
  outgoingRelationships: Array<Relationship>
  incomingRelationships: Array<Relationship>
}

/**
 * Assemble the nested include shape for a single table:
 *   columns (ordered by "order" asc), outgoing + incoming relationships.
 */
function attachTableRelations(table: DiagramTable): DiagramTableWithRelations {
  const columns = db
    .prepare('SELECT * FROM "Column" WHERE "tableId" = ? ORDER BY "order" ASC')
    .all(table.id)
    .map((r) => mapColumn(r)!)
  const outgoingRelationships = db
    .prepare('SELECT * FROM "Relationship" WHERE "sourceTableId" = ?')
    .all(table.id)
    .map((r) => mapRelationship(r)!)
  const incomingRelationships = db
    .prepare('SELECT * FROM "Relationship" WHERE "targetTableId" = ?')
    .all(table.id)
    .map((r) => mapRelationship(r)!)
  return { ...table, columns, outgoingRelationships, incomingRelationships }
}

/**
 * Create a new table
 * @param data - Table creation data (validated with Zod)
 * @returns Created table
 * @throws Error if validation fails or database operation fails
 */
export async function createDiagramTable(
  data: CreateTable,
): Promise<DiagramTable> {
  // Validate input with Zod schema
  const validated = createTableSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('DiagramTable', {
      id,
      whiteboardId: validated.whiteboardId,
      name: validated.name,
      description: validated.description ?? null,
      positionX: validated.positionX ?? null,
      positionY: validated.positionY ?? null,
      width: validated.width ?? null,
      height: validated.height ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    return mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create table: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all tables in a whiteboard
 * @param whiteboardId - Whiteboard UUID
 * @returns Array of tables in the whiteboard
 */
export async function findDiagramTablesByWhiteboardId(
  whiteboardId: string,
): Promise<Array<DiagramTable>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "DiagramTable" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapDiagramTable(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch tables: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all tables in a whiteboard with columns and relationships
 * @param whiteboardId - Whiteboard UUID
 * @returns Array of tables with columns and relationships
 */
export async function findDiagramTablesByWhiteboardIdWithRelations(
  whiteboardId: string,
): Promise<Array<DiagramTableWithRelations>> {
  try {
    const tables = db
      .prepare(
        'SELECT * FROM "DiagramTable" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapDiagramTable(r)!)
    return tables.map((table) => attachTableRelations(table))
  } catch (error) {
    throw new Error(
      `Failed to fetch tables with relations: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a table by ID
 * @param id - Table UUID
 * @returns Table or null if not found
 */
export async function findDiagramTableById(
  id: string,
): Promise<DiagramTable | null> {
  try {
    return mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch table: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a table by ID with columns and relationships
 * @param id - Table UUID
 * @returns Table with columns and relationships or null if not found
 */
export async function findDiagramTableByIdWithRelations(
  id: string,
): Promise<DiagramTableWithRelations | null> {
  try {
    const table = mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )
    if (!table) return null
    return attachTableRelations(table)
  } catch (error) {
    throw new Error(
      `Failed to fetch table with relations: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a table
 * @param id - Table UUID
 * @param data - Partial table data to update (validated with Zod)
 * @returns Updated table
 * @throws Error if table not found or validation fails
 */
export async function updateDiagramTable(
  id: string,
  data: UpdateTable,
): Promise<DiagramTable> {
  // Validate input with Zod schema
  const validated = updateTableSchema.parse(data)

  try {
    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    if (validated.description !== undefined)
      values.description = validated.description
    if (validated.positionX !== undefined)
      values.positionX = validated.positionX
    if (validated.positionY !== undefined)
      values.positionY = validated.positionY
    if (validated.width !== undefined) values.width = validated.width
    if (validated.height !== undefined) values.height = validated.height
    update('DiagramTable', id, values)
    return mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update table: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update table position (for drag-and-drop)
 * @param id - Table UUID
 * @param positionX - New X coordinate
 * @param positionY - New Y coordinate
 * @returns Updated table
 */
export async function updateDiagramTablePosition(
  id: string,
  positionX: number,
  positionY: number,
): Promise<DiagramTable> {
  try {
    update('DiagramTable', id, { positionX, positionY, updatedAt: nowMs() })
    return mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update table position: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Atomically initialize table position using a first-write-wins conditional UPDATE.
 *
 * Runs: UPDATE "DiagramTable" SET positionX=?, positionY=?, updatedAt=?
 *       WHERE id=? AND positionX IS NULL
 *
 * This eliminates the TOCTOU window that exists when a read-then-write pattern is
 * used across an async gap: two concurrent socket handlers can both observe
 * positionX=null on the read, but only the first UPDATE that reaches SQLite will
 * match the WHERE clause and change a row (changes=1). The second will match no
 * rows (changes=0) and leave the winner's value intact.
 *
 * @param id - Table UUID
 * @param positionX - X coordinate to write if positionX is currently NULL
 * @param positionY - Y coordinate to write if positionY is currently NULL
 * @returns { changes: 1 if this caller won the race (row updated), 0 if already set;
 *            row: current authoritative DiagramTable row (or null if id not found) }
 */
export async function initDiagramTablePosition(
  id: string,
  positionX: number,
  positionY: number,
): Promise<{ changes: number; row: DiagramTable | null }> {
  try {
    const ts = nowMs()
    const result = db
      .prepare(
        `UPDATE "DiagramTable" SET "positionX" = ?, "positionY" = ?, "updatedAt" = ? WHERE "id" = ? AND "positionX" IS NULL`,
      )
      .run(positionX, positionY, ts, id) as { changes: number }
    const row = mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )
    return { changes: result.changes, row }
  } catch (error) {
    throw new Error(
      `Failed to initialize table position: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a table (cascade deletes all columns and relationships)
 * @param id - Table UUID
 * @returns Deleted table
 * @throws Error if table not found
 */
export async function deleteDiagramTable(id: string): Promise<DiagramTable> {
  try {
    const existing = mapDiagramTable(
      db.prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Table not found')
    db.prepare('DELETE FROM "DiagramTable" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete table: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

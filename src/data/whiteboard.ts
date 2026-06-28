// src/data/whiteboard.ts
// Data access layer for Whiteboard entity

import { createWhiteboardSchema, updateWhiteboardSchema } from './schema'
import type { CanvasState, CreateWhiteboard, UpdateWhiteboard } from './schema'
import type { Column, DiagramTable, Relationship, Whiteboard } from './models'
import {
  db,
  genId,
  insert,
  mapColumn,
  mapDiagramTable,
  mapRelationship,
  mapWhiteboard,
  nowMs,
  toDbJson,
  update,
} from '@/db'

/**
 * Whiteboard with full diagram data (tables, columns, relationships)
 */
export type WhiteboardWithDiagram = Whiteboard & {
  tables: Array<
    DiagramTable & {
      columns: Array<Column>
      outgoingRelationships: Array<Relationship>
      incomingRelationships: Array<Relationship>
    }
  >
}

/**
 * Create a new whiteboard
 */
export async function createWhiteboard(
  data: CreateWhiteboard,
): Promise<Whiteboard> {
  const validated = createWhiteboardSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('Whiteboard', {
      id,
      name: validated.name,
      projectId: validated.projectId,
      folderId: validated.folderId ?? null,
      canvasState: toDbJson(validated.canvasState),
      textSource: validated.textSource ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    return mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all whiteboards in a project
 */
export async function findWhiteboardsByProjectId(
  projectId: string,
): Promise<Array<Whiteboard>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Whiteboard" WHERE "projectId" = ? ORDER BY "updatedAt" DESC',
      )
      .all(projectId)
      .map((r) => mapWhiteboard(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all whiteboards in a folder
 */
export async function findWhiteboardsByFolderId(
  folderId: string,
): Promise<Array<Whiteboard>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Whiteboard" WHERE "folderId" = ? ORDER BY "updatedAt" DESC',
      )
      .all(folderId)
      .map((r) => mapWhiteboard(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a whiteboard by ID with full diagram data
 */
export async function findWhiteboardByIdWithDiagram(
  id: string,
): Promise<WhiteboardWithDiagram | null> {
  try {
    const whiteboard = mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )
    if (!whiteboard) return null

    const tables = db
      .prepare('SELECT * FROM "DiagramTable" WHERE "whiteboardId" = ?')
      .all(id)
      .map((r) => mapDiagramTable(r)!)

    const tablesWithChildren = tables.map((table) => {
      const columns = db
        .prepare(
          'SELECT * FROM "Column" WHERE "tableId" = ? ORDER BY "order" ASC',
        )
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
    })

    return { ...whiteboard, tables: tablesWithChildren }
  } catch (error) {
    throw new Error(
      `Failed to fetch whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a whiteboard by ID
 */
export async function findWhiteboardById(
  id: string,
): Promise<Whiteboard | null> {
  try {
    return mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a whiteboard
 */
export async function updateWhiteboard(
  id: string,
  data: UpdateWhiteboard,
): Promise<Whiteboard> {
  const validated = updateWhiteboardSchema.parse(data)

  try {
    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    if (validated.projectId !== undefined) values.projectId = validated.projectId
    if (validated.folderId !== undefined) values.folderId = validated.folderId
    if (validated.canvasState !== undefined)
      values.canvasState = toDbJson(validated.canvasState)
    if (validated.textSource !== undefined)
      values.textSource = validated.textSource
    update('Whiteboard', id, values)
    return mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update whiteboard canvas state
 */
export async function updateWhiteboardCanvasState(
  id: string,
  canvasState: CanvasState,
): Promise<Whiteboard> {
  try {
    update('Whiteboard', id, {
      canvasState: toDbJson(canvasState),
      updatedAt: nowMs(),
    })
    return mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update whiteboard text source
 */
export async function updateWhiteboardTextSource(
  id: string,
  textSource: string,
): Promise<Whiteboard> {
  try {
    update('Whiteboard', id, { textSource, updatedAt: nowMs() })
    return mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update text source: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a whiteboard (cascade deletes all tables, columns, relationships)
 */
export async function deleteWhiteboard(id: string): Promise<Whiteboard> {
  try {
    const existing = mapWhiteboard(
      db.prepare('SELECT * FROM "Whiteboard" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Whiteboard not found')
    db.prepare('DELETE FROM "Whiteboard" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete whiteboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find recent whiteboards (ordered by last updated)
 */
export async function findRecentWhiteboards(
  limit: number = 10,
): Promise<Array<Whiteboard>> {
  try {
    return db
      .prepare('SELECT * FROM "Whiteboard" ORDER BY "updatedAt" DESC LIMIT ?')
      .all(limit)
      .map((r) => mapWhiteboard(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch recent whiteboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

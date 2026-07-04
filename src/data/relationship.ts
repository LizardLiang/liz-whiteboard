// src/data/relationship.ts
// Data access layer for Relationship entity

import { createRelationshipSchema, updateRelationshipSchema } from './schema'
import type { CreateRelationship, UpdateRelationship } from './schema'
import type { Column, DiagramTable, Relationship } from './models'
import {
  db,
  genId,
  insert,
  mapColumn,
  mapDiagramTable,
  mapRelationship,
  nowMs,
  toDbJson,
  update,
} from '@/db'

// ---------------------------------------------------------------------------
// Shared referential-integrity validator (Apollo SA-2)
// ---------------------------------------------------------------------------

/**
 * Verify that source/target columns belong to the correct tables and that
 * both tables are inside the same whiteboard.
 *
 * Accepts the MERGED endpoint set (existing values overridden by patch values).
 * Called by both createRelationship and the relationship:update handler so
 * that the check is enforced at every write path.
 *
 * @throws Error with a structured message on any integrity violation.
 */
export async function assertRelationshipEndpointsValid(endpoints: {
  sourceTableId: string
  targetTableId: string
  sourceColumnId: string
  targetColumnId: string
  whiteboardId: string
}): Promise<void> {
  const {
    sourceTableId,
    targetTableId,
    sourceColumnId,
    targetColumnId,
    whiteboardId,
  } = endpoints

  // 1. Source column belongs to source table
  const sourceColumn = db
    .prepare('SELECT "tableId" FROM "Column" WHERE "id" = ?')
    .get(sourceColumnId) as { tableId: string } | undefined
  if (!sourceColumn || sourceColumn.tableId !== sourceTableId) {
    throw new Error(
      `sourceColumnId ${sourceColumnId} does not belong to sourceTableId ${sourceTableId}.`,
    )
  }

  // 2. Target column belongs to target table
  const targetColumn = db
    .prepare('SELECT "tableId" FROM "Column" WHERE "id" = ?')
    .get(targetColumnId) as { tableId: string } | undefined
  if (!targetColumn || targetColumn.tableId !== targetTableId) {
    throw new Error(
      `targetColumnId ${targetColumnId} does not belong to targetTableId ${targetTableId}.`,
    )
  }

  // 3. Both tables belong to the whiteboard
  const tables = db
    .prepare(
      'SELECT "id" FROM "DiagramTable" WHERE "id" IN (?, ?) AND "whiteboardId" = ?',
    )
    .all(sourceTableId, targetTableId, whiteboardId)
  const foundIds = new Set(tables.map((t) => t.id as string))
  if (!foundIds.has(sourceTableId)) {
    throw new Error(
      `sourceTableId ${sourceTableId} does not belong to whiteboard ${whiteboardId}.`,
    )
  }
  if (!foundIds.has(targetTableId)) {
    throw new Error(
      `targetTableId ${targetTableId} does not belong to whiteboard ${whiteboardId}.`,
    )
  }
}

/**
 * Relationship with source and target table/column details
 */
export type RelationshipWithDetails = Relationship & {
  sourceTable: DiagramTable
  targetTable: DiagramTable
  sourceColumn: Column
  targetColumn: Column
}

/**
 * Assemble the nested include shape for a single relationship:
 *   sourceTable, targetTable, sourceColumn, targetColumn.
 */
function attachRelationshipDetails(
  relationship: Relationship,
): RelationshipWithDetails {
  const sourceTable = mapDiagramTable(
    db
      .prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?')
      .get(relationship.sourceTableId),
  )!
  const targetTable = mapDiagramTable(
    db
      .prepare('SELECT * FROM "DiagramTable" WHERE "id" = ?')
      .get(relationship.targetTableId),
  )!
  const sourceColumn = mapColumn(
    db
      .prepare('SELECT * FROM "Column" WHERE "id" = ?')
      .get(relationship.sourceColumnId),
  )!
  const targetColumn = mapColumn(
    db
      .prepare('SELECT * FROM "Column" WHERE "id" = ?')
      .get(relationship.targetColumnId),
  )!
  return {
    ...relationship,
    sourceTable,
    targetTable,
    sourceColumn,
    targetColumn,
  }
}

/**
 * Create a new relationship
 * @param data - Relationship creation data (validated with Zod)
 * @returns Created relationship
 * @throws Error if validation fails or database operation fails
 */
export async function createRelationship(
  data: CreateRelationship,
): Promise<Relationship> {
  // Validate input with Zod schema
  const validated = createRelationshipSchema.parse(data)

  try {
    // Verify referential integrity using the shared validator (Apollo SA-2)
    await assertRelationshipEndpointsValid({
      sourceTableId: validated.sourceTableId,
      targetTableId: validated.targetTableId,
      sourceColumnId: validated.sourceColumnId,
      targetColumnId: validated.targetColumnId,
      whiteboardId: validated.whiteboardId,
    })

    const id = genId()
    const ts = nowMs()
    insert('Relationship', {
      id,
      whiteboardId: validated.whiteboardId,
      sourceTableId: validated.sourceTableId,
      targetTableId: validated.targetTableId,
      sourceColumnId: validated.sourceColumnId,
      targetColumnId: validated.targetColumnId,
      cardinality: validated.cardinality,
      label: validated.label ?? null,
      routingPoints: toDbJson(validated.routingPoints),
      createdAt: ts,
      updatedAt: ts,
    })
    return mapRelationship(
      db.prepare('SELECT * FROM "Relationship" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all relationships in a whiteboard
 * @param whiteboardId - Whiteboard UUID
 * @returns Array of relationships in the whiteboard
 */
export async function findRelationshipsByWhiteboardId(
  whiteboardId: string,
): Promise<Array<Relationship>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Relationship" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapRelationship(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch relationships: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all relationships in a whiteboard with table and column details
 * @param whiteboardId - Whiteboard UUID
 * @returns Array of relationships with source/target table/column details
 */
export async function findRelationshipsByWhiteboardIdWithDetails(
  whiteboardId: string,
): Promise<Array<RelationshipWithDetails>> {
  try {
    const relationships = db
      .prepare(
        'SELECT * FROM "Relationship" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapRelationship(r)!)
    return relationships.map((relationship) =>
      attachRelationshipDetails(relationship),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch relationships with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a relationship by ID
 * @param id - Relationship UUID
 * @returns Relationship or null if not found
 */
export async function findRelationshipById(
  id: string,
): Promise<Relationship | null> {
  try {
    return mapRelationship(
      db.prepare('SELECT * FROM "Relationship" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a relationship by ID with table and column details
 * @param id - Relationship UUID
 * @returns Relationship with source/target details or null if not found
 */
export async function findRelationshipByIdWithDetails(
  id: string,
): Promise<RelationshipWithDetails | null> {
  try {
    const relationship = mapRelationship(
      db.prepare('SELECT * FROM "Relationship" WHERE "id" = ?').get(id),
    )
    if (!relationship) return null
    return attachRelationshipDetails(relationship)
  } catch (error) {
    throw new Error(
      `Failed to fetch relationship with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all relationships connected to a table (incoming and outgoing)
 * @param tableId - Table UUID
 * @returns Array of relationships connected to the table
 */
export async function findRelationshipsByTableId(
  tableId: string,
): Promise<Array<Relationship>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Relationship" WHERE "sourceTableId" = ? OR "targetTableId" = ? ORDER BY "createdAt" ASC',
      )
      .all(tableId, tableId)
      .map((r) => mapRelationship(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch table relationships: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a relationship
 * @param id - Relationship UUID
 * @param data - Partial relationship data to update (validated with Zod)
 * @returns Updated relationship
 * @throws Error if relationship not found or validation fails
 */
export async function updateRelationship(
  id: string,
  data: UpdateRelationship,
): Promise<Relationship> {
  // Validate input with Zod schema
  const validated = updateRelationshipSchema.parse(data)

  try {
    // Load current relationship to compute merged endpoints (Apollo SA-2)
    const current = mapRelationship(
      db.prepare('SELECT * FROM "Relationship" WHERE "id" = ?').get(id),
    )
    if (!current) {
      throw new Error(`Relationship ${id} not found.`)
    }

    // If any endpoint field is being changed, validate the MERGED endpoints
    const endpointFields = [
      'sourceTableId',
      'targetTableId',
      'sourceColumnId',
      'targetColumnId',
    ] as const
    const hasEndpointChange = endpointFields.some(
      (f) => validated[f] !== undefined,
    )

    if (hasEndpointChange) {
      await assertRelationshipEndpointsValid({
        sourceTableId: validated.sourceTableId ?? current.sourceTableId,
        targetTableId: validated.targetTableId ?? current.targetTableId,
        sourceColumnId: validated.sourceColumnId ?? current.sourceColumnId,
        targetColumnId: validated.targetColumnId ?? current.targetColumnId,
        whiteboardId: current.whiteboardId,
      })
    }

    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.sourceTableId !== undefined)
      values.sourceTableId = validated.sourceTableId
    if (validated.targetTableId !== undefined)
      values.targetTableId = validated.targetTableId
    if (validated.sourceColumnId !== undefined)
      values.sourceColumnId = validated.sourceColumnId
    if (validated.targetColumnId !== undefined)
      values.targetColumnId = validated.targetColumnId
    if (validated.cardinality !== undefined)
      values.cardinality = validated.cardinality
    if (validated.label !== undefined) values.label = validated.label
    if (validated.routingPoints !== undefined)
      values.routingPoints = toDbJson(validated.routingPoints)
    update('Relationship', id, values)
    return mapRelationship(
      db.prepare('SELECT * FROM "Relationship" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a relationship
 * @param id - Relationship UUID
 * @returns Deleted relationship
 * @throws Error if relationship not found
 */
export async function deleteRelationship(id: string): Promise<Relationship> {
  try {
    const existing = mapRelationship(
      db.prepare('SELECT * FROM "Relationship" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Relationship not found')
    db.prepare('DELETE FROM "Relationship" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

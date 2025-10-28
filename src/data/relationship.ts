// src/data/relationship.ts
// Data access layer for Relationship entity

import { createRelationshipSchema, updateRelationshipSchema } from './schema'
import type { CreateRelationship, UpdateRelationship } from './schema'
import type { Column, DiagramTable, Relationship } from '@prisma/client'
import { prisma } from '@/db'

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
    // Verify source column belongs to source table
    const sourceColumn = await prisma.column.findUnique({
      where: { id: validated.sourceColumnId },
    })
    if (sourceColumn?.tableId !== validated.sourceTableId) {
      throw new Error('Source column does not belong to source table')
    }

    // Verify target column belongs to target table
    const targetColumn = await prisma.column.findUnique({
      where: { id: validated.targetColumnId },
    })
    if (targetColumn?.tableId !== validated.targetTableId) {
      throw new Error('Target column does not belong to target table')
    }

    const relationship = await prisma.relationship.create({
      data: validated,
    })
    return relationship
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
    const relationships = await prisma.relationship.findMany({
      where: { whiteboardId },
      orderBy: { createdAt: 'asc' },
    })
    return relationships
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
    const relationships = await prisma.relationship.findMany({
      where: { whiteboardId },
      include: {
        sourceTable: true,
        targetTable: true,
        sourceColumn: true,
        targetColumn: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    return relationships
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
    const relationship = await prisma.relationship.findUnique({
      where: { id },
    })
    return relationship
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
    const relationship = await prisma.relationship.findUnique({
      where: { id },
      include: {
        sourceTable: true,
        targetTable: true,
        sourceColumn: true,
        targetColumn: true,
      },
    })
    return relationship
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
    const relationships = await prisma.relationship.findMany({
      where: {
        OR: [{ sourceTableId: tableId }, { targetTableId: tableId }],
      },
      orderBy: { createdAt: 'asc' },
    })
    return relationships
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
    const relationship = await prisma.relationship.update({
      where: { id },
      data: validated,
    })
    return relationship
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
    const relationship = await prisma.relationship.delete({
      where: { id },
    })
    return relationship
  } catch (error) {
    throw new Error(
      `Failed to delete relationship: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

// src/data/shape.ts
// Data access layer for the Shape entity (Phase 1: shapes-and-connectors).
// Mirrors src/data/area.ts's style exactly: raw db.prepare calls,
// insert/update/genId/nowMs helpers from @/db.
//
// Phase-2 pre-compliance convention (decomposition.md, binding): every
// mutating function here reads the full prior row before writing. Deletion
// (which always cascades to attached connectors) lives in
// src/data/connector.ts's `deleteShapeWithConnectors` — there is no
// un-cascaded delete for a Shape.

import { createShapeSchema, updateShapeSchema } from './schema'
import type { CreateShape, UpdateShape } from './schema'
import type { Shape } from './models'
import { db, genId, insert, mapShape, nowMs, toDbJson, update } from '@/db'

/**
 * Create a new shape.
 * @param data - Shape creation data (validated with Zod)
 * @returns Created shape
 * @throws Error if validation fails or database operation fails
 */
export async function createShape(data: CreateShape): Promise<Shape> {
  const validated = createShapeSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('Shape', {
      id,
      whiteboardId: validated.whiteboardId,
      kind: validated.kind,
      positionX: validated.positionX,
      positionY: validated.positionY,
      width: validated.width,
      height: validated.height,
      rotation: 0,
      zIndex: 0,
      text: validated.text ?? null,
      style: toDbJson(validated.style ?? {}),
      props: toDbJson(validated.props),
      createdAt: ts,
      updatedAt: ts,
    })
    return mapShape(db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(id))!
  } catch (error) {
    throw new Error(
      `Failed to create shape: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all shapes in a whiteboard, oldest first (creation order — newer
 * shapes render on top within the same z-index, tech-spec §5).
 */
export async function findShapesByWhiteboard(
  whiteboardId: string,
): Promise<Array<Shape>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Shape" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapShape(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch shapes: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a shape by ID.
 * @returns Shape or null if not found
 */
export async function findShapeById(id: string): Promise<Shape | null> {
  try {
    return mapShape(db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(id))
  } catch (error) {
    throw new Error(
      `Failed to fetch shape: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a shape (partial). Only explicitly-provided fields are written.
 *
 * Reads the full prior row BEFORE writing (Phase-2 pre-compliance
 * convention) — the read is not optional or purely defensive: it is the
 * seam Phase 2's version-token/undo mechanism will build on.
 *
 * @throws Error if the shape does not exist or the database operation fails
 */
export async function updateShape(
  id: string,
  data: UpdateShape,
): Promise<Shape> {
  const validated = updateShapeSchema.parse(data)

  try {
    // Pre-compliance: read the full prior row before writing.
    const prior = mapShape(
      db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(id),
    )
    if (!prior) throw new Error('Shape not found')

    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.positionX !== undefined)
      values.positionX = validated.positionX
    if (validated.positionY !== undefined)
      values.positionY = validated.positionY
    if (validated.width !== undefined) values.width = validated.width
    if (validated.height !== undefined) values.height = validated.height
    if (validated.text !== undefined) values.text = validated.text
    if (validated.style !== undefined) values.style = toDbJson(validated.style)
    if (validated.props !== undefined) values.props = toDbJson(validated.props)

    update('Shape', id, values)
    return mapShape(db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(id))!
  } catch (error) {
    throw new Error(
      `Failed to update shape: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

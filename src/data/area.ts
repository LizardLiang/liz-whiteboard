// src/data/area.ts
// Data access layer for the Area entity (subject areas / table grouping, GH #106)

import { createAreaSchema, updateAreaSchema } from './schema'
import type { CreateArea, UpdateArea } from './schema'
import type { Area } from './models'
import { db, genId, insert, mapArea, nowMs, toDbJson, update } from '@/db'

/**
 * Create a new subject area.
 * @param data - Area creation data (validated with Zod)
 * @returns Created area
 * @throws Error if validation fails or database operation fails
 */
export async function createArea(data: CreateArea): Promise<Area> {
  const validated = createAreaSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('Area', {
      id,
      whiteboardId: validated.whiteboardId,
      name: validated.name,
      color: validated.color,
      positionX: validated.positionX,
      positionY: validated.positionY,
      width: validated.width,
      height: validated.height,
      memberTableIds: toDbJson(validated.memberTableIds),
      createdAt: ts,
      updatedAt: ts,
    })
    return mapArea(db.prepare('SELECT * FROM "Area" WHERE "id" = ?').get(id))!
  } catch (error) {
    throw new Error(
      `Failed to create area: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all areas in a whiteboard (creation order).
 * @param whiteboardId - Whiteboard UUID
 */
export async function findAreasByWhiteboard(
  whiteboardId: string,
): Promise<Array<Area>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Area" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapArea(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch areas: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find an area by ID.
 * @param id - Area UUID
 * @returns Area or null if not found
 */
export async function findAreaById(id: string): Promise<Area | null> {
  try {
    return mapArea(db.prepare('SELECT * FROM "Area" WHERE "id" = ?').get(id))
  } catch (error) {
    throw new Error(
      `Failed to fetch area: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update an area (partial). Only explicitly-provided fields are written.
 * @param id - Area UUID
 * @param data - Partial area data (validated with Zod)
 * @returns Updated area
 */
export async function updateArea(id: string, data: UpdateArea): Promise<Area> {
  const validated = updateAreaSchema.parse(data)

  try {
    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    if (validated.color !== undefined) values.color = validated.color
    if (validated.positionX !== undefined)
      values.positionX = validated.positionX
    if (validated.positionY !== undefined)
      values.positionY = validated.positionY
    if (validated.width !== undefined) values.width = validated.width
    if (validated.height !== undefined) values.height = validated.height
    if (validated.memberTableIds !== undefined)
      values.memberTableIds = toDbJson(validated.memberTableIds)
    update('Area', id, values)
    return mapArea(db.prepare('SELECT * FROM "Area" WHERE "id" = ?').get(id))!
  } catch (error) {
    throw new Error(
      `Failed to update area: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete an area. Member tables are NOT deleted — only the grouping is removed.
 * @param id - Area UUID
 * @returns The deleted area
 * @throws Error if the area does not exist
 */
export async function deleteArea(id: string): Promise<Area> {
  try {
    const existing = mapArea(
      db.prepare('SELECT * FROM "Area" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Area not found')
    db.prepare('DELETE FROM "Area" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete area: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Remove a table id from the membership of every area on a whiteboard.
 * Called when a table is deleted so no area keeps a dangling member id.
 * @returns The areas whose membership changed (already persisted).
 */
export async function removeTableFromAreas(
  whiteboardId: string,
  tableId: string,
): Promise<Array<Area>> {
  const areas = await findAreasByWhiteboard(whiteboardId)
  const affected: Array<Area> = []
  for (const area of areas) {
    if (area.memberTableIds.includes(tableId)) {
      const next = area.memberTableIds.filter((mid) => mid !== tableId)
      affected.push(await updateArea(area.id, { memberTableIds: next }))
    }
  }
  return affected
}

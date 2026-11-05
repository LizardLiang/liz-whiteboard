// Payload validation helpers for the whiteboard Socket.IO namespace
// (audit M10: unvalidated coordinates, foreign table ids, cursor flood).
import { z } from 'zod'
import { db } from '@/db'

/** Coordinates beyond this are never legitimate canvas positions. */
const COORD_LIMIT = 10_000_000
const coord = z.number().finite().min(-COORD_LIMIT).max(COORD_LIMIT)

export const tableMovePayloadSchema = z.object({
  tableId: z.string().uuid(),
  positionX: coord,
  positionY: coord,
  isInit: z.boolean().optional(),
})

export const cursorPayloadSchema = z.object({ x: coord, y: coord })

/** Ids from `tableIds` that are not tables of `whiteboardId` (deduplicated). */
export function findForeignTableIds(
  whiteboardId: string,
  tableIds: ReadonlyArray<string>,
): Array<string> {
  const unique = [...new Set(tableIds)]
  if (unique.length === 0) return []
  const owned = new Set<string>()
  // Chunk to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200)
    const rows = db
      .prepare(
        `SELECT "id" FROM "DiagramTable"
          WHERE "whiteboardId" = ? AND "id" IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(whiteboardId, ...chunk) as Array<{ id: string }>
    for (const row of rows) owned.add(row.id)
  }
  return unique.filter((id) => !owned.has(id))
}

/** Ids from `areaIds` that are not areas of `whiteboardId` (deduplicated). */
export function findForeignAreaIds(
  whiteboardId: string,
  areaIds: ReadonlyArray<string>,
): Array<string> {
  const unique = [...new Set(areaIds)]
  if (unique.length === 0) return []
  const owned = new Set<string>()
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200)
    const rows = db
      .prepare(
        `SELECT "id" FROM "Area"
          WHERE "whiteboardId" = ? AND "id" IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(whiteboardId, ...chunk) as Array<{ id: string }>
    for (const row of rows) owned.add(row.id)
  }
  return unique.filter((id) => !owned.has(id))
}

/**
 * Per-socket event limiter: allows `max` events per `windowMs`, drops the
 * rest. Cursor updates are fire-and-forget, so dropping is harmless.
 */
export function createEventLimiter(max = 60, windowMs = 1000) {
  let windowStart = 0
  let count = 0
  return (now: number = Date.now()): boolean => {
    if (now - windowStart >= windowMs) {
      windowStart = now
      count = 0
    }
    count += 1
    return count <= max
  }
}

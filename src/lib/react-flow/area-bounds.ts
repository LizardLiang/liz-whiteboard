// src/lib/react-flow/area-bounds.ts
// Geometry for subject-area membership: which tables a rectangle encloses, and
// which area a dropped table belongs to.
//
// NO AUTO-FIT LIVES HERE ANY MORE. This module used to own `computeAreaBounds`,
// which derived an area's rectangle from its members and was applied on every
// membership change, member drag and Auto Layout run. It was removed with the
// rest of auto-fit: an area's size and position belong to the user (drawn on
// create, changed with AreaNode's resize handles), and nothing recomputes them.
// Everything left here READS an area's rectangle to decide membership; nothing
// writes one.


/**
 * An area's rectangle in absolute flow coordinates — the persisted
 * `{positionX, positionY, width, height}` exactly as the user drew or resized
 * it, so a raw point-in-rect test matches what is on screen.
 */
export interface AreaRect {
  positionX: number
  positionY: number
  width: number
  height: number
}

/** True if point (x,y) lies within the area's rectangle (inclusive of edges). */
export function areaRectContainsPoint(
  rect: AreaRect,
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= rect.positionX &&
    point.x <= rect.positionX + rect.width &&
    point.y >= rect.positionY &&
    point.y <= rect.positionY + rect.height
  )
}

/**
 * Of the areas whose rectangle contains `point`, returns the one with the
 * smallest area (width*height), or null if none contain it. Ties broken by
 * array order (first wins) for determinism.
 */
export function smallestAreaContainingPoint<T extends AreaRect>(
  areas: ReadonlyArray<T>,
  point: { x: number; y: number },
): T | null {
  let best: T | null = null
  let bestSize = Infinity
  for (const a of areas) {
    if (!areaRectContainsPoint(a, point)) continue
    const size = a.width * a.height
    if (size < bestSize) {
      best = a
      bestSize = size
    }
  }
  return best
}

/** A table considered for enclosure by a freshly drawn area rectangle. */
export interface EnclosureCandidate {
  id: string
  /** The table's centre point in flow coordinates. */
  center: { x: number; y: number }
}

/**
 * Returns the ids of every table whose CENTRE lies inside `rect` (todo #55
 * item 2: drawing an area around existing tables groups them into it).
 *
 * Centre-point, deliberately — not full containment. It is the exact same
 * test `reconcileAreaMembership` uses for drag-in/drag-out membership, so a
 * table that joins by being drawn around does not immediately leave the next
 * time it is dragged one pixel, and the user learns one rule for both paths.
 * Input order is preserved so the resulting membership list is deterministic.
 */
export function tableIdsEnclosedByRect(
  tables: ReadonlyArray<EnclosureCandidate>,
  rect: AreaRect,
): Array<string> {
  return tables
    .filter((t) => areaRectContainsPoint(rect, t.center))
    .map((t) => t.id)
}

/**
 * An area shape as consumed by `reconcileAreaMembership` — the same
 * `{positionX, positionY, width, height}` rectangle plus the identity/
 * membership fields needed to decide join/leave.
 */
export interface ReconcileArea extends AreaRect {
  id: string
  memberTableIds: ReadonlyArray<string>
}

/** Result of reconciling one table's dropped position against all areas. */
export interface AreaReconciliation {
  /** areaId to add the table to (the single smallest containing area not
   *  already a member), or null if there's no such area. */
  join: string | null
  /** areaIds to remove the table from — current member, center now outside. */
  leave: Array<string>
}

/**
 * Computes the join/leave membership changes for a single table dropped at
 * `center` (drag-in / drag-out):
 *
 * - join: the smallest area containing `center` (via
 *   `smallestAreaContainingPoint`) that `tableId` is NOT already a member
 *   of, or null.
 * - leave: every area `tableId` IS a member of whose rectangle no longer
 *   contains `center`.
 *
 * A member that stays inside its area produces neither — it is simply left
 * alone. (This used to also return a `refit` set, naming the areas whose bounds
 * should be recomputed around the moved member. Auto-fit was removed, so there
 * is nothing to tell: an area's rectangle only ever changes when the user
 * changes it.)
 */
export function reconcileAreaMembership(
  areas: ReadonlyArray<ReconcileArea>,
  tableId: string,
  center: { x: number; y: number },
): AreaReconciliation {
  const smallest = smallestAreaContainingPoint(areas, center)
  const join =
    smallest && !smallest.memberTableIds.includes(tableId) ? smallest.id : null

  const leave: Array<string> = []
  for (const area of areas) {
    if (!area.memberTableIds.includes(tableId)) continue
    if (!areaRectContainsPoint(area, center)) leave.push(area.id)
  }

  return { join, leave }
}

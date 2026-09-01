// src/lib/react-flow/node-nesting.ts
// Absolute <-> parent-relative position conversion for area-nested table nodes
// (todo #55 follow-up: a table dragged into an area is PUT INTO it — a real
// React Flow parent/child, not just an id in `Area.memberTableIds`).
//
// THE ONE THING TO UNDERSTAND HERE
// React Flow reads a child node's `position` as RELATIVE to its parent, and
// paints it at `parent.position + child.position`. Everything else in this
// codebase — the DB's `DiagramTable.positionX/Y`, auto-layout, export, edge
// handle routing, area auto-fit — speaks ABSOLUTE flow coordinates. So nesting
// is not just setting `parentId`: it introduces two coordinate spaces, and every
// value crossing between them has to be converted.
//
// The split this module exists to keep honest:
//   - INSIDE React Flow's node state, a member table's position is RELATIVE.
//     That is what makes the area a real movable container: dragging the area
//     changes only the PARENT's position, every child's relative position is
//     untouched, and React Flow repaints the children in the right place for
//     free. (The pre-nesting implementation had to translate every member by
//     the drag delta on every frame; that code is gone precisely because this
//     is now structural.)
//   - EVERYWHERE ELSE — anything leaving the canvas, and anything feeding edge
//     routing — the position is ABSOLUTE.
//
// A table that belongs to no area is never a child, so `toAbsolute`/`toRelative`
// are identity for it and every ungrouped table keeps its pre-nesting behaviour
// exactly. That is deliberate: it bounds the blast radius of nesting to exactly
// the tables the user has actually grouped.

/** The parent rectangle a child is positioned against — an Area's persisted
 *  top-left, in absolute flow coordinates. */
export interface NestingParent {
  id: string
  positionX: number
  positionY: number
}

export interface XY {
  x: number
  y: number
}

/**
 * Maps each member table id to the area that owns it.
 *
 * A table may legally appear in only ONE area's `memberTableIds` (cross-area
 * exclusivity is enforced by the membership writers). If a stale row ever
 * violated that, first-wins keeps this deterministic rather than letting the
 * node flicker between two parents on re-render.
 *
 * Areas absent from `areas` are skipped, which is what keeps nested canvases
 * safe: TableFocusOverlay renders tables with NO area nodes at all, so nothing
 * gets a `parentId` pointing at a node React Flow cannot find (that would be a
 * hard React Flow error, not a cosmetic bug).
 */
export function buildParentIndex(
  areas: ReadonlyArray<{
    id: string
    positionX: number
    positionY: number
    memberTableIds: ReadonlyArray<string>
  }>,
): Map<string, NestingParent> {
  const index = new Map<string, NestingParent>()
  for (const area of areas) {
    const parent: NestingParent = {
      id: area.id,
      positionX: area.positionX,
      positionY: area.positionY,
    }
    for (const tableId of area.memberTableIds) {
      if (!index.has(tableId)) index.set(tableId, parent)
    }
  }
  return index
}

/** Absolute -> parent-relative. Identity when the node has no parent. */
export function toRelative(
  absolute: XY,
  parent: NestingParent | undefined,
): XY {
  if (!parent) return absolute
  return {
    x: absolute.x - parent.positionX,
    y: absolute.y - parent.positionY,
  }
}

/** Parent-relative -> absolute. Identity when the node has no parent. */
export function toAbsolute(
  relative: XY,
  parent: NestingParent | undefined,
): XY {
  if (!parent) return relative
  return {
    x: relative.x + parent.positionX,
    y: relative.y + parent.positionY,
  }
}

/**
 * Re-expresses a whole node list in absolute coordinates — the shape edge
 * routing needs. Nodes without a parent pass through by identity (same object,
 * not a copy), so the common all-ungrouped board allocates nothing extra on the
 * drag path this feeds.
 */
export function toAbsoluteNodes<
  T extends { id: string; position: XY },
>(nodes: ReadonlyArray<T>, parents: ReadonlyMap<string, NestingParent>): Array<T> {
  if (parents.size === 0) return nodes as Array<T>
  return nodes.map((n) => {
    const parent = parents.get(n.id)
    if (!parent) return n
    return { ...n, position: toAbsolute(n.position, parent) }
  })
}

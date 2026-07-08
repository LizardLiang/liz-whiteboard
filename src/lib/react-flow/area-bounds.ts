// src/lib/react-flow/area-bounds.ts
// Computes an auto-fit bounding box for a subject area's member tables
// (GH #106 grouping bugfix). Bug 2 root cause: areas were static and never
// followed/enclosed their members. `computeAreaBounds` is the pure geometry
// piece — callers (ReactFlowWhiteboard's `refitArea`/`refitAllAreas`) read
// live member node geometry via `reactFlowInstance.getNodes()`, compute new
// bounds, and persist them through `updateAreaMutation` only when changed
// (feedback-loop guard lives at the call site, not here).

import { calculateTableHeight } from './layout-adapter'
import { LAYOUT_CONSTRAINTS, MIN_AREA_HEIGHT, MIN_AREA_WIDTH } from './types'

/** Minimal node shape this module needs — matches React Flow's Node<T>. */
export interface AreaBoundsMemberNode {
  position: { x: number; y: number }
  measured?: { width?: number; height?: number }
  width?: number | null
  height?: number | null
  /**
   * Number of columns on this member's table. Height is ALWAYS derived from
   * this via `calculateTableHeight` (area-fit-member-content) — never from
   * `measured.height`/`height` — so an area's fit is a client-independent
   * function of the table's full content (all fields), not whatever showMode
   * (Compact/Keys/All) the viewing client happens to have selected. Width is
   * unaffected and still prefers `measured.width` (see below).
   */
  columnCount: number
}

export interface AreaBounds {
  positionX: number
  positionY: number
  width: number
  height: number
}

/**
 * Minimal rectangle shape shared by area hit-testing helpers below
 * (area-drag-in-membership, GH #106 item 3). Matches the persisted area
 * fields — the same `{positionX, positionY, width, height}` computed by
 * `computeAreaBounds` above (already inclusive of the 32px label header +
 * 24px padding), so a raw point-in-rect test matches what the user sees.
 */
export interface AreaRect {
  positionX: number
  positionY: number
  width: number
  height: number
}

export interface ComputeAreaBoundsOptions {
  /** Padding (px) added on all sides around the members' bounding box. */
  padding?: number
  /** Extra inset (px) added to the top for the area's name/label header. */
  topInset?: number
  /** Floor for the returned width — mirrors AreaNode's NodeResizer minWidth. */
  minWidth?: number
  /** Floor for the returned height — mirrors AreaNode's NodeResizer minHeight. */
  minHeight?: number
}

const DEFAULT_PADDING = 24
const DEFAULT_TOP_INSET = 32

/**
 * Height (px) of the always-rendered "+" add-column affordance row at the
 * bottom of an editable table node (mirrors TableNode.tsx COLUMN_ROW_HEIGHT).
 * `calculateTableHeight` counts header + data rows only, so without this an area
 * ends up ~one row short and the member's add-row edge pokes past the bottom
 * border (area-fit-member-content runtime finding: ~4px overflow).
 */
const ADD_COLUMN_ROW_HEIGHT = 28

/**
 * Computes the bounding box (top-left position + size) that encloses every
 * member node, plus padding and a label-header inset. Returns `null` for an
 * empty member list — callers should treat that as "no auto-fit, leave the
 * area's current bounds alone" (matches the "empty area keeps manual bounds"
 * rule in the tactical plan).
 */
export function computeAreaBounds(
  memberNodes: ReadonlyArray<AreaBoundsMemberNode>,
  options: ComputeAreaBoundsOptions = {},
): AreaBounds | null {
  if (memberNodes.length === 0) return null

  const padding = options.padding ?? DEFAULT_PADDING
  const topInset = options.topInset ?? DEFAULT_TOP_INSET
  const minWidth = options.minWidth ?? MIN_AREA_WIDTH
  const minHeight = options.minHeight ?? MIN_AREA_HEIGHT

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of memberNodes) {
    const width =
      node.measured?.width ??
      node.width ??
      LAYOUT_CONSTRAINTS.DEFAULT_NODE_WIDTH
    // Full-content height (area-fit-member-content) — mode-independent,
    // deliberately NOT node.measured?.height/node.height (those reflect the
    // viewing client's showMode, so an area sized from them could overflow
    // for a peer viewing in a taller display mode). Add the "+" add-column
    // affordance row (excluded by calculateTableHeight) so an editable member
    // is fully enclosed, not ~one row short.
    const height = calculateTableHeight(node.columnCount) + ADD_COLUMN_ROW_HEIGHT

    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }

  const rawWidth = maxX - minX + padding * 2
  const rawHeight = maxY - minY + padding * 2 + topInset

  return {
    positionX: minX - padding,
    positionY: minY - padding - topInset,
    width: Math.max(rawWidth, minWidth),
    height: Math.max(rawHeight, minHeight),
  }
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

/**
 * An area shape as consumed by `reconcileAreaMembership` — the same
 * `{positionX, positionY, width, height}` rectangle plus the identity/
 * membership fields (GH #106 item 3, Hermes coverage-gap fix) needed to
 * decide join/leave/refit.
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
  /** areaIds to re-fit — current member, center still inside (unchanged
   *  membership, moved member). Never includes the join target. */
  refit: Array<string>
}

/**
 * Computes the join/leave/refit area-membership sets for a single table
 * dropped at `center` (GH #106 item 3 — drag-in/out membership). Extracted
 * from ReactFlowWhiteboard's `handleNodeDragStop` inline logic (Hermes
 * coverage-gap fix) — semantics are reproduced exactly, byte-for-byte:
 *
 * - join: the smallest area containing `center` (via
 *   `smallestAreaContainingPoint`) that `tableId` is NOT already a member
 *   of, or null.
 * - leave: every area `tableId` IS a member of whose rectangle no longer
 *   contains `center`.
 * - refit: every area `tableId` IS a member of whose rectangle still
 *   contains `center` (still-member, still-inside — re-fit for the moved
 *   member).
 *
 * The three sets are mutually exclusive by construction (join ⇒ not
 * previously a member; leave ⇒ center outside; refit ⇒ member & inside), so
 * the join target is never also included in refit.
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
  const refit: Array<string> = []
  for (const area of areas) {
    if (!area.memberTableIds.includes(tableId)) continue
    if (areaRectContainsPoint(area, center)) {
      refit.push(area.id)
    } else {
      leave.push(area.id)
    }
  }

  return { join, leave, refit }
}

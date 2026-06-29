/**
 * resolve-pending-positions.ts
 *
 * Client-side position resolution for tables created by the MCP server without
 * an explicit position (positionX/positionY are null in the DB).
 *
 * After React Flow measures the rendered dimensions of pending nodes via
 * ResizeObserver, this function computes a non-overlapping grid slot for each
 * pending node and returns the {id, x, y} placements.
 */

import type { Node } from '@xyflow/react'
import type { TableNodeData } from './types'

/** Axis-aligned bounding box (absolute canvas coordinates). */
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Grid layout constants for pending-position resolution. */
const ORIGIN_X = 40
const ORIGIN_Y = 40
const COL_W = 300
const ROW_H = 240
const COLS = 4
/** Maximum grid slots to try before giving up and stacking. */
const MAX_SLOTS = 2000

/** Returns true when candidate rect (cx,cy,cw,ch) overlaps any rect in the list. */
function overlapsAny(
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  rects: Array<Rect>,
): boolean {
  for (const r of rects) {
    const xOverlap = cx < r.x + r.w && r.x < cx + cw
    const yOverlap = cy < r.y + r.h && r.y < cy + ch
    if (xOverlap && yOverlap) return true
  }
  return false
}

/** Maps a linear slot index to a grid coordinate. */
function slotToXY(slot: number): { x: number; y: number } {
  const col = slot % COLS
  const row = Math.floor(slot / COLS)
  return { x: ORIGIN_X + col * COL_W, y: ORIGIN_Y + row * ROW_H }
}

export interface PendingPlacement {
  id: string
  x: number
  y: number
}

/**
 * Compute non-overlapping canvas positions for pending nodes.
 *
 * @param pendingNodes - React Flow nodes with positionPending=true AND
 *   node.measured set (React Flow has measured their rendered dimensions).
 * @param allNodes - All current React Flow nodes (used to build the initial
 *   AABB set so pending nodes don't land on top of already-positioned tables).
 * @returns Array of {id, x, y} placements, one per pending node in input order.
 */
export function resolvePendingPositions(
  pendingNodes: Array<Node<TableNodeData>>,
  allNodes: Array<Node<TableNodeData>>,
): Array<PendingPlacement> {
  if (pendingNodes.length === 0) return []

  // Build the initial occupied-rects set from all already-positioned nodes
  // (i.e. nodes that are NOT pending).
  const placedRects: Array<Rect> = []
  for (const node of allNodes) {
    if (node.data.positionPending) continue
    const w = node.measured?.width ?? node.width ?? COL_W
    const h = node.measured?.height ?? node.height ?? ROW_H
    placedRects.push({ x: node.position.x, y: node.position.y, w, h })
  }

  const placements: Array<PendingPlacement> = []

  for (const node of pendingNodes) {
    const w = node.measured?.width ?? node.width ?? COL_W
    const h = node.measured?.height ?? node.height ?? ROW_H

    // Scan grid slots until we find one that doesn't overlap anything.
    let placed = false
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      const { x, y } = slotToXY(slot)
      if (!overlapsAny(x, y, w, h, placedRects)) {
        placements.push({ id: node.id, x, y })
        placedRects.push({ x, y, w, h })
        placed = true
        break
      }
    }

    if (!placed) {
      // Fallback: stack beyond MAX_SLOTS (should not happen in practice).
      const { x, y } = slotToXY(MAX_SLOTS + placements.length)
      placements.push({ id: node.id, x, y })
      placedRects.push({ x, y, w, h })
    }
  }

  return placements
}

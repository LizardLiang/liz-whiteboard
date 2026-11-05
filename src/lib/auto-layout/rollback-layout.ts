// src/lib/auto-layout/rollback-layout.ts
// Narrow rollback of an optimistic Auto Layout, in React Flow's store
// coordinate space (member tables RELATIVE to their area's origin).
//
// Restores only what the layout itself changed:
//   - a table the layout moved, if its store position still equals the one the
//     layout applied (otherwise someone moved it since, and it stays);
//   - an area the layout resized, if its bounds still equal the applied ones.
// Every other node keeps its content. Nodes whose area origin moved are
// shifted so their absolute position does not change.

import type { Node } from '@xyflow/react'
import type { AreaNodeType, TableNodeType } from '@/lib/react-flow/types'

interface Point {
  x: number
  y: number
}

export interface RollbackAreaBounds {
  id: string
  positionX: number
  positionY: number
  width: number
  height: number
}

export interface RollbackResult {
  nodes: Array<Node>
  /** Areas whose previous bounds were restored */
  restoredAreaIds: Set<string>
  /** Tables whose snapshot position was restored */
  restoredTableIds: Set<string>
}

export function samePosition(a: Point, b: Point | undefined): boolean {
  return b !== undefined && a.x === b.x && a.y === b.y
}

/**
 * @param current - nodes in the store now
 * @param snapshot - store nodes before the layout was applied
 * @param applied - store nodes the layout wrote
 * @param movedIds - ids of the tables the layout moved
 * @param appliedAreas - bounds the layout wrote
 * @param previousAreas - bounds the areas held before the layout
 */
export function rollbackLayout(
  current: ReadonlyArray<Node>,
  snapshot: ReadonlyArray<Node>,
  applied: ReadonlyArray<Node>,
  movedIds: ReadonlySet<string>,
  appliedAreas: ReadonlyArray<RollbackAreaBounds>,
  previousAreas: ReadonlyArray<RollbackAreaBounds>,
): RollbackResult {
  const appliedAreaById = new Map(appliedAreas.map((b) => [b.id, b]))
  const previousAreaById = new Map(previousAreas.map((b) => [b.id, b]))
  const snapshotById = new Map(snapshot.map((n) => [n.id, n]))
  const appliedById = new Map(applied.map((n) => [n.id, n]))

  const restoredAreaIds = new Set<string>()
  const originBefore = new Map<string, Point>()
  const originAfter = new Map<string, Point>()

  // Pass 1 — areas
  const afterAreas = current.map((n) => {
    if (n.type !== 'area') return n
    originBefore.set(n.id, n.position)
    originAfter.set(n.id, n.position)
    const at = appliedAreaById.get(n.id)
    const prev = previousAreaById.get(n.id)
    if (!at || !prev) return n
    const areaNode = n as unknown as AreaNodeType
    const untouched =
      n.position.x === at.positionX &&
      n.position.y === at.positionY &&
      areaNode.width === at.width &&
      areaNode.height === at.height
    if (!untouched) return n
    restoredAreaIds.add(n.id)
    originAfter.set(n.id, { x: prev.positionX, y: prev.positionY })
    return {
      ...areaNode,
      position: { x: prev.positionX, y: prev.positionY },
      width: prev.width,
      height: prev.height,
      data: {
        ...areaNode.data,
        area: {
          ...areaNode.data.area,
          positionX: prev.positionX,
          positionY: prev.positionY,
          width: prev.width,
          height: prev.height,
        },
      },
    }
  })

  // Pass 2 — tables and other nodes
  const restoredTableIds = new Set<string>()
  const nodes = afterAreas.map((n) => {
    if (n.type === 'area') return n

    const at = appliedById.get(n.id)
    const snap = snapshotById.get(n.id)
    if (
      movedIds.has(n.id) &&
      at &&
      snap &&
      samePosition(n.position, at.position) &&
      n.parentId === snap.parentId
    ) {
      const parentId = snap.parentId
      if (!parentId || restoredAreaIds.has(parentId)) {
        restoredTableIds.add(n.id)
        return { ...n, position: snap.position }
      }
      // The snapshot area was moved by someone else since: keep the table at
      // the same absolute spot inside it.
      const snapOrigin = snapshotById.get(parentId)?.position
      const nowOrigin = originAfter.get(parentId)
      if (snapOrigin && nowOrigin) {
        restoredTableIds.add(n.id)
        return {
          ...n,
          position: {
            x: snap.position.x + snapOrigin.x - nowOrigin.x,
            y: snap.position.y + snapOrigin.y - nowOrigin.y,
          },
        }
      }
      return n
    }

    // Edited since, or never moved by the layout. A member of a restored area
    // keeps its absolute position.
    const before = n.parentId ? originBefore.get(n.parentId) : undefined
    const after = n.parentId ? originAfter.get(n.parentId) : undefined
    if (before && after && (before.x !== after.x || before.y !== after.y)) {
      return {
        ...n,
        position: {
          x: n.position.x + before.x - after.x,
          y: n.position.y + before.y - after.y,
        },
      }
    }
    return n
  })

  return { nodes, restoredAreaIds, restoredTableIds }
}

/**
 * Table nodes with ABSOLUTE positions (edge routing speaks absolute
 * coordinates; the store holds members relative to their area).
 */
export function toAbsoluteTableNodes(
  nodes: ReadonlyArray<Node>,
): Array<TableNodeType> {
  const areaOrigin = new Map(
    nodes.filter((n) => n.type === 'area').map((n) => [n.id, n.position]),
  )
  return nodes
    .filter((n) => n.type === 'table' || n.type === 'externalTable')
    .map((n) => {
      const origin = n.parentId ? areaOrigin.get(n.parentId) : undefined
      return (origin
        ? {
            ...n,
            position: {
              x: n.position.x + origin.x,
              y: n.position.y + origin.y,
            },
          }
        : n) as unknown as TableNodeType
    })
}

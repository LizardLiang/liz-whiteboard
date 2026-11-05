// src/lib/auto-layout/to-store-nodes.ts
// Turns an Auto Layout result (absolute table positions + new area bounds)
// into React Flow store nodes.
//
// React Flow paints a child at parent.position + child.position, so a member
// table's store position is RELATIVE to its area's origin. The layout speaks
// ABSOLUTE coordinates. This helper is the one place that converts; the
// orchestrator (use-auto-layout-orchestrator.ts) is its only caller.

import type { AreaNodeType } from '@/lib/react-flow/types'
import type { AreaBounds } from '@/data/schema'
import { buildParentIndex, toRelative } from '@/lib/react-flow/node-nesting'

export interface ToStoreNodesPosition {
  id: string
  x: number
  y: number
}

export type ToStoreNodesAreaBounds = AreaBounds

export interface ToStoreNodesMembership {
  id: string
  memberTableIds: ReadonlyArray<string>
}

type StoreNode = {
  id: string
  type?: string
  position: { x: number; y: number }
}

/**
 * @param nodes - current store nodes (member positions relative)
 * @param positions - absolute positions for the tables the layout moved
 * @param areaBounds - new bounds for the areas the layout resized
 * @param areas - area membership; an area's origin is its new bounds when it
 *   has some, else the position of its node in `nodes`
 * @returns new nodes: areas resized and moved, moved members relative to the
 *   origin of their area in this same result
 */
export function toStoreNodes<TNode extends StoreNode>(
  nodes: ReadonlyArray<TNode>,
  positions: ReadonlyArray<ToStoreNodesPosition>,
  areaBounds: ReadonlyArray<ToStoreNodesAreaBounds>,
  areas: ReadonlyArray<ToStoreNodesMembership>,
): Array<TNode> {
  const boundsById = new Map(areaBounds.map((b) => [b.id, b]))
  const positionById = new Map(positions.map((p) => [p.id, p]))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const parentIndex = buildParentIndex(
    areas.flatMap((a) => {
      const b = boundsById.get(a.id)
      const node = nodeById.get(a.id)
      const origin = b
        ? { positionX: b.positionX, positionY: b.positionY }
        : node?.type === 'area'
          ? { positionX: node.position.x, positionY: node.position.y }
          : null
      return origin
        ? [{ id: a.id, ...origin, memberTableIds: a.memberTableIds }]
        : []
    }),
  )

  return nodes.map((n) => {
    if (n.type === 'area') {
      const b = boundsById.get(n.id)
      if (!b) return n
      const areaNode = n as unknown as AreaNodeType
      return {
        ...areaNode,
        position: { x: b.positionX, y: b.positionY },
        width: b.width,
        height: b.height,
        data: {
          ...areaNode.data,
          area: {
            ...areaNode.data.area,
            positionX: b.positionX,
            positionY: b.positionY,
            width: b.width,
            height: b.height,
          },
        },
      } as unknown as TNode
    }
    const p = positionById.get(n.id)
    if (!p) return n
    const parent = parentIndex.get(n.id)
    return { ...n, position: toRelative({ x: p.x, y: p.y }, parent) }
  })
}

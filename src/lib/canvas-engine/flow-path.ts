// src/lib/canvas-engine/flow-path.ts
// Which elements and connectors lie on the flow through one element.
//
// Pure: no DOM, no clock. The renderer reads the result to light a path and to
// place flow dots; it never reads connector geometry from here beyond a point
// along an already-built polyline.

import { endpointElementId } from './scene'
import type { Point } from './camera'
import type { Scene } from './scene'

export interface FlowPath {
  /** The start element plus every element reached up or down stream. */
  elements: Set<string>
  /** Every connector walked, including ones with a free far end. */
  connectors: Set<string>
}

/**
 * Walk downstream (source to target) and upstream (target to source) from
 * `elementId` over attached connector ends.
 *
 * A branch's sibling is not on the path: from B in `A -> B -> C` and
 * `A -> D`, the path is A, B, C. A connector with a free far end is included
 * but leads nowhere. A cycle ends at the first element seen twice. An id that
 * is missing or names a connector gives an empty path.
 */
export function flowPath(scene: Scene, elementId: string): FlowPath {
  const start = scene.byId.get(elementId)
  if (!start || start.connector)
    return { elements: new Set(), connectors: new Set() }

  const outgoing = new Map<string, Array<{ id: string; far: string | null }>>()
  const incoming = new Map<string, Array<{ id: string; far: string | null }>>()
  for (const element of scene.elements) {
    const link = element.connector
    if (!link) continue
    const from = endpointElementId(link.source)
    const to = endpointElementId(link.target)
    if (from !== null) {
      const list = outgoing.get(from) ?? []
      list.push({ id: element.id, far: to })
      outgoing.set(from, list)
    }
    if (to !== null) {
      const list = incoming.get(to) ?? []
      list.push({ id: element.id, far: from })
      incoming.set(to, list)
    }
  }

  const elements = new Set<string>([elementId])
  const connectors = new Set<string>()
  const walk = (
    adjacency: Map<string, Array<{ id: string; far: string | null }>>,
  ) => {
    const seen = new Set<string>([elementId])
    const queue = [elementId]
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const edge of adjacency.get(current) ?? []) {
        connectors.add(edge.id)
        if (edge.far === null || seen.has(edge.far)) continue
        if (!scene.byId.has(edge.far)) continue
        seen.add(edge.far)
        elements.add(edge.far)
        queue.push(edge.far)
      }
    }
  }
  walk(outgoing)
  walk(incoming)
  return { elements, connectors }
}

/**
 * The point `t` (0 to 1) of the way along a polyline, by length. Null for a
 * path with fewer than two points or no length.
 */
export function pointAlongPath(
  path: ReadonlyArray<Point>,
  t: number,
): Point | null {
  if (path.length < 2) return null
  let total = 0
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(
      path[index].x - path[index - 1].x,
      path[index].y - path[index - 1].y,
    )
  }
  if (total <= 0) return null
  let remaining = Math.max(0, Math.min(1, t)) * total
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]
    const b = path[index]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (remaining <= length && length > 0) {
      const ratio = remaining / length
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
    }
    remaining -= length
  }
  return { ...path[path.length - 1] }
}

// src/lib/auto-layout/area-aware-layout.ts
// Area-aware auto layout: each area is one block. Member tables are arranged
// inside it, the area is sized to fit them, then the block is placed together
// with the ungrouped tables. Membership is never read back out or changed:
// the output carries no `memberTableIds`.
//
// Pure module: no React or DOM imports, so the server can use it too.

import { computeD3ForceLayout } from './d3-force-layout'
import type {
  LayoutInputEdge,
  LayoutInputNode,
  LayoutOutputPosition,
} from './d3-force-layout'
import { buildParentIndex } from '@/lib/react-flow/node-nesting'
import { MIN_AREA_HEIGHT, MIN_AREA_WIDTH } from '@/lib/react-flow/types'

export const AREA_PAD_X = 24
export const AREA_PAD_TOP = 44
export const AREA_PAD_BOTTOM = 24

export interface AreaLayoutInputArea {
  id: string
  positionX: number
  positionY: number
  width: number
  height: number
  memberTableIds: ReadonlyArray<string>
}

export interface AreaLayoutInput {
  tables: Array<LayoutInputNode>
  edges: Array<LayoutInputEdge>
  areas: ReadonlyArray<AreaLayoutInputArea>
}

export interface AreaLayoutOutputArea {
  id: string
  positionX: number
  positionY: number
  width: number
  height: number
}

export interface AreaLayoutOutput {
  /** Absolute top-left per table. */
  tables: Array<LayoutOutputPosition>
  areas: Array<AreaLayoutOutputArea>
}

const AREA_NODE_PREFIX = 'area:'

interface AreaBlock {
  width: number
  height: number
  /** Member positions relative to the area's top-left. */
  members: Array<LayoutOutputPosition>
}

async function buildAreaBlock(
  area: AreaLayoutInputArea,
  memberNodes: Array<LayoutInputNode>,
  edges: Array<LayoutInputEdge>,
): Promise<AreaBlock> {
  if (memberNodes.length === 0) {
    return { width: area.width, height: area.height, members: [] }
  }
  const memberIds = new Set(memberNodes.map((n) => n.id))
  const inner = await computeD3ForceLayout(
    memberNodes,
    edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target)),
  )
  const sizeById = new Map(memberNodes.map((n) => [n.id, n]))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of inner) {
    const n = sizeById.get(p.id)!
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + n.width)
    maxY = Math.max(maxY, p.y + n.height)
  }
  return {
    width: Math.max(MIN_AREA_WIDTH, maxX - minX + AREA_PAD_X * 2),
    height: Math.max(
      MIN_AREA_HEIGHT,
      maxY - minY + AREA_PAD_TOP + AREA_PAD_BOTTOM,
    ),
    members: inner.map((p) => ({
      id: p.id,
      x: p.x - minX + AREA_PAD_X,
      y: p.y - minY + AREA_PAD_TOP,
    })),
  }
}

export async function computeAreaAwareLayout(
  input: AreaLayoutInput,
): Promise<AreaLayoutOutput> {
  const { tables, edges, areas } = input
  if (areas.length === 0) {
    return { tables: await computeD3ForceLayout(tables, edges), areas: [] }
  }

  // First-wins ownership, identical to what the canvas renders.
  const owner = buildParentIndex(areas)
  const tableById = new Map(tables.map((t) => [t.id, t]))
  const membersByArea = new Map<string, Array<LayoutInputNode>>(
    areas.map((a) => [a.id, []]),
  )
  const ungrouped: Array<LayoutInputNode> = []
  for (const t of tables) {
    const parent = owner.get(t.id)
    if (parent) membersByArea.get(parent.id)!.push(t)
    else ungrouped.push(t)
  }

  const blocks = new Map<string, AreaBlock>()
  for (const area of areas) {
    blocks.set(
      area.id,
      await buildAreaBlock(area, membersByArea.get(area.id)!, edges),
    )
  }

  // Outer pass: ungrouped tables + one pseudo-node per area.
  const endpoint = (id: string): { id: string; remapped: boolean } => {
    const parent = owner.get(id)
    return parent
      ? { id: AREA_NODE_PREFIX + parent.id, remapped: true }
      : { id, remapped: false }
  }
  const outerNodes: Array<LayoutInputNode> = [
    ...ungrouped,
    ...areas.map((a) => {
      const b = blocks.get(a.id)!
      return { id: AREA_NODE_PREFIX + a.id, width: b.width, height: b.height }
    }),
  ]
  const outerEdges: Array<LayoutInputEdge> = []
  const seen = new Set<string>()
  for (const e of edges) {
    if (!tableById.has(e.source) || !tableById.has(e.target)) continue
    const s = endpoint(e.source)
    const t = endpoint(e.target)
    if (s.id === t.id) continue
    const key = s.id + '\n' + t.id
    if ((s.remapped || t.remapped) && seen.has(key)) continue
    seen.add(key)
    const { sourceRow, targetRow, ...rest } = e
    outerEdges.push({
      ...rest,
      source: s.id,
      target: t.id,
      ...(s.remapped || sourceRow === undefined ? {} : { sourceRow }),
      ...(t.remapped || targetRow === undefined ? {} : { targetRow }),
    })
  }

  const outer = await computeD3ForceLayout(outerNodes, outerEdges)
  const outerById = new Map(outer.map((p) => [p.id, p]))

  const outTables: Array<LayoutOutputPosition> = []
  const outAreas: Array<AreaLayoutOutputArea> = []
  for (const t of ungrouped) {
    const p = outerById.get(t.id)!
    outTables.push({ id: t.id, x: p.x, y: p.y })
  }
  for (const area of areas) {
    const block = blocks.get(area.id)!
    const p = outerById.get(AREA_NODE_PREFIX + area.id)!
    outAreas.push({
      id: area.id,
      positionX: p.x,
      positionY: p.y,
      width: block.width,
      height: block.height,
    })
    for (const m of block.members) {
      outTables.push({ id: m.id, x: p.x + m.x, y: p.y + m.y })
    }
  }
  return { tables: outTables, areas: outAreas }
}

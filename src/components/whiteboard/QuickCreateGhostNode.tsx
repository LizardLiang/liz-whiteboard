// src/components/whiteboard/QuickCreateGhostNode.tsx
// The ghost outline shown while a quick-create arrow is hovered: a preview
// of the shape a click would create, drawn at the position
// `quickCreatePlacement` actually resolves — so a collision slide is
// visible BEFORE committing rather than surprising the user afterwards.
//
// Rendered as its own React Flow node (type `quickCreateGhost`) rather than
// inside the source shape's subtree, because the preview sits at the
// TARGET position, which is outside the source node's bounds. It carries no
// interactivity at all: the parent builds it unselectable, undraggable,
// undeletable and unfocusable, and `.figjam-ghost` sets
// `pointer-events: none` so it can never intercept the very arrow click it
// is previewing.
//
// All styling lives in `.figjam-ghost` (src/styles/react-flow-theme.css),
// which is theme-tokenised via --rf-ghost-border / --rf-ghost-bg.

import type { Node, NodeProps } from '@xyflow/react'

/**
 * Fixed id for the single ghost node. There is only ever one — the pointer
 * can hover exactly one arrow at a time — so a stable id lets the parent
 * replace it by rebuilding the node array without accumulating orphans.
 */
export const QUICK_CREATE_GHOST_ID = '__quick-create-ghost__'

export interface QuickCreateGhostNodeData extends Record<string, unknown> {
  width: number
  height: number
}

export type QuickCreateGhostNodeType = Node<
  QuickCreateGhostNodeData,
  'quickCreateGhost'
>

export function QuickCreateGhostNode({
  data,
  width,
  height,
}: NodeProps<QuickCreateGhostNodeType>) {
  // Prefer React Flow's measured box, falling back to the data the parent
  // supplied — the same measured-with-fallback rule the shape geometry
  // helpers use, so the ghost is never sized from `undefined` on its first
  // frame.
  const w = width ?? data.width
  const h = height ?? data.height

  return (
    <div
      className="figjam-ghost"
      aria-hidden
      style={{ width: w, height: h, inset: 0 }}
    />
  )
}

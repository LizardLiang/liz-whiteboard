// src/lib/react-flow/tool-mode.ts
// The canvas-wide draw-tool enum (D-1). `commentToolActive` (a boolean that
// used to live in ReactFlowWhiteboard.tsx) migrates into this enum — two
// parallel mode mechanisms could both be "active" at once with nothing
// defining what that meant. Pure, no React import — unit-tested standalone.

import type { ShapeKind } from '@/data/schema'

/**
 * The canvas's single tool-mode state. `'select'` is the default/rest state
 * every tool auto-reverts to after one use. `'comment'` is the pre-existing
 * click-to-place tool (unchanged observable behaviour, D-1) merged into this
 * enum. The five draw tools rubber-band a shape on drag (D-2).
 */
export type ToolMode =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'text'
  | 'comment'

/** The five drag-to-draw tools — everything in ToolMode except select/comment. */
export const DRAW_TOOLS = [
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'text',
] as const

export type DrawTool = (typeof DRAW_TOOLS)[number]

/** True for exactly the five draw tools — false for 'select' and 'comment'. */
export function isDrawTool(t: ToolMode): t is DrawTool {
  return (DRAW_TOOLS as ReadonlyArray<ToolMode>).includes(t)
}

/**
 * Maps a draw tool to the `Shape.kind` it creates. Deliberately NOT a 1:1
 * name match: the tool is `arrow` (D-1's enum, matching the palette icon),
 * the shape kind is `line` (tech-spec §3 — a line/arrow shape with optional
 * arrowheads via `props.arrowStart`/`arrowEnd`). Keep the two names distinct.
 */
export const TOOL_TO_SHAPE_KIND: Record<DrawTool, ShapeKind> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  diamond: 'diamond',
  arrow: 'line',
  text: 'text',
}

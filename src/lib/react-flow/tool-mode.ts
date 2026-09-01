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
  | 'area'

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
 * Every tool driven by the same rubber-band drag gesture — the five shape
 * draw tools PLUS `'area'` (todo #55 item 2: draw an area around existing
 * tables). `'area'` is deliberately NOT a member of `DRAW_TOOLS`: that list
 * is the domain of `TOOL_TO_SHAPE_KIND` and every consumer of it creates a
 * `Shape`, while an area creates an `Area` row on a different table with its
 * own membership semantics. They share only the pointer gesture, so the
 * gesture — not the shape enum — is what widens.
 */
export type DrawGestureTool = DrawTool | 'area'

/** True for the five shape draw tools and for `'area'` — i.e. every tool the
 *  ShapeDrawOverlay's rubber-band gesture serves. */
export function isDrawGestureTool(t: ToolMode): t is DrawGestureTool {
  return t === 'area' || isDrawTool(t)
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

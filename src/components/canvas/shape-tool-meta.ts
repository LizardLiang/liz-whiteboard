// src/components/canvas/shape-tool-meta.ts
// Icon per shape kind (names live in the `canvas.shape.*` dictionary keys), single-sourced (canvas-cmd-k-search-panel
// tactical plan, step 2) so the tool palette (CanvasBoard.tsx) and the search
// results list (CanvasSearch.tsx) can never show two different icons for the
// same kind.
//
// Split out of CanvasBoard.tsx specifically because CanvasBoard renders
// `<CanvasSearch>` — CanvasSearch importing `SHAPE_TOOL_META` FROM
// CanvasBoard would be a straight import cycle. This tiny leaf, imported by
// both, breaks it.

import { Circle, Diamond, Square, Triangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CanvasShapeKind } from '@/lib/canvas-engine/scene'

/**
 * The icon for each shape kind. The human name is `canvas.shape.<kind>`; the
 * keyboard SHORTCUT is
 * deliberately not here — that comes from `SHAPE_TOOL_SHORTCUTS`
 * (use-canvas-input.ts), which is what the keydown handler actually binds, so
 * a button can never advertise a key the board ignores.
 */
export const SHAPE_TOOL_META: Readonly<
  Record<CanvasShapeKind, { Icon: LucideIcon }>
> = {
  rectangle: { Icon: Square },
  ellipse: { Icon: Circle },
  diamond: { Icon: Diamond },
  triangle: { Icon: Triangle },
}

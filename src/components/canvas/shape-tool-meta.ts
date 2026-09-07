// src/components/canvas/shape-tool-meta.ts
// Icon + human label per shape kind, single-sourced (canvas-cmd-k-search-panel
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
 * The icon and the human name for each shape kind. The keyboard SHORTCUT is
 * deliberately not here — that comes from `SHAPE_TOOL_SHORTCUTS`
 * (use-canvas-input.ts), which is what the keydown handler actually binds, so
 * a button can never advertise a key the board ignores.
 */
export const SHAPE_TOOL_META: Readonly<
  Record<CanvasShapeKind, { label: string; Icon: LucideIcon }>
> = {
  rectangle: { label: 'Rectangle', Icon: Square },
  ellipse: { label: 'Ellipse', Icon: Circle },
  diamond: { label: 'Diamond', Icon: Diamond },
  triangle: { label: 'Triangle', Icon: Triangle },
}

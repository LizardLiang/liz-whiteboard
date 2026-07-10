// src/lib/react-flow/canvas-mode.ts
// CanvasModeContext — mirrors ForceFullDetailContext (level-of-detail.ts):
// a plain boolean context, not node data, so TableNode's custom memo
// comparator (see TableNode.tsx's second `memo` argument) does not need a
// new field to key on. Provided from ReactFlowCanvas.tsx using the
// already-computed `canvasMode` flag (`?canvas=1` on the main board, via
// `enableEdgeAblation`).
//
// While true, TableNode renders its chrome-light form (sized wrapper +
// per-column ColumnHandles only, no header text/buttons/ColumnRow bodies —
// see the "DOM strip to handles-only anchors" spec-delta requirement) and
// CanvasNodeLayer paints the table's visuals on <canvas> instead.
import { createContext, useContext } from 'react'

export const CanvasModeContext = createContext(false)

export function useCanvasMode(): boolean {
  return useContext(CanvasModeContext)
}

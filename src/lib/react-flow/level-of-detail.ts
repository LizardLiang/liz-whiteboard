/**
 * Level-of-detail (LOD) support for the React Flow canvas (GH #121 perf).
 *
 * Below LOD_ZOOM_THRESHOLD, TableNode renders a handles-only row per column
 * instead of the full interactive ColumnRow (columns are still mapped so
 * edge anchors survive) — cuts DOM weight dramatically when zoomed out on a
 * dense board. Tunable; set during profiling.
 *
 * Image export (export-image.ts) rasterizes the LIVE `.react-flow__viewport`
 * DOM rather than doing a fresh render, so if the user is zoomed out below
 * the threshold when they click "Export", the exported image would
 * otherwise capture collapsed name-only tables. ForceFullDetailContext lets
 * the export flow (ReactFlowWhiteboard.tsx) force every TableNode back to
 * full detail for the duration of the capture, regardless of current zoom.
 */
import { createContext, useContext } from 'react'

/** Zoom level below which TableNode collapses to a name-only block. */
export const LOD_ZOOM_THRESHOLD = 0.35

/**
 * True while an image export is capturing the canvas — forces every
 * TableNode to render full detail regardless of the current zoom. Defaults
 * to false (normal LOD behavior) for any consumer outside the export flow's
 * provider (e.g. TableFocusOverlay's own nested canvas).
 */
export const ForceFullDetailContext = createContext(false)

export function useForceFullDetail(): boolean {
  return useContext(ForceFullDetailContext)
}

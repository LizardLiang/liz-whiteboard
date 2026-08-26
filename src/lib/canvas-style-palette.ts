// src/lib/canvas-style-palette.ts
// The fixed swatch palette the canvas style toolbar offers.
//
// SEPARATE FROM `area-colors.ts`, deliberately, despite covering the same
// eight hues. The two boards store colour differently and that difference is
// not cosmetic: an Area persists a palette *id* ("blue") and resolves it at
// draw time, while a canvas element persists the CONCRETE CSS string
// (`canvasElementStyleSchema`'s `cssColorSchema`) because the engine hands it
// straight to `ctx.fillStyle`. Reusing `AREA_COLORS` here would mean writing
// an Area's translucency and tone into canvas rows, quietly restyling every
// board the first time anyone touched a swatch.
//
// The hue NAMES match `area-colors.ts` on purpose, so the two board kinds read
// as one product; the VALUES are the canvas's own.
//
// Pure data module — no imports, no side effects — so the schema layer and
// React components can both use it, exactly as `area-colors.ts` documents for
// itself.

export interface CanvasSwatch {
  /** Stable id. Not persisted — the concrete strings below are. */
  id: string
  /** Human-readable label for the picker and its aria-label. */
  label: string
  /** The `style.fill` value written for this swatch. */
  fill: string
  /** The `style.stroke` value written for this swatch. */
  stroke: string
}

/**
 * The eight swatches, in picker order.
 *
 * `blue` is FIRST-CLASS here rather than merely present: its two values are
 * byte-for-byte the engine's own `DEFAULT_ELEMENT_STYLE`, which is what makes
 * a never-styled shape show blue as its active swatch instead of showing no
 * selection at all. `canvas-style-palette.test.ts` pins that equality — the
 * engine cannot import this module (it imports nothing, by design), so a test
 * is the only place the two can be held together.
 */
export const CANVAS_SWATCHES: ReadonlyArray<CanvasSwatch> = [
  { id: 'slate', label: 'Slate', fill: 'rgba(100, 116, 139, 0.10)', stroke: '#64748b' },
  { id: 'red', label: 'Red', fill: 'rgba(239, 68, 68, 0.10)', stroke: '#ef4444' },
  { id: 'orange', label: 'Orange', fill: 'rgba(249, 115, 22, 0.10)', stroke: '#f97316' },
  { id: 'amber', label: 'Amber', fill: 'rgba(245, 158, 11, 0.10)', stroke: '#f59e0b' },
  { id: 'green', label: 'Green', fill: 'rgba(34, 197, 94, 0.10)', stroke: '#22c55e' },
  { id: 'teal', label: 'Teal', fill: 'rgba(20, 184, 166, 0.10)', stroke: '#14b8a6' },
  { id: 'blue', label: 'Blue', fill: 'rgba(59, 130, 246, 0.10)', stroke: '#3b82f6' },
  { id: 'violet', label: 'Violet', fill: 'rgba(139, 92, 246, 0.10)', stroke: '#8b5cf6' },
]

/**
 * The "no paint" choice, which each of fill and stroke expresses differently.
 *
 * A fill is removed by the string `'none'` — the renderer tests for it by
 * name. A stroke is removed by a zero WIDTH, because there is no colour that
 * means "do not draw a line"; `drawShape` skips the stroke entirely at
 * `strokeWidth: 0`. Two different mechanisms, one user-facing idea, so the
 * toolbar presents them identically and this constant is where that
 * asymmetry is written down.
 */
export const FILL_NONE = 'none'

/**
 * The stroke width restored when a stroke is turned back ON after being
 * cleared. It matches `DEFAULT_ELEMENT_STYLE.strokeWidth`, so re-enabling an
 * outline gives back the one the shape was drawn with rather than a hairline.
 */
export const DEFAULT_STROKE_WIDTH = 2

/**
 * The swatch whose `fill` matches this stored value, or null.
 *
 * Exact string comparison, not colour parsing. The only values that ever
 * reach here were written by this palette or by the engine's default, so a
 * parser would add a way to be wrong for no reachable benefit — and a value
 * from neither source (an older row, a hand-edited one) correctly reports
 * "no swatch is active" rather than snapping to the nearest one.
 */
export function swatchForFill(fill: string): CanvasSwatch | null {
  return CANVAS_SWATCHES.find((swatch) => swatch.fill === fill) ?? null
}

/** The swatch whose `stroke` matches this stored value, or null. Same rule as `swatchForFill`. */
export function swatchForStroke(stroke: string): CanvasSwatch | null {
  return CANVAS_SWATCHES.find((swatch) => swatch.stroke === stroke) ?? null
}

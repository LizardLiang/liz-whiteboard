// src/lib/canvas-style-palette.ts
// The fixed swatch palette the canvas style toolbar offers.
//
// SEPARATE FROM `area-colors.ts`, deliberately, despite covering similar
// hues. The two boards store colour differently and that difference is
// not cosmetic: an Area persists a palette *id* ("blue") and resolves it at
// draw time, while a canvas element persists the CONCRETE CSS string
// (`canvasElementStyleSchema`'s `cssColorSchema`) because the engine hands it
// straight to `ctx.fillStyle`. Reusing `AREA_COLORS` here would mean writing
// an Area's translucency and tone into canvas rows, quietly restyling every
// board the first time anyone touched a swatch.
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

const PRESET_DEFINITIONS: ReadonlyArray<{
  id: string
  label: string
  value: string
}> = [
  { id: 'blue', label: 'Blue', value: '#0090ff' },
  { id: 'indigo', label: 'Indigo', value: '#3e63dd' },
  { id: 'violet', label: 'Violet', value: '#6e56cf' },
  { id: 'plum', label: 'Plum', value: '#ab4aba' },
  { id: 'pink', label: 'Pink', value: '#d6409f' },
  { id: 'tomato', label: 'Tomato', value: '#e54d2e' },
  { id: 'orange', label: 'Orange', value: '#f76b15' },
  { id: 'green', label: 'Green', value: '#30a46c' },
  { id: 'teal', label: 'Teal', value: '#12a594' },
  { id: 'cyan', label: 'Cyan', value: '#00a2c7' },
  { id: 'slate', label: 'Slate', value: '#696e77' },
]

/**
 * The eleven preset swatches, in picker order. Fill and stroke store the same
 * solid string (the hue's Radix dark step 9); the card style derives the body,
 * border and text ramp from it at draw time.
 *
 * The values are restated from `canvas-engine/colour-ramps.ts` because this
 * module imports nothing. `canvas-style-palette.test.ts` pins the two lists
 * equal.
 */
export const CANVAS_SWATCHES: ReadonlyArray<CanvasSwatch> =
  PRESET_DEFINITIONS.map(({ id, label, value }) => ({
    id,
    label,
    fill: value,
    stroke: value,
  }))

/**
 * The stored fill and stroke of a never-coloured shape. They equal
 * `DEFAULT_ELEMENT_STYLE` (pinned by test) and read as the Slate swatch,
 * because the card style paints them with the slate ramp.
 */
const DEFAULT_FILL = 'rgba(59, 130, 246, 0.10)'
const DEFAULT_STROKE = '#3b82f6'
const SLATE_ID = 'slate'

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
 * The stroke widths the toolbar offers.
 *
 * The SAME three the ER whiteboard offers (`SHAPE_STROKE_WIDTHS` in
 * schema.ts), restated here rather than imported so this module keeps the
 * no-imports property its header claims — importing the schema would pull Zod
 * into a module the engine-adjacent code reads. `canvas-style-palette.test.ts`
 * asserts the two lists are identical, the same drift guard the blue swatch
 * gets against `DEFAULT_ELEMENT_STYLE`.
 *
 * A fixed set, not a free number, even though `canvasElementStyleSchema`
 * accepts anything in 0..64: three named weights are a choice a user can make
 * at a glance, and a stored width outside the set still renders correctly and
 * simply shows no active button.
 *
 * ZERO IS NOT HERE. "No stroke" is the stroke row's own none button — one
 * user-facing idea belongs to one control, and a second zero in this row
 * would be two ways to express the same state sitting side by side.
 */
export const CANVAS_STROKE_WIDTHS: ReadonlyArray<number> = [1, 2, 4]

/**
 * The corner radii the toolbar offers, in WORLD units.
 *
 * A fixed set for the same reason `CANVAS_STROKE_WIDTHS` is one: three named
 * shapes are a choice a user makes at a glance, where a slider is a value
 * they have to fiddle with. A stored radius outside the set still draws
 * correctly and simply shows no active button.
 *
 * ZERO IS HERE, unlike in the stroke row. "No rounding" is not a separate
 * idea with its own mechanism — it is a radius of zero, the same field at one
 * end of its range — so it belongs in the row rather than in a none button
 * beside it.
 */
export const CANVAS_CORNER_RADII: ReadonlyArray<number> = [0, 8, 20]

/**
 * The label font sizes the toolbar offers, smallest first.
 *
 * Four named steps rather than a free number, for the same reason as the rows
 * above. 16 (M) is `DEFAULT_ELEMENT_STYLE.fontSize`, so a never-styled label
 * shows M as active; `canvas-style-palette.test.ts` pins that.
 */
export const CANVAS_FONT_SIZES: ReadonlyArray<{ size: number; label: string }> =
  [
    { size: 12, label: 'S' },
    { size: 16, label: 'M' },
    { size: 24, label: 'L' },
    { size: 36, label: 'XL' },
  ]

/**
 * The `style.color` value of the "Default" text colour. It equals
 * `DEFAULT_ELEMENT_STYLE.color`, which the renderer resolves per theme, so
 * Default stays legible in light and dark mode. Pinned by
 * `canvas-style-palette.test.ts`.
 */
export const DEFAULT_TEXT_COLOR = '#0f172a'

/**
 * The text colours the toolbar offers: Default, then the eleven presets.
 */
export const CANVAS_TEXT_COLORS: ReadonlyArray<{
  label: string
  value: string
}> = [
  { label: 'Default', value: DEFAULT_TEXT_COLOR },
  ...CANVAS_SWATCHES.map((swatch) => ({
    label: swatch.label,
    value: swatch.stroke,
  })),
]

/**
 * The fill strings the pre-preset swatch row wrote, mapped to the preset they
 * paint as. The card style draws them with that preset's ramp, so the toolbar
 * shows the preset as active instead of Custom. Restated from `LEGACY_FILLS`
 * in `canvas-engine/colour-ramps.ts` because this module imports nothing;
 * `canvas-style-palette.test.ts` pins the two equal.
 */
const LEGACY_FILL_PRESETS: ReadonlyMap<string, string> = new Map([
  ['rgba(100, 116, 139, 0.10)', 'slate'],
  ['rgba(239, 68, 68, 0.10)', 'tomato'],
  ['rgba(249, 115, 22, 0.10)', 'orange'],
  ['rgba(245, 158, 11, 0.10)', 'orange'],
  ['rgba(34, 197, 94, 0.10)', 'green'],
  ['rgba(20, 184, 166, 0.10)', 'teal'],
  ['rgba(139, 92, 246, 0.10)', 'violet'],
  [DEFAULT_FILL, SLATE_ID],
])

/**
 * The stroke strings the pre-preset swatch row wrote, mapped like
 * `LEGACY_FILL_PRESETS`. Under the card style a connector draws a legacy stroke
 * in the mapped preset colour, so the active swatch matches. A shape border
 * follows the shape's fill ramp, not its stroke.
 */
const LEGACY_STROKE_PRESETS: ReadonlyMap<string, string> = new Map([
  ['#64748b', 'slate'],
  ['#ef4444', 'tomato'],
  ['#f97316', 'orange'],
  ['#f59e0b', 'orange'],
  ['#22c55e', 'green'],
  ['#14b8a6', 'teal'],
  ['#8b5cf6', 'violet'],
  [DEFAULT_STROKE, SLATE_ID],
])

/**
 * The swatch whose `fill` matches this stored value, or null.
 *
 * Exact string comparison, not colour parsing: a custom colour correctly
 * reports "no swatch is active" rather than snapping to the nearest one. The
 * exceptions are the legacy swatch fills and the never-coloured default, which
 * paint as a preset and so report that preset.
 */
export function swatchForFill(fill: string): CanvasSwatch | null {
  return findSwatch(LEGACY_FILL_PRESETS.get(fill), fill, 'fill')
}

/** The swatch whose `stroke` matches this stored value, or null. Same rule as `swatchForFill`. */
export function swatchForStroke(stroke: string): CanvasSwatch | null {
  return findSwatch(LEGACY_STROKE_PRESETS.get(stroke), stroke, 'stroke')
}

function findSwatch(
  legacyId: string | undefined,
  value: string,
  key: 'fill' | 'stroke',
): CanvasSwatch | null {
  if (legacyId) return CANVAS_SWATCHES.find((s) => s.id === legacyId) ?? null
  return CANVAS_SWATCHES.find((swatch) => swatch[key] === value) ?? null
}

// src/lib/area-colors.ts
// Fixed curated palette for subject areas (GH #106).
//
// Areas persist only the palette *id* (e.g. "blue") in the DB; the canvas and
// image export resolve that id to concrete visual values here so colors stay
// consistent across the whiteboard and in exports. This is a pure data module
// (no imports, no side effects) so it is safe to import from both the Zod
// schema layer (src/data/schema.ts) and React components.

export interface AreaColor {
  /** Stable palette id — the value stored in Area.color */
  id: string
  /** Human-readable label for the swatch picker */
  label: string
  /** Solid accent used for the area label text and header */
  solid: string
  /** Translucent region fill (rgba) drawn behind tables */
  fill: string
  /** Region border color */
  border: string
}

export const AREA_COLORS: ReadonlyArray<AreaColor> = [
  {
    id: 'slate',
    label: 'Slate',
    solid: '#475569',
    fill: 'rgba(100, 116, 139, 0.12)',
    border: 'rgba(100, 116, 139, 0.55)',
  },
  {
    id: 'red',
    label: 'Red',
    solid: '#dc2626',
    fill: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.55)',
  },
  {
    id: 'orange',
    label: 'Orange',
    solid: '#ea580c',
    fill: 'rgba(249, 115, 22, 0.12)',
    border: 'rgba(249, 115, 22, 0.55)',
  },
  {
    id: 'amber',
    label: 'Amber',
    solid: '#b45309',
    fill: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.55)',
  },
  {
    id: 'green',
    label: 'Green',
    solid: '#16a34a',
    fill: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.55)',
  },
  {
    id: 'teal',
    label: 'Teal',
    solid: '#0d9488',
    fill: 'rgba(20, 184, 166, 0.12)',
    border: 'rgba(20, 184, 166, 0.55)',
  },
  {
    id: 'blue',
    label: 'Blue',
    solid: '#2563eb',
    fill: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.55)',
  },
  {
    id: 'violet',
    label: 'Violet',
    solid: '#7c3aed',
    fill: 'rgba(139, 92, 246, 0.12)',
    border: 'rgba(139, 92, 246, 0.55)',
  },
]

/** Palette ids as a non-empty tuple for `z.enum`. */
export const AREA_COLOR_IDS = AREA_COLORS.map((c) => c.id) as [
  string,
  ...Array<string>,
]

/** Default color assigned to a newly created area. */
export const DEFAULT_AREA_COLOR = AREA_COLORS[0].id

const AREA_COLOR_MAP = new Map(AREA_COLORS.map((c) => [c.id, c]))

/** Resolve a stored palette id to its visual values, falling back to the first. */
export function resolveAreaColor(id: string): AreaColor {
  return AREA_COLOR_MAP.get(id) ?? AREA_COLORS[0]
}

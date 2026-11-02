// src/data/canvas-board-settings.ts
// Board-level canvas settings stored in the "CanvasBoard"."settings" JSON
// column. Kept free of engine and database imports so both `db.ts` (row
// mapping) and `schema.ts` (re-export) can depend on it without a cycle.

import { z } from 'zod'

/** How the engine paints shapes: modern cards, or the pre-card look. */
export const DIAGRAM_STYLES = ['card', 'classic'] as const
/** When flow dots run: only on the hovered/selected path, or on every connector. */
export const FLOW_DOT_MODES = ['path', 'always'] as const

export type DiagramStyle = (typeof DIAGRAM_STYLES)[number]
export type FlowDotMode = (typeof FLOW_DOT_MODES)[number]

/**
 * Every key has a `.default()`, so a row with no settings column value, an
 * empty object, or a partial object parses to a complete settings value.
 */
export const canvasBoardSettingsSchema = z.strictObject({
  diagramStyle: z.enum(DIAGRAM_STYLES).default('card'),
  flowDots: z.enum(FLOW_DOT_MODES).default('path'),
})

/** A partial write: only the keys present change. */
export const canvasBoardSettingsPatchSchema = z
  .strictObject({
    diagramStyle: z.enum(DIAGRAM_STYLES).optional(),
    flowDots: z.enum(FLOW_DOT_MODES).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'A settings patch must change at least one key',
  })

export type CanvasBoardSettings = z.infer<typeof canvasBoardSettingsSchema>
export type CanvasBoardSettingsPatch = z.infer<
  typeof canvasBoardSettingsPatchSchema
>

/** Settings a board has before anyone changes them. */
export const DEFAULT_CANVAS_BOARD_SETTINGS: CanvasBoardSettings =
  canvasBoardSettingsSchema.parse({})

/**
 * Parse a stored value. Each key is checked on its own: a bad or unknown key
 * falls back to its default and never discards a valid sibling.
 */
export function parseCanvasBoardSettings(raw: unknown): CanvasBoardSettings {
  const source =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  const diagramStyle = z.enum(DIAGRAM_STYLES).safeParse(source.diagramStyle)
  const flowDots = z.enum(FLOW_DOT_MODES).safeParse(source.flowDots)
  return {
    diagramStyle: diagramStyle.success
      ? diagramStyle.data
      : DEFAULT_CANVAS_BOARD_SETTINGS.diagramStyle,
    flowDots: flowDots.success
      ? flowDots.data
      : DEFAULT_CANVAS_BOARD_SETTINGS.flowDots,
  }
}

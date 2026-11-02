// src/lib/canvas-engine/card-style.ts
// The `card` diagram style: a paint-time reading of an element's stored style.
// Nothing here is written back to a row, and nothing here moves geometry — the
// card look changes colours, a shadow, and the text frame's top row only.
//
// Pure: no DOM, no clock. `classic` never calls into this module.

import {
  DEFAULT_ELEMENT_STYLE,
  effectiveCornerRadius,
  effectiveRole,
  isCanvasShapeKind,
} from './scene'
import { applyRunStyle, normalizeRuns } from './text-runs'
import type { TextRunAttrs } from './text-runs'
import type { RenderPaint } from './render-target'
import type { CanvasElement, CanvasElementStyle } from './scene'

/** How the engine paints shapes. Mirrors the board setting of the same name. */
export type DiagramStyle = 'card' | 'classic'

/** Which palette the non-data chrome is drawn with. */
export type CanvasTheme = 'light' | 'dark'

/**
 * Everything the card look reads besides the element: the board's style and
 * the theme. Passed to layout, caret and hit-test helpers as well as to the
 * draw, so all of them agree on where the text sits.
 */
export interface CardLook {
  diagramStyle: DiagramStyle
  theme: CanvasTheme
}

export type CardRole = Exclude<ReturnType<typeof effectiveRole>, null>

interface CardTokens {
  surface: string
  border: string
  muted: string
  edge: string
  shadow: { color: string; blur: number; offsetY: number }
  roles: Record<CardRole, string>
}

/** Per-theme card colours. */
export const CARD: Record<CanvasTheme, CardTokens> = {
  dark: {
    surface: '#161a23',
    border: '#2a3141',
    muted: '#9aa3b3',
    edge: '#5c6578',
    shadow: { color: 'rgba(0, 0, 0, 0.45)', blur: 16, offsetY: 4 },
    roles: {
      trigger: '#a78bfa',
      action: '#60a5fa',
      system: '#2dd4bf',
      data: '#fbbf24',
      note: '#94a3b8',
    },
  },
  light: {
    surface: '#ffffff',
    border: '#e2e6ec',
    muted: '#5b6474',
    edge: '#9aa3b2',
    shadow: { color: 'rgba(15, 23, 42, 0.10)', blur: 14, offsetY: 4 },
    roles: {
      trigger: '#7c3aed',
      action: '#2563eb',
      system: '#0d9488',
      data: '#d97706',
      note: '#64748b',
    },
  },
}

/** Corner radius of a card rectangle, in world units. */
export const CARD_RADIUS = 14
/** Share of the stored fill mixed into the card surface. */
export const CARD_TINT = 0.14
/** Share of amber mixed into the surface for a note card. */
export const CARD_NOTE_TINT = 0.1
const NOTE_AMBER = '#f59e0b'
/** Hairline border width and the accent border width, in world units. */
export const CARD_BORDER_WIDTH = 1
export const CARD_ACCENT_BORDER_WIDTH = 1.5
/** Width of a connector drawn in the neutral card edge colour. */
export const CARD_EDGE_WIDTH = 1.75
export const NOTE_DASH = [6, 4]
/** Height reserved at the top of a card's text frame for the chip row. */
export const CARD_TOP_ROW = 22

export const CARD_ROLE_LABELS: Record<CardRole | 'none', string> = {
  trigger: '觸發',
  action: '操作',
  system: '系統',
  data: '資料',
  note: '備註',
  none: '無',
}

export function isCard(look: CardLook | undefined): look is CardLook {
  return look !== undefined && look.diagramStyle === 'card'
}

interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` into an
 * opaque RGB triple (alpha is dropped). Anything else returns null.
 */
export function parseCssColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)
  if (hex) {
    let digits = hex[1]
    if (digits.length <= 4) {
      digits = digits
        .split('')
        .map((digit) => digit + digit)
        .join('')
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    }
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(text)
  if (!fn) return null
  const parts = fn[1].split(/[\s,/]+/).filter((part) => part.length > 0)
  if (parts.length < 3 || parts.length > 4) return null
  const channels = parts.slice(0, 3).map((part) => {
    if (!/^\d+(\.\d+)?%?$/.test(part)) return Number.NaN
    return part.endsWith('%')
      ? (parseFloat(part) / 100) * 255
      : parseFloat(part)
  })
  if (channels.some((channel) => !Number.isFinite(channel))) return null
  const [r, g, b] = channels.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel))),
  )
  return { r, g, b }
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0')
}

/** `top` mixed over `base` at `amount` (0..1), as an opaque `#rrggbb`. */
export function mixColors(base: Rgb, top: Rgb, amount: number): string {
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * amount)
  return `#${hex2(channel(base.r, top.r))}${hex2(channel(base.g, top.g))}${hex2(channel(base.b, top.b))}`
}

/** The card body colour for a stored fill, or the plain surface. */
export function tintedSurface(fill: string, theme: CanvasTheme): string {
  const surface = CARD[theme].surface
  if (fill === DEFAULT_ELEMENT_STYLE.fill || fill === 'none') return surface
  const stored = parseCssColor(fill)
  const base = parseCssColor(surface)
  if (!stored || !base) return surface
  return mixColors(base, stored, CARD_TINT)
}

/** Whether the card draws a shadow under `element`. */
export function cardHasShadow(element: CanvasElement): boolean {
  const mode = element.style.cardShadow
  if (mode === 'on') return true
  if (mode === 'off') return false
  return effectiveRole(element) !== 'note'
}

/** The colour the element's role chip, accent border and path highlight use. */
export function cardAccent(element: CanvasElement, theme: CanvasTheme): string {
  const role = effectiveRole(element)
  return role ? CARD[theme].roles[role] : element.style.stroke
}

/** Whether the shape kind gets card paint at all. */
export function isCardShape(element: CanvasElement): boolean {
  return isCanvasShapeKind(element.kind)
}

/** Card paint and corner radius for one shape. */
export function cardShapePaint(
  element: CanvasElement,
  theme: CanvasTheme,
): { paint: RenderPaint; radius: number } {
  const tokens = CARD[theme]
  const style = element.style
  const role = effectiveRole(element)
  const note = role === 'note'
  const filled = style.fill !== 'none'
  const paint: RenderPaint = {}
  if (filled) {
    if (note) {
      const base = parseCssColor(tokens.surface)
      const amber = parseCssColor(NOTE_AMBER)
      paint.fill =
        base && amber ? mixColors(base, amber, CARD_NOTE_TINT) : tokens.surface
    } else {
      paint.fill = tintedSurface(style.fill, theme)
    }
    if (cardHasShadow(element)) paint.shadow = { ...tokens.shadow }
  }
  if (style.strokeWidth > 0) {
    const accent = style.cardBorder === 'accent'
    paint.stroke = accent ? cardAccent(element, theme) : tokens.border
    paint.strokeWidth = accent ? CARD_ACCENT_BORDER_WIDTH : CARD_BORDER_WIDTH
    if (note) paint.dash = [...NOTE_DASH]
  }
  const radius =
    element.kind === 'rectangle' && effectiveCornerRadius(element) > 0
      ? Math.min(
          CARD_RADIUS,
          Math.abs(element.width) / 2,
          Math.abs(element.height) / 2,
        )
      : 0
  return { paint, radius }
}

/** Paint for a connector under `card`: neutral edge unless the stroke was set. */
export function cardConnectorPaint(
  style: CanvasElementStyle,
  theme: CanvasTheme,
): { stroke: string; strokeWidth: number } {
  if (style.stroke === DEFAULT_ELEMENT_STYLE.stroke) {
    return { stroke: CARD[theme].edge, strokeWidth: CARD_EDGE_WIDTH }
  }
  return { stroke: style.stroke, strokeWidth: style.strokeWidth }
}

/**
 * Height reserved above the text for the chip row, or 0. Rectangles and
 * ellipses show the row when they carry a role or a step; diamonds and
 * triangles have no room and never do.
 */
export function cardTopRowHeight(
  element: CanvasElement,
  look: CardLook | undefined,
): number {
  if (!isCard(look)) return 0
  if (element.kind !== 'rectangle' && element.kind !== 'ellipse') return 0
  const has = effectiveRole(element) !== null || element.style.step.length > 0
  return has ? CARD_TOP_ROW : 0
}

const textStyleCache = new WeakMap<
  CanvasElementStyle,
  Map<string, { text: string; style: CanvasElementStyle }>
>()

const RUN_ATTR_KEYS = [
  'fontWeight',
  'fontStyle',
  'underline',
  'strikethrough',
  'fontSize',
  'color',
] as const

/**
 * The style a card's label is laid out and drawn with: the first hard line is
 * bold and later lines use the muted colour, as a base UNDER the stored runs,
 * so a run's own weight or colour wins. A whole-label bold or non-default
 * colour already says what the user wants, so the base leaves it alone.
 * Returns the stored style itself when no base is needed.
 */
export function cardTextStyle(
  element: CanvasElement,
  look: CardLook | undefined,
): CanvasElementStyle {
  const style = element.style
  const text = element.text ?? ''
  if (!isCard(look) || !isCanvasShapeKind(element.kind) || text.length === 0) {
    return style
  }
  let perTheme = textStyleCache.get(style)
  if (!perTheme) {
    perTheme = new Map()
    textStyleCache.set(style, perTheme)
  }
  const cached = perTheme.get(look.theme)
  if (cached && cached.text === text) return cached.style

  const newline = text.indexOf('\n')
  const firstEnd = newline < 0 ? text.length : newline
  let runs: Array<{ start: number; end: number } & TextRunAttrs> = []
  if (style.fontWeight !== 'bold' && firstEnd > 0) {
    runs = applyRunStyle(runs, 0, firstEnd, { fontWeight: 'bold' }, text.length)
  }
  if (
    newline >= 0 &&
    newline + 1 < text.length &&
    style.color === DEFAULT_ELEMENT_STYLE.color
  ) {
    runs = applyRunStyle(
      runs,
      newline + 1,
      text.length,
      { color: CARD[look.theme].muted },
      text.length,
    )
  }
  for (const run of normalizeRuns(style.textRuns, text.length)) {
    const attrs: TextRunAttrs = {}
    for (const key of RUN_ATTR_KEYS) {
      if (run[key] !== undefined) {
        ;(attrs as Record<string, unknown>)[key] = run[key]
      }
    }
    runs = applyRunStyle(runs, run.start, run.end, attrs, text.length)
  }
  const result = runs.length === 0 ? style : { ...style, textRuns: runs }
  perTheme.set(look.theme, { text, style: result })
  return result
}

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
import { presetRamp, rampFor } from './colour-ramps'
import { applyRunStyle, normalizeRuns } from './text-runs'
import type { Ramp } from './colour-ramps'
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
  /** Translated role names for the chip; `CARD_ROLE_LABELS` when absent. */
  roleLabels?: CardRoleLabels
}

/** The card look for a board style, or undefined for `classic`. */
export function cardLookOf(
  diagramStyle: DiagramStyle | undefined,
  theme: CanvasTheme,
  roleLabels?: CardRoleLabels,
): CardLook | undefined {
  return diagramStyle === 'card'
    ? { diagramStyle, theme, roleLabels }
    : undefined
}

export type CardRole = Exclude<ReturnType<typeof effectiveRole>, null>

interface CardTokens {
  surface: string
  border: string
  text: string
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
    text: '#f8fafc',
    muted: '#9aa3b3',
    edge: '#5c6578',
    shadow: { color: 'rgba(0, 0, 0, 0.45)', blur: 16, offsetY: 4 },
    roles: {
      trigger: '#a78bfa',
      action: '#60a5fa',
      system: '#2dd4bf',
      data: '#ffa057',
      note: '#94a3b8',
    },
  },
  light: {
    surface: '#ffffff',
    border: '#e2e6ec',
    text: '#0f172a',
    muted: '#5b6474',
    edge: '#9aa3b2',
    shadow: { color: 'rgba(15, 23, 42, 0.10)', blur: 14, offsetY: 4 },
    roles: {
      trigger: '#7c3aed',
      action: '#2563eb',
      system: '#0d9488',
      data: '#cc4e00',
      note: '#64748b',
    },
  },
}

/** Corner radius of a card rectangle, in world units. */
export const CARD_RADIUS = 14
/** How much wider the accent border is than the subtle one, in world units. */
export const CARD_ACCENT_BORDER_EXTRA = 0.5
/** Width of a connector drawn in a card ramp colour at rest. */
export const CARD_EDGE_WIDTH = 2.5
export const NOTE_DASH = [6, 4]
/** Height reserved at the top of a card's text frame for the chip row. */
export const CARD_TOP_ROW = 22

/** The role names drawn on the card chip, in the language the host picked. */
export type CardRoleLabels = Record<CardRole | 'none', string>

/** English defaults, used when the host passes no labels (export, headless). */
export const CARD_ROLE_LABELS: CardRoleLabels = {
  trigger: 'Trigger',
  action: 'Action',
  system: 'System',
  data: 'Data',
  note: 'Note',
  none: 'None',
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

/** WCAG relative luminance of an opaque RGB colour (0..1). */
export function relativeLuminance(color: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * linear(color.r) +
    0.7152 * linear(color.g) +
    0.0722 * linear(color.b)
  )
}

/** WCAG contrast ratio (1..21) between two CSS colours, or null if unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const first = parseCssColor(a)
  const second = parseCssColor(b)
  if (!first || !second) return null
  const high = relativeLuminance(first)
  const low = relativeLuminance(second)
  const [light, dark] = high >= low ? [high, low] : [low, high]
  return (light + 0.05) / (dark + 0.05)
}

/** Minimum contrast a stored text colour needs against the card body. */
export const CARD_MIN_TEXT_CONTRAST = 4.5

/**
 * The ramp a shape paints with. A note card is slate whatever its stored
 * fill; an unfilled shape has no body but its border is slate.
 */
function elementRamp(
  element: CanvasElement,
  theme: CanvasTheme,
): { ramp: Ramp; bodyAlpha: number } {
  const slate = { ramp: presetRamp('slate', theme), bodyAlpha: 1 }
  if (effectiveRole(element) === 'note') return slate
  return rampFor(element.style.fill, theme) ?? slate
}

/** The colour a connector pointing at `element` takes: its ramp line. */
export function cardRampLine(
  element: CanvasElement,
  theme: CanvasTheme,
): string {
  return elementRamp(element, theme).ramp.line
}

/** The neutral connector colour: the slate ramp line. */
export function cardSlateLine(theme: CanvasTheme): string {
  return presetRamp('slate', theme).line
}

/**
 * The colour a card body is painted with, composited over the surface when
 * the body is see-through. An unfilled card has no body; the surface stands
 * in for the board behind it.
 */
function cardBodyColor(element: CanvasElement, theme: CanvasTheme): string {
  const surface = CARD[theme].surface
  if (element.style.fill === 'none') return surface
  const { ramp, bodyAlpha } = elementRamp(element, theme)
  if (bodyAlpha >= 1) return ramp.body
  const base = parseCssColor(surface)
  const body = parseCssColor(ramp.body)
  return base && body ? mixColors(base, body, bodyAlpha) : surface
}

/** Largest channel spread (max - min) a label colour may have to count as neutral. */
export const CARD_NEUTRAL_CHROMA = 40

/** Whether `color` has a low spread between its channels (greys, slates, pale tints). */
function isNeutralColor(color: string): boolean {
  const rgb = parseCssColor(color)
  if (!rgb) return false
  return (
    Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <=
    CARD_NEUTRAL_CHROMA
  )
}

/** Whether `color` reads on `body`. Unparseable colours are kept as stored. */
function readableOn(color: string, body: string): boolean {
  const ratio = contrastRatio(color, body)
  return ratio === null || ratio >= CARD_MIN_TEXT_CONTRAST
}

/** Whether the card draws a shadow under `element`. */
export function cardHasShadow(element: CanvasElement): boolean {
  const mode = element.style.cardShadow
  if (mode === 'on') return true
  if (mode === 'off') return false
  return effectiveRole(element) !== 'note'
}

/** The colour the element's role chip and accent border use. */
export function cardAccent(element: CanvasElement, theme: CanvasTheme): string {
  const role = effectiveRole(element)
  return role
    ? CARD[theme].roles[role]
    : elementRamp(element, theme).ramp.border
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
    const { ramp, bodyAlpha } = elementRamp(element, theme)
    paint.fill = bodyPaintColor(ramp.body, bodyAlpha)
    if (cardHasShadow(element)) paint.shadow = { ...tokens.shadow }
  }
  if (style.strokeWidth > 0) {
    const accent = style.cardBorder === 'accent'
    paint.stroke = accent
      ? cardAccent(element, theme)
      : elementRamp(element, theme).ramp.border
    paint.strokeWidth = accent
      ? style.strokeWidth + CARD_ACCENT_BORDER_EXTRA
      : style.strokeWidth
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

/** `#rrggbb` as is, or `rgba()` when the body is see-through. */
function bodyPaintColor(body: string, alpha: number): string {
  if (alpha >= 1) return body
  const rgb = parseCssColor(body)
  if (!rgb) return body
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(alpha * 1000) / 1000})`
}

/**
 * Paint for a connector under `card` with no scene to look at: the slate line
 * unless the stroke was set. Connectors in a scene take their target's colour
 * (see `render.ts`).
 */
export function cardConnectorPaint(
  style: CanvasElementStyle,
  theme: CanvasTheme,
): { stroke: string; strokeWidth: number } {
  if (style.stroke === DEFAULT_ELEMENT_STYLE.stroke) {
    return { stroke: cardSlateLine(theme), strokeWidth: CARD_EDGE_WIDTH }
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
 * bold and later lines use the ramp body-text colour, as a base UNDER the stored runs,
 * so a run's own weight or colour wins. A stored label colour that is
 * readable and strongly coloured (a saturated blue or red) is kept on every line. A readable
 * low-spread one (a grey, a slate, a pale tint) keeps the title and gives later lines the
 * muted colour. A colour (or a run's colour) with under 4.5:1 contrast against
 * the card body is treated as unset.
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

  const body = cardBodyColor(element, look.theme)
  const { ramp } = elementRamp(element, look.theme)
  // A stored label colour that cannot be read on this body is treated as
  // unset: the title takes the ramp title colour, later lines the ramp body text.
  const unreadable =
    style.color !== DEFAULT_ELEMENT_STYLE.color &&
    !readableOn(style.color, body)
  const unset = style.color === DEFAULT_ELEMENT_STYLE.color || unreadable
  const mutedBody = unset || isNeutralColor(style.color)
  const newline = text.indexOf('\n')
  const firstEnd = newline < 0 ? text.length : newline
  let runs: Array<{ start: number; end: number } & TextRunAttrs> = []
  if (style.fontWeight !== 'bold' && firstEnd > 0) {
    runs = applyRunStyle(runs, 0, firstEnd, { fontWeight: 'bold' }, text.length)
  }
  if (newline >= 0 && newline + 1 < text.length && mutedBody) {
    runs = applyRunStyle(
      runs,
      newline + 1,
      text.length,
      { color: ramp.bodyText },
      text.length,
    )
  }
  for (const run of normalizeRuns(style.textRuns, text.length)) {
    const attrs: TextRunAttrs = {}
    for (const key of RUN_ATTR_KEYS) {
      if (run[key] === undefined) continue
      if (
        key === 'color' &&
        run.color !== DEFAULT_ELEMENT_STYLE.color &&
        !readableOn(run.color as string, body)
      ) {
        continue
      }
      ;(attrs as Record<string, unknown>)[key] = run[key]
    }
    runs = applyRunStyle(runs, run.start, run.end, attrs, text.length)
  }
  const base = unset ? { ...style, color: ramp.title } : style
  const result =
    runs.length === 0 && !unset ? style : { ...base, textRuns: runs }
  perTheme.set(look.theme, { text, style: result })
  return result
}

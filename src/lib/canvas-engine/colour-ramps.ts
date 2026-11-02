// src/lib/canvas-engine/colour-ramps.ts
// Colour ramps for the `card` diagram style: from one stored fill string, the
// body, border, title and body-text colours a card is painted with.
//
// Pure: no DOM, no clock, no React. Nothing here is written back to a row.
//
// Preset hex values are copied from the Radix Colors source
// (github.com/radix-ui/colors, src/dark.ts and src/light.ts):
//   dark body  = sRGB midpoint of the hue's dark step 6 and step 8
//   dark line  = dark step 9 (also the stored preset value)
//   light body = light step 4, light line = light step 9
// Any other colour gets a ramp derived in OKLCH.

import { DEFAULT_ELEMENT_STYLE } from './scene'

export type PresetId =
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'plum'
  | 'pink'
  | 'tomato'
  | 'orange'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'slate'

export type RampTheme = 'light' | 'dark'

export interface Ramp {
  body: string
  border: string
  title: string
  bodyText: string
  /** Colour of a connector pointing at a shape painted with this ramp. */
  line: string
}

export interface ResolvedRamp {
  ramp: Ramp
  /** Opacity of the card body, 0..1. Border and text are always opaque. */
  bodyAlpha: number
}

const DARK_TITLE = '#ffffff'
const DARK_BODY_TEXT = '#e8eaed'
/** Radix light slate step 12 and step 11. */
const LIGHT_TITLE = '#1c2024'
const LIGHT_BODY_TEXT = '#60646c'

interface PresetSource {
  /** The stored `style.fill` / `style.stroke` value: Radix dark step 9. */
  value: string
  darkBody: string
  lightBody: string
  lightLine: string
}

const PRESET_SOURCES: Record<PresetId, PresetSource> = {
  blue: {
    value: '#0090ff',
    darkBody: '#1c5fa2',
    lightBody: '#d5efff',
    lightLine: '#0090ff',
  },
  indigo: {
    value: '#3e63dd',
    darkBody: '#3a509b',
    lightBody: '#e1e9ff',
    lightLine: '#3e63dd',
  },
  violet: {
    value: '#6e56cf',
    darkBody: '#584892',
    lightBody: '#ebe4ff',
    lightLine: '#6e56cf',
  },
  plum: {
    value: '#ab4aba',
    darkBody: '#78427f',
    lightBody: '#f7def8',
    lightLine: '#ab4aba',
  },
  pink: {
    value: '#d6409f',
    darkBody: '#89396d',
    lightBody: '#fbdcef',
    lightLine: '#d6409f',
  },
  tomato: {
    value: '#e54d2e',
    darkBody: '#8d3b2d',
    lightBody: '#ffdcd3',
    lightLine: '#e54d2e',
  },
  orange: {
    value: '#f76b15',
    darkBody: '#85471b',
    lightBody: '#ffdfb5',
    lightLine: '#f76b15',
  },
  green: {
    value: '#30a46c',
    darkBody: '#286a4b',
    lightBody: '#d6f1df',
    lightLine: '#30a46c',
  },
  teal: {
    value: '#12a594',
    darkBody: '#1a6b62',
    lightBody: '#ccf3ea',
    lightLine: '#12a594',
  },
  cyan: {
    value: '#00a2c7',
    darkBody: '#0b6a82',
    lightBody: '#caf1f6',
    lightLine: '#00a2c7',
  },
  slate: {
    value: '#696e77',
    darkBody: '#484e54',
    lightBody: '#e8e8ec',
    lightLine: '#8b8d98',
  },
}

export const PRESET_IDS = Object.keys(PRESET_SOURCES) as Array<PresetId>

function buildRamp(source: PresetSource, theme: RampTheme): Ramp {
  return theme === 'dark'
    ? {
        body: source.darkBody,
        border: source.value,
        title: DARK_TITLE,
        bodyText: DARK_BODY_TEXT,
        line: source.value,
      }
    : {
        body: source.lightBody,
        border: source.lightLine,
        title: LIGHT_TITLE,
        bodyText: LIGHT_BODY_TEXT,
        line: source.lightLine,
      }
}

/** Preset id -> stored value, ramps per theme. */
export const PRESET_RAMPS: Record<
  PresetId,
  { value: string; dark: Ramp; light: Ramp }
> = Object.fromEntries(
  PRESET_IDS.map((id) => [
    id,
    {
      value: PRESET_SOURCES[id].value,
      dark: buildRamp(PRESET_SOURCES[id], 'dark'),
      light: buildRamp(PRESET_SOURCES[id], 'light'),
    },
  ]),
) as Record<PresetId, { value: string; dark: Ramp; light: Ramp }>

const PRESET_BY_VALUE = new Map<string, PresetId>(
  PRESET_IDS.map((id) => [PRESET_SOURCES[id].value, id]),
)

/**
 * The fill strings the pre-ramp swatch row wrote, mapped to the preset they
 * stand for. The old blue swatch is byte-for-byte the engine default, so it
 * means "never coloured" and maps to slate.
 */
export const LEGACY_FILLS: ReadonlyMap<string, PresetId> = new Map<
  string,
  PresetId
>([
  ['rgba(100, 116, 139, 0.10)', 'slate'],
  ['rgba(239, 68, 68, 0.10)', 'tomato'],
  ['rgba(249, 115, 22, 0.10)', 'orange'],
  ['rgba(245, 158, 11, 0.10)', 'orange'],
  ['rgba(34, 197, 94, 0.10)', 'green'],
  ['rgba(20, 184, 166, 0.10)', 'teal'],
  ['rgba(139, 92, 246, 0.10)', 'violet'],
  [DEFAULT_ELEMENT_STYLE.fill, 'slate'],
])

interface RgbaColour {
  r: number
  g: number
  b: number
  a: number
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` with alpha. */
export function parseColourWithAlpha(value: string): RgbaColour | null {
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
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    }
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(text)
  if (!fn) return null
  const parts = fn[1].split(/[\s,/]+/).filter((part) => part.length > 0)
  if (parts.length < 3 || parts.length > 4) return null
  const number = /^(\d+(\.\d+)?|\.\d+)%?$/
  if (!parts.every((part) => number.test(part))) return null
  const channel = (part: string) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(
          part.endsWith('%')
            ? (parseFloat(part) / 100) * 255
            : parseFloat(part),
        ),
      ),
    )
  let a = 1
  if (parts.length === 4) {
    const raw = parts[3]
    a = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
    a = Math.max(0, Math.min(1, a))
  }
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a }
}

// --- OKLCH <-> sRGB (Bjorn Ottosson's matrices) ---------------------------

function srgbToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

function rgbToOklch(
  r: number,
  g: number,
  b: number,
): { L: number; C: number; H: number } {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(a, bb), H: Math.atan2(bb, a) }
}

/** Linear-light sRGB for an OKLCH colour; channels may fall outside 0..1. */
function oklchToLinear(
  L: number,
  C: number,
  H: number,
): [number, number, number] {
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const GAMUT_EPSILON = 0.0005

function inGamut(channels: [number, number, number]): boolean {
  return channels.every(
    (channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  )
}

/** `#rrggbb` for an OKLCH colour, lowering chroma until it fits sRGB. */
function oklchToHex(L: number, C: number, H: number): string {
  let chroma = C
  let linear = oklchToLinear(L, chroma, H)
  for (let step = 0; step < 40 && !inGamut(linear); step++) {
    chroma *= 0.92
    linear = oklchToLinear(L, chroma, H)
  }
  return (
    '#' +
    linear
      .map((channel) => {
        const clamped = Math.max(0, Math.min(1, channel))
        return Math.round(linearToSrgb(clamped) * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

/** Below this OKLCH chroma a colour is a grey and takes the slate ramp. */
const NEUTRAL_CHROMA = 0.02

function deriveRamp(C: number, H: number, theme: RampTheme): Ramp {
  if (theme === 'dark') {
    const border = oklchToHex(0.66, Math.min(C, 0.17), H)
    return {
      body: oklchToHex(0.47, Math.min(C, 0.12), H),
      border,
      title: DARK_TITLE,
      bodyText: DARK_BODY_TEXT,
      line: border,
    }
  }
  const border = oklchToHex(0.6, Math.min(C, 0.15), H)
  return {
    body: oklchToHex(0.94, Math.min(C, 0.04), H),
    border,
    title: LIGHT_TITLE,
    bodyText: LIGHT_BODY_TEXT,
    line: border,
  }
}

const RAMP_CACHE = new Map<string, ResolvedRamp | null>()
const RAMP_CACHE_LIMIT = 512

/** The ramp preset `id` paints with. */
export function presetRamp(id: PresetId, theme: RampTheme): Ramp {
  return PRESET_RAMPS[id][theme]
}

/**
 * The ramp and body opacity for a stored fill, or null for `none` (no body).
 * Cached by `fill|theme`.
 */
export function rampFor(fill: string, theme: RampTheme): ResolvedRamp | null {
  const key = `${fill}|${theme}`
  const hit = RAMP_CACHE.get(key)
  if (hit !== undefined) return hit
  const value = computeRamp(fill, theme)
  if (RAMP_CACHE.size >= RAMP_CACHE_LIMIT) RAMP_CACHE.clear()
  RAMP_CACHE.set(key, value)
  return value
}

function computeRamp(fill: string, theme: RampTheme): ResolvedRamp | null {
  if (fill === 'none') return null
  const text = fill.trim().toLowerCase()
  const preset = PRESET_BY_VALUE.get(text)
  if (preset) return { ramp: presetRamp(preset, theme), bodyAlpha: 1 }
  const legacy = LEGACY_FILLS.get(fill)
  if (legacy) return { ramp: presetRamp(legacy, theme), bodyAlpha: 1 }
  const colour = parseColourWithAlpha(fill)
  if (!colour) return { ramp: presetRamp('slate', theme), bodyAlpha: 1 }
  const { C, H } = rgbToOklch(colour.r, colour.g, colour.b)
  if (C < NEUTRAL_CHROMA) {
    return { ramp: presetRamp('slate', theme), bodyAlpha: colour.a }
  }
  return { ramp: deriveRamp(C, H, theme), bodyAlpha: colour.a }
}

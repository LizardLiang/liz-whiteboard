// src/lib/canvas-engine/text-cache.ts
// Cross-frame caches for canvas text: glyph-run widths and whole text layouts.
//
// `ctx.measureText` is the most expensive call in a canvas frame, and a layout
// that wraps a paragraph makes hundreds of them. The board repaints on every
// camera change, so without these caches an idle paragraph is measured again
// on every frame of a pan.
//
// Correctness rests on the keys, not on invalidation hooks:
//   - A width is keyed by the exact font string plus the exact text. Widths are
//     in CSS pixels at that font size and do not depend on the camera zoom or
//     the context transform, so zoom never returns a stale value.
//   - A layout is keyed by every input `layoutElementText` reads: text, font
//     size, weight, style, alignment, wrap width and the resolved text runs.
//     An edit, a style change or a resize changes the key, so it misses.
// The one thing a key cannot see is the font itself changing under the same
// name: a web font finishing its load. `clearTextCaches` handles that and runs
// on `document.fonts` `loadingdone`.
//
// Both caches live per drawing context (a WeakMap), so two canvases, or a test
// stub context, never share entries. Both are bounded.

import type { TextLayout } from './text-layout'

/** Entries kept per generation; at most twice this many live at once. */
export const WIDTH_CACHE_LIMIT = 8192
export const LAYOUT_CACHE_LIMIT = 1024
/** More distinct font strings than this means a pathological caller: start over. */
const MAX_FONTS = 64

/**
 * A bounded cache that keeps the recently used half. Two generations: lookups
 * try the young one, then promote from the old one; when the young one is full
 * the old one is dropped and the young one takes its place.
 */
class BoundedCache<T> {
  private young = new Map<string, T>()
  private old = new Map<string, T>()

  constructor(private readonly limit: number) {}

  get(key: string): T | undefined {
    const hit = this.young.get(key)
    if (hit !== undefined) return hit
    const aged = this.old.get(key)
    if (aged !== undefined) this.set(key, aged)
    return aged
  }

  set(key: string, value: T): void {
    this.young.set(key, value)
    if (this.young.size >= this.limit) {
      this.old = this.young
      this.young = new Map()
    }
  }

  get size(): number {
    return this.young.size + this.old.size
  }

  clear(): void {
    this.young = new Map()
    this.old = new Map()
  }
}

/** One context's caches. */
export class TextCaches {
  private readonly widths = new Map<string, BoundedCache<number>>()
  readonly layouts = new BoundedCache<TextLayout>(LAYOUT_CACHE_LIMIT)
  private readonly runIds = new WeakMap<object, number>()
  private nextRunId = 1
  /** The font-load epoch these entries were measured under. */
  private epoch: number

  constructor(private readonly widthLimit = WIDTH_CACHE_LIMIT) {
    this.epoch = currentEpoch
  }

  /** Drop everything if a font finished loading since the last access. */
  private sync(): void {
    if (this.epoch === currentEpoch) return
    this.epoch = currentEpoch
    this.widths.clear()
    this.layouts.clear()
  }

  /** The width of `text` in `font`, measured at most once per cache lifetime. */
  width(font: string, text: string, measure: () => number): number {
    this.sync()
    let perFont = this.widths.get(font)
    if (!perFont) {
      if (this.widths.size >= MAX_FONTS) this.widths.clear()
      perFont = new BoundedCache<number>(this.widthLimit)
      this.widths.set(font, perFont)
    }
    const cached = perFont.get(text)
    if (cached !== undefined) return cached
    const width = measure()
    perFont.set(text, width)
    return width
  }

  /** A cached layout for `key`, or the one `build` makes. */
  layout(key: string, build: () => TextLayout): TextLayout {
    this.sync()
    const cached = this.layouts.get(key)
    if (cached) return cached
    const layout = build()
    this.layouts.set(key, layout)
    return layout
  }

  /** A small stable id for an object, to put it in a layout key. */
  idOf(value: object): number {
    let id = this.runIds.get(value)
    if (id === undefined) {
      id = this.nextRunId
      this.nextRunId += 1
      this.runIds.set(value, id)
    }
    return id
  }

  /** Entries held: widths across all fonts, plus layouts. */
  get sizes(): { widths: number; layouts: number } {
    let widths = 0
    for (const perFont of this.widths.values()) widths += perFont.size
    return { widths, layouts: this.layouts.size }
  }
}

let currentEpoch = 0
const byContext = new WeakMap<object, TextCaches>()

/** The caches belonging to one canvas context. */
export function textCachesFor(ctx: object): TextCaches {
  let caches = byContext.get(ctx)
  if (!caches) {
    caches = new TextCaches()
    byContext.set(ctx, caches)
  }
  return caches
}

/**
 * Invalidate every cache. Called when a web font finishes loading: text
 * measured with the fallback font is wrong from that moment on.
 */
export function clearTextCaches(): void {
  currentEpoch += 1
}

if (typeof document !== 'undefined' && 'fonts' in document) {
  document.fonts.addEventListener('loadingdone', clearTextCaches)
}

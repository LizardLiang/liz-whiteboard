// src/lib/canvas-engine/render.ts
// The canvas engine's renderer (tactical plan Wave 1 step 4, deliberately
// moved to the head of Wave 3 by amendment A5).
//
// This is the one engine module that needs a `CanvasRenderingContext2D`,
// which is why it did not belong in Wave 1's browser-free batch. It still
// imports no React, touches no database, and never reaches for `window` or
// `document`: every browser-supplied value it needs — the context, the
// viewport size, the device pixel ratio, the theme — arrives as an argument.
// That is what lets it be unit-tested against a recording stub context.
//
// Two rules it exists to enforce:
//
//  1. EVERY coordinate conversion goes through `camera.ts`. This module
//     never writes `(x - camera.x) * zoom` by hand — W1 and W3 in this repo
//     were both a second, divergent transform at a call site.
//  2. Selection affordances are drawn in SCREEN space, after the camera
//     transform has been popped. A handle drawn in world space would be
//     8 world units, i.e. 0.8 screen px at 0.1x zoom and 16 at 2x — invisible
//     when zoomed out and clumsy when zoomed in.

import { worldToScreen } from './camera'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import { DEFAULT_TEXT_STYLE, layoutText, pointFromCaret } from './text-layout'
import type { Camera } from './camera'
import type { WorldRect } from './hit-test'
import type { CanvasElement, CanvasElementStyle, Scene } from './scene'
import type { TextLayout, TextMeasurer } from './text-layout'

/**
 * The drawing surface's size in CSS pixels plus the display's device pixel
 * ratio.
 *
 * `devicePixelRatio` is a parameter rather than a `window` read on purpose:
 * this module has no globals, and a caller rendering to an offscreen canvas
 * (thumbnail, export) wants to choose its own ratio.
 */
export interface Viewport {
  width: number
  height: number
  devicePixelRatio: number
}

/** Which palette the non-data chrome is drawn with. */
export type CanvasTheme = 'light' | 'dark'

/** The eight resize grips around a single selected element. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const RESIZE_HANDLES: ReadonlyArray<ResizeHandle> = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

/** A rectangle in SCREEN space (viewport-relative CSS pixels). */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Everything the renderer needs to know that is not part of the persisted
 * scene: what is selected, what marquee is in flight, what is being typed
 * into.
 */
export interface RenderSelection {
  /** Ids of the currently selected elements. */
  ids: ReadonlySet<string>
  /** In-flight marquee rectangle in WORLD space, or null. */
  marquee?: WorldRect | null
  /** The element being typed into, and where its caret sits. */
  editing?: { elementId: string; caret: number; caretVisible: boolean } | null
  /**
   * A not-yet-committed element being drawn (the rubber-band preview for the
   * rectangle tool). Drawn like a real element but never in the scene.
   */
  draft?: CanvasElement | null
}

export interface DrawOptions {
  theme?: CanvasTheme
}

/** Inset between an element's bounds and its text, in WORLD units. */
export const TEXT_PADDING = 8

/** Resize-grip edge length, in SCREEN pixels — constant at every zoom. */
export const HANDLE_SIZE = 8

/**
 * The font stack. Fixed rather than themed: `ctx.measureText` and
 * `ctx.fillText` must agree exactly, and the only way to guarantee that is
 * for the measurer and the renderer to build the font string from the same
 * function.
 */
export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK TC", sans-serif'

export function canvasFont(fontSize: number): string {
  return `${fontSize}px ${FONT_FAMILY}`
}

/**
 * A `TextMeasurer` bound to a context and a font size.
 *
 * The font is re-applied on every call rather than once at construction:
 * `drawScene` changes `ctx.font` between elements, so a measurer that set it
 * only once would silently measure at whatever size the previous element
 * used — a wrapping bug with no visible cause.
 */
export function measurerFor(
  ctx: CanvasRenderingContext2D,
  fontSize: number,
): TextMeasurer {
  const font = canvasFont(fontSize)
  return (text: string) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/**
 * Chrome colours. These are UI, not data: they are chosen by the theme, and
 * they are the reason `drawScene` takes a theme at all.
 */
const CHROME = {
  light: {
    accent: '#3b82f6',
    handleFill: '#ffffff',
    marqueeFill: 'rgba(59, 130, 246, 0.10)',
    text: '#0f172a',
  },
  dark: {
    accent: '#60a5fa',
    handleFill: '#0f172a',
    marqueeFill: 'rgba(96, 165, 250, 0.16)',
    text: '#f8fafc',
  },
} as const

/**
 * The colour an element's text is actually drawn in.
 *
 * A stored colour is data and is honoured verbatim — with ONE exception: the
 * engine default (`DEFAULT_ELEMENT_STYLE.color`, slate-900) is unreadable on
 * the dark theme's near-black background, and milestone 1 ships no colour
 * picker, so every element carries that default and nothing else. Resolving
 * it per theme is the same intent as `DEFAULT_SHAPE_STYLE.textColor: 'auto'`
 * on the ER board. When a colour picker exists, a user-chosen colour will
 * differ from the default and pass through untouched.
 */
export function resolveTextColor(
  style: CanvasElementStyle,
  theme: CanvasTheme,
): string {
  return style.color === DEFAULT_ELEMENT_STYLE.color
    ? CHROME[theme].text
    : style.color
}

/**
 * Size the backing store to `cssSize * devicePixelRatio`.
 *
 * Omitting this is the classic blurry-canvas bug: the browser scales a
 * 1-device-pixel-per-CSS-pixel bitmap up to a 2x display and every stroke
 * turns to mush. Returns whether the backing store actually changed, because
 * assigning `canvas.width` RESETS the whole context state (transform, styles,
 * clip) — so callers must not do it on every frame, and this function does
 * not.
 */
export function syncBackingStore(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
): boolean {
  const ratio = viewport.devicePixelRatio > 0 ? viewport.devicePixelRatio : 1
  const width = Math.max(1, Math.round(viewport.width * ratio))
  const height = Math.max(1, Math.round(viewport.height * ratio))
  let changed = false
  if (ctx.canvas.width !== width) {
    ctx.canvas.width = width
    changed = true
  }
  if (ctx.canvas.height !== height) {
    ctx.canvas.height = height
    changed = true
  }
  return changed
}

/** A world rect's position and size on screen, via the canonical transform. */
export function worldRectToScreen(
  camera: Camera,
  rect: WorldRect,
): ScreenRect {
  const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  }
}

/**
 * The eight resize grips for a world rect, in SCREEN space.
 *
 * Exported so `use-canvas-input` hit-tests exactly the rectangles that were
 * drawn. Two implementations of "where is the north-west handle" would drift
 * the moment either changes, and the symptom — a grip that does not grab
 * where it looks — is the same class of bug as W1/W3.
 */
export function handleRects(
  camera: Camera,
  rect: WorldRect,
): Record<ResizeHandle, ScreenRect> {
  const r = worldRectToScreen(camera, rect)
  const midX = r.x + r.width / 2
  const midY = r.y + r.height / 2
  const right = r.x + r.width
  const bottom = r.y + r.height
  const centres: Record<ResizeHandle, [number, number]> = {
    nw: [r.x, r.y],
    n: [midX, r.y],
    ne: [right, r.y],
    e: [right, midY],
    se: [right, bottom],
    s: [midX, bottom],
    sw: [r.x, bottom],
    w: [r.x, midY],
  }
  const half = HANDLE_SIZE / 2
  const out = {} as Record<ResizeHandle, ScreenRect>
  for (const handle of RESIZE_HANDLES) {
    const [cx, cy] = centres[handle]
    out[handle] = {
      x: cx - half,
      y: cy - half,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    }
  }
  return out
}

/**
 * Where an element's text block starts and how wide it may run, in WORLD
 * units.
 *
 * One definition shared by drawing, caret placement and click-to-caret. If
 * the renderer inset by 8 and the input hook inset by 0, every click would
 * land one character early.
 */
export function textFrame(element: CanvasElement): {
  x: number
  y: number
  maxWidth: number
} {
  return {
    x: element.x + TEXT_PADDING,
    y: element.y + TEXT_PADDING,
    maxWidth: Math.max(0, element.width - TEXT_PADDING * 2),
  }
}

/** Lay out an element's text with the element's own font size. */
export function layoutElementText(
  element: CanvasElement,
  measure: TextMeasurer,
): TextLayout {
  const frame = textFrame(element)
  return layoutText(
    element.text ?? '',
    { ...DEFAULT_TEXT_STYLE, fontSize: element.style.fontSize },
    frame.maxWidth,
    measure,
  )
}

/**
 * Draw one element in WORLD space. The caller has already applied the camera
 * transform, so this function uses raw world coordinates throughout.
 */
function drawElement(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
  theme: CanvasTheme,
): TextLayout | null {
  if (element.kind === 'rectangle') {
    if (element.style.fill !== 'none') {
      ctx.fillStyle = element.style.fill
      ctx.fillRect(element.x, element.y, element.width, element.height)
    }
    if (element.style.strokeWidth > 0) {
      ctx.strokeStyle = element.style.stroke
      ctx.lineWidth = element.style.strokeWidth
      ctx.strokeRect(element.x, element.y, element.width, element.height)
    }
  }

  const text = element.text ?? ''
  if (text.length === 0) return null

  const measure = measurerFor(ctx, element.style.fontSize)
  const layout = layoutElementText(element, measure)
  const frame = textFrame(element)

  ctx.fillStyle = resolveTextColor(element.style, theme)
  ctx.font = canvasFont(element.style.fontSize)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  for (let i = 0; i < layout.lines.length; i += 1) {
    ctx.fillText(
      layout.lines[i].text,
      frame.x,
      frame.y + i * layout.lineHeight,
    )
  }
  // Returned so `drawScene` can hand it to `drawCaret` instead of paying for
  // a second layout of the same string on the same frame.
  return layout
}

/**
 * Draw the text caret in WORLD space, so it sits between the glyphs it was
 * measured against. Its width is `1 / zoom` world units, which is exactly one
 * screen pixel at any zoom.
 */
function drawCaret(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
  caret: number,
  camera: Camera,
  theme: CanvasTheme,
  /**
   * The layout `drawElement` already produced for this element on this frame.
   *
   * Laying the text out costs one `measureText` per character per line (the
   * caret offsets), and the element being typed into is redrawn on every
   * keystroke AND on every 530ms blink — so recomputing here doubled the cost
   * of the one element most likely to be large. Null only when the element
   * has no text, which `drawElement` skips.
   */
  known: TextLayout | null,
): void {
  const layout =
    known ??
    layoutElementText(element, measurerFor(ctx, element.style.fontSize))
  const local = pointFromCaret(layout, caret)
  const frame = textFrame(element)

  ctx.strokeStyle = CHROME[theme].text
  ctx.lineWidth = 1 / camera.zoom
  ctx.beginPath()
  ctx.moveTo(frame.x + local.x, frame.y + local.y)
  ctx.lineTo(frame.x + local.x, frame.y + local.y + local.height)
  ctx.stroke()
}

/**
 * Draw selection outlines, resize grips and the marquee in SCREEN space.
 *
 * Called with the camera transform already popped: everything here is in CSS
 * pixels, which is what keeps a grip 8px wherever the zoom is. The half-pixel
 * offsets put a 1px stroke on a pixel centre instead of straddling two.
 */
function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  selection: RenderSelection,
  theme: CanvasTheme,
): void {
  const chrome = CHROME[theme]
  const selected: Array<CanvasElement> = []
  for (const element of scene.elements) {
    if (selection.ids.has(element.id)) selected.push(element)
  }

  ctx.lineWidth = 1
  ctx.strokeStyle = chrome.accent
  for (const element of selected) {
    const r = worldRectToScreen(camera, element)
    ctx.strokeRect(
      r.x + 0.5,
      r.y + 0.5,
      Math.max(0, r.width - 1),
      Math.max(0, r.height - 1),
    )
  }

  // Grips for a single selection only. A multi-selection gets an outline and
  // can be moved; resizing several elements at once needs a group transform
  // that milestone 1 does not have, and drawing grips that do nothing would
  // be worse than drawing none.
  if (selected.length === 1 && !selection.editing) {
    const grips = handleRects(camera, selected[0])
    for (const handle of RESIZE_HANDLES) {
      const g = grips[handle]
      ctx.fillStyle = chrome.handleFill
      ctx.fillRect(g.x, g.y, g.width, g.height)
      ctx.strokeStyle = chrome.accent
      ctx.strokeRect(g.x + 0.5, g.y + 0.5, g.width - 1, g.height - 1)
    }
  }

  if (selection.marquee) {
    const r = worldRectToScreen(camera, selection.marquee)
    ctx.fillStyle = chrome.marqueeFill
    ctx.fillRect(r.x, r.y, r.width, r.height)
    ctx.strokeStyle = chrome.accent
    ctx.setLineDash([4, 4])
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height)
    ctx.setLineDash([])
  }
}

/**
 * Draw the whole board: clear, apply the camera, paint every element in
 * z-order, then paint the selection affordances in screen space.
 *
 * Full clear plus full redraw, as the plan's assumption records. The dirty
 * flag that decides WHEN this runs lives in `CanvasBoard.tsx`; this function
 * always draws everything it is asked to.
 *
 * The canvas is cleared to TRANSPARENT rather than filled with a board
 * colour: the surface colour is a themed CSS background on the `<canvas>`
 * element itself, which is how the board follows light/dark mode without the
 * renderer knowing anything about design tokens.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  viewport: Viewport,
  selection: RenderSelection,
  options: DrawOptions = {},
): void {
  const theme = options.theme ?? 'light'
  const ratio = viewport.devicePixelRatio > 0 ? viewport.devicePixelRatio : 1

  syncBackingStore(ctx, viewport)

  // Reset to the DPR base transform every frame. `setTransform` (not
  // `scale`) so a mid-frame throw last time cannot leave a compounding
  // scale behind.
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)

  ctx.save()
  // The camera transform, in the same order as `worldToScreen`:
  // screen = (world - camera) * zoom.
  ctx.scale(camera.zoom, camera.zoom)
  ctx.translate(-camera.x, -camera.y)

  const editing = selection.editing
  let editingLayout: TextLayout | null = null

  for (const element of scene.elements) {
    const layout = drawElement(ctx, element, theme)
    if (editing && element.id === editing.elementId) editingLayout = layout
  }
  if (selection.draft) {
    drawElement(ctx, selection.draft, theme)
  }

  if (editing?.caretVisible) {
    const element = scene.byId.get(editing.elementId)
    if (element) {
      drawCaret(ctx, element, editing.caret, camera, theme, editingLayout)
    }
  }

  ctx.restore()

  drawSelectionOverlay(ctx, scene, camera, selection, theme)
}

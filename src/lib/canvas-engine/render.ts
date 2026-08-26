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
import { DEFAULT_ELEMENT_STYLE, isCanvasShapeKind } from './scene'
import { arrowHead, attachPoint } from './connector-geometry'
import { connectorPathOf } from './hit-test'
import { QUICK_CREATE_DIRECTIONS } from './quick-create'
import { DEFAULT_TEXT_STYLE, layoutText, pointFromCaret } from './text-layout'
import type { Camera, Point } from './camera'
import type { QuickCreateDirection } from './quick-create'
import type { WorldRect } from './hit-test'
import type {
  CanvasElement,
  CanvasElementStyle,
  ConnectorAttach,
  Scene,
} from './scene'
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
  /**
   * The element the pointer is currently over, or null.
   *
   * Purely an affordance input: it decides where the four creation handles
   * are drawn when nothing is selected (canvas quick-create-handles tactical
   * plan, decision B1 — handles show on selection OR hover). Nothing about
   * the scene changes because of it.
   */
  hoveredId?: string | null
  /**
   * An in-flight drag from a creation handle: which element it started on,
   * and where the pointer is now in WORLD space.
   *
   * Drawn as a dashed rubber band and committed by nothing — the same
   * never-in-the-scene contract `draft` already has.
   */
  quickCreate?: { fromId: string; toWorld: Point } | null
  /**
   * While a connector END is being dragged: the element it would attach to if
   * released now, and exactly where on that element's border.
   *
   * Null while the pointer is over empty board — which is itself the signal
   * that releasing there DETACHES. Without this the drag gives no answer to
   * "will this connect?" until after the mouse is already up.
   */
  connectorAttach?: { elementId: string; attach: ConnectorAttach } | null
  /**
   * A transient highlight pulse after a canvas undo/redo (board-undo
   * tactical plan, Wave 4, step 12 — "Canvas Undo Reports What It Did").
   *
   * `intensity` is 1 at the moment the pulse starts, decaying to 0. TIME
   * lives entirely in the caller (`use-canvas-highlight.ts`, a React hook):
   * this module has no timers and no `Date.now()` of its own — it only
   * draws whatever intensity it is handed for the current frame, the same
   * browser-free contract every other `RenderSelection`/`DrawOptions` field
   * already follows.
   */
  highlight?: { elementId: string; intensity: number } | null
}

export interface DrawOptions {
  theme?: CanvasTheme
}

/** Inset between an element's bounds and its text, in WORLD units. */
export const TEXT_PADDING = 8

/** Resize-grip edge length, in SCREEN pixels — constant at every zoom. */
export const HANDLE_SIZE = 8

/**
 * The four sides a creation handle sits on.
 *
 * An ALIAS of `quick-create.ts`'s `QuickCreateDirection`, not a second
 * declaration of the same four strings: the direction a handle was grabbed
 * on is handed straight to `quickCreatePlacement`, so the two must agree, and
 * two independent unions agree only until one of them changes. Same
 * export-what-you-draw reasoning as `creationHandleRects` below, applied to
 * the vocabulary rather than the geometry.
 */
export type CreationHandleDirection = QuickCreateDirection

export const CREATION_HANDLE_DIRECTIONS: ReadonlyArray<CreationHandleDirection> =
  QUICK_CREATE_DIRECTIONS

/**
 * How far OUTSIDE each edge midpoint a creation handle's centre sits, in
 * screen pixels.
 *
 * This number exists to keep the creation handles clear of the `n`/`e`/`s`/
 * `w` resize grips, which sit exactly ON those midpoints. It must stay larger
 * than `HANDLE_SIZE / 2 + CREATION_HANDLE_HIT / 2` or the two hit rectangles
 * overlap and one gesture starts stealing the other's presses — a bug with no
 * visual symptom at all, since both affordances still look right.
 * `render.test.ts` asserts the separation rather than trusting this comment.
 */
export const CREATION_HANDLE_OFFSET = 22

/** Drawn diameter of a creation handle, in SCREEN pixels. */
export const CREATION_HANDLE_SIZE = 10

/**
 * Grabbable edge length of a creation handle, in SCREEN pixels.
 *
 * Deliberately much larger than the drawn size: 10px is the right visual
 * weight next to an 8px resize grip, and 10px is an unusable touch target.
 * `creationHandleRects` returns the HIT rect, because that is what input must
 * test — the drawn circle is decoration around it.
 */
export const CREATION_HANDLE_HIT = 28

/** Which END of a connector a grip belongs to. */
export type ConnectorEnd = 'source' | 'target'

export const CONNECTOR_ENDS: ReadonlyArray<ConnectorEnd> = ['source', 'target']

/** Drawn diameter of a connector endpoint grip, in SCREEN pixels. */
export const CONNECTOR_ENDPOINT_SIZE = 10

/**
 * Grabbable edge length of a connector endpoint grip, in SCREEN pixels.
 *
 * Larger than the drawn circle for the same reason a creation handle's is: 10px
 * is the right visual weight on a 2px line and an unusable touch target.
 */
export const CONNECTOR_ENDPOINT_HIT = 24

/** Outline weight on the element a dragged end would attach to, in SCREEN px. */
const ATTACH_CANDIDATE_WIDTH = 2

/** Diameter of the dot marking exactly where on the border it would land. */
const ATTACH_SPOT_SIZE = 9

/**
 * The two endpoint hit rectangles for a connector's drawn path, in SCREEN
 * space, or null when there is no path to grab.
 *
 * Takes the PATH rather than the connector, because the ends of the drawn line
 * are the only meaningful place to grab: an anchored end sits on an edge
 * midpoint, an unanchored one wherever the centre ray crosses the border, and
 * a free one at its own point. Deriving that here a second time is exactly the
 * drift this convention exists to prevent — `input` must test the rectangles
 * this function produced, and this function must describe the line that was
 * actually stroked.
 */
export function connectorEndpointRects(
  camera: Camera,
  path: ReadonlyArray<Point> | null | undefined,
): Record<ConnectorEnd, ScreenRect> | null {
  if (!path || path.length < 2) return null
  const half = CONNECTOR_ENDPOINT_HIT / 2
  const rectAt = (world: Point): ScreenRect => {
    const screen = worldToScreen(camera, world)
    return {
      x: screen.x - half,
      y: screen.y - half,
      width: CONNECTOR_ENDPOINT_HIT,
      height: CONNECTOR_ENDPOINT_HIT,
    }
  }
  return { source: rectAt(path[0]), target: rectAt(path[path.length - 1]) }
}

/**
 * The four creation-handle hit rectangles for a world rect, in SCREEN space.
 *
 * Exported for exactly the reason `handleRects` is: `use-canvas-input` must
 * hit-test the same rectangles that were drawn. Two implementations of "where
 * is the right-hand creation handle" would drift the moment either changed,
 * and the symptom — a marker that does not respond where it looks — is the
 * same class of bug as W1/W3.
 */
export function creationHandleRects(
  camera: Camera,
  rect: WorldRect,
): Record<CreationHandleDirection, ScreenRect> {
  const r = worldRectToScreen(camera, rect)
  const midX = r.x + r.width / 2
  const midY = r.y + r.height / 2
  const centres: Record<CreationHandleDirection, [number, number]> = {
    top: [midX, r.y - CREATION_HANDLE_OFFSET],
    right: [r.x + r.width + CREATION_HANDLE_OFFSET, midY],
    bottom: [midX, r.y + r.height + CREATION_HANDLE_OFFSET],
    left: [r.x - CREATION_HANDLE_OFFSET, midY],
  }
  const half = CREATION_HANDLE_HIT / 2
  const out = {} as Record<CreationHandleDirection, ScreenRect>
  for (const direction of CREATION_HANDLE_DIRECTIONS) {
    const [cx, cy] = centres[direction]
    out[direction] = {
      x: cx - half,
      y: cy - half,
      width: CREATION_HANDLE_HIT,
      height: CREATION_HANDLE_HIT,
    }
  }
  return out
}

/**
 * Which element should be showing creation handles, or null.
 *
 * Exported so input resolves the target the SAME way the renderer did —
 * handles drawn on one element and hit-tested against another is the
 * drift this whole export-what-you-draw convention exists to prevent.
 *
 * The suppression rules, all of which are "a gesture already owns the
 * pointer": mid-text-edit, mid-marquee, mid-draw, and mid-quick-create-drag.
 * Read-only needs no rule here because a read-only board can neither select
 * nor hover — `use-canvas-input` sends every press straight to pan — so both
 * inputs below are always empty.
 */
export function creationHandleTarget(
  scene: Scene,
  selection: RenderSelection,
): CanvasElement | null {
  if (selection.editing || selection.marquee || selection.draft) return null
  if (selection.quickCreate) return null

  const selected = [...selection.ids]
  const id =
    selected.length === 1
      ? selected[0]
      : selected.length === 0
        ? (selection.hoveredId ?? null)
        : null
  if (!id) return null

  const element = scene.byId.get(id) ?? null
  // A connector has no meaningful "same shape one gap to the right", and its
  // own bounds are a placeholder, so handles around it would sit at the
  // origin. Excluded outright.
  if (!element || element.connector) return null
  return element
}

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
 * Trace one shape kind's outline into the current path, in WORLD space.
 *
 * The counterpart of `hit-test.ts`'s per-kind containment, and the two must
 * describe the SAME region: a triangle traced apex-up here and hit-tested
 * apex-down there would look right and be unclickable. Each shape is
 * INSCRIBED in the element's rect — the rect is the resize box and the text
 * frame for every kind, and only the outline inside it differs.
 *
 * `rectangle` is absent on purpose: it is drawn with `fillRect`/`strokeRect`
 * in `drawShape` below rather than as a path, because those are the calls the
 * renderer has always made for it and the recording-stub tests assert on them
 * by name.
 */
function traceShapePath(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
): void {
  const { x, y, width, height } = element
  const cx = x + width / 2
  const cy = y + height / 2
  ctx.beginPath()
  switch (element.kind) {
    case 'ellipse':
      // Radii, not diameters — `ctx.ellipse` takes half-extents, and passing
      // the full width here draws a shape twice the size of its own box.
      ctx.ellipse(cx, cy, width / 2, height / 2, 0, 0, Math.PI * 2)
      break
    case 'diamond':
      ctx.moveTo(cx, y)
      ctx.lineTo(x + width, cy)
      ctx.lineTo(cx, y + height)
      ctx.lineTo(x, cy)
      break
    case 'triangle':
      ctx.moveTo(cx, y)
      ctx.lineTo(x + width, y + height)
      ctx.lineTo(x, y + height)
      break
    default:
      break
  }
  // Closed for every kind: an unclosed diamond or triangle strokes three of
  // its edges and leaves the fourth open, and fills a shape whose final edge
  // the browser has to guess at.
  ctx.closePath()
}

/**
 * Fill and stroke one shape element, honouring its style.
 *
 * `fill: 'none'` and `strokeWidth: 0` are both real, reachable styles — an
 * outline-only shape and a fill-only shape — so each half is guarded
 * independently rather than assumed.
 */
function drawShape(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
): void {
  const filled = element.style.fill !== 'none'
  const stroked = element.style.strokeWidth > 0
  if (element.kind === 'rectangle') {
    if (filled) {
      ctx.fillStyle = element.style.fill
      ctx.fillRect(element.x, element.y, element.width, element.height)
    }
    if (stroked) {
      ctx.strokeStyle = element.style.stroke
      ctx.lineWidth = element.style.strokeWidth
      ctx.strokeRect(element.x, element.y, element.width, element.height)
    }
    return
  }
  if (!filled && !stroked) return
  traceShapePath(ctx, element)
  if (filled) {
    ctx.fillStyle = element.style.fill
    ctx.fill()
  }
  if (stroked) {
    ctx.strokeStyle = element.style.stroke
    ctx.lineWidth = element.style.strokeWidth
    ctx.stroke()
  }
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
  if (isCanvasShapeKind(element.kind)) {
    drawShape(ctx, element)
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

/** Arrowhead length at a connector's target end, in WORLD units. */
export const CONNECTOR_ARROW_SIZE = 14

/**
 * Draw one connector in WORLD space — the caller has already applied the
 * camera transform, exactly as for `drawElement`.
 *
 * A connector is DATA, not an affordance, which is why it is drawn here under
 * the transform rather than in the screen-space overlay: its stroke should
 * thicken and thin with zoom the way a rectangle's border does. Handles and
 * selection outlines are the opposite case and stay in screen space.
 *
 * Returns whether anything was drawn. A null path is an ordinary board state,
 * not a fault — a deleted endpoint, or two elements sitting concentrically —
 * and it draws nothing rather than guessing at a position.
 */
function drawConnector(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
  scene: Scene,
): boolean {
  const link = element.connector
  if (!link) return false
  const path = connectorPathOf(scene, element)
  if (!path || path.length < 2) return false

  ctx.strokeStyle = element.style.stroke
  ctx.lineWidth = element.style.strokeWidth
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i += 1) {
    ctx.lineTo(path[i].x, path[i].y)
  }
  ctx.stroke()

  const head = arrowHead(path, CONNECTOR_ARROW_SIZE)
  if (head) {
    // Filled, and in the STROKE colour: an arrowhead painted in the element's
    // fill would be invisible, because the engine's default fill is a
    // near-transparent tint meant to sit behind text.
    ctx.fillStyle = element.style.stroke
    ctx.beginPath()
    ctx.moveTo(head[0].x, head[0].y)
    ctx.lineTo(head[1].x, head[1].y)
    ctx.lineTo(head[2].x, head[2].y)
    ctx.closePath()
    ctx.fill()
  }
  return true
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

/** Extra stroke width, in screen px, that marks a connector as selected. */
const CONNECTOR_SELECTION_WIDTH = 3

/**
 * Re-stroke a selected connector's own path in the accent colour.
 *
 * Screen space, like every other selection affordance: the highlight should
 * be the same visual weight at 0.1x and 2x zoom, whereas the connector's own
 * stroke underneath it scales because that stroke is data.
 */
function drawConnectorSelection(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
  scene: Scene,
  camera: Camera,
  accent: string,
): void {
  const link = element.connector
  if (!link) return
  const path = connectorPathOf(scene, element)
  if (!path || path.length < 2) return

  ctx.save()
  ctx.strokeStyle = accent
  ctx.lineWidth = CONNECTOR_SELECTION_WIDTH
  ctx.beginPath()
  const first = worldToScreen(camera, path[0])
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < path.length; i += 1) {
    const p = worldToScreen(camera, path[i])
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()

  // The two grips that MOVE an end. Hollow accent-ringed circles — deliberately
  // neither the resize grip's square nor the creation handle's filled `+`
  // circle, because all three can be on screen at once and they do different
  // things.
  const grips = connectorEndpointRects(camera, path)
  if (grips) {
    for (const end of CONNECTOR_ENDS) {
      const rect = grips[end]
      // ATTACHED reads as solid, FREE as hollow. Without the distinction a
      // connector gives no answer to "is this end actually joined to the
      // shape, or just lying on top of it?" — the two look identical the
      // moment a shape's edge happens to pass under a loose end.
      const attached = link[end].kind === 'element'
      ctx.beginPath()
      ctx.arc(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        CONNECTOR_ENDPOINT_SIZE / 2,
        0,
        Math.PI * 2,
      )
      ctx.fillStyle = attached ? accent : '#ffffff'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = accent
      // A free end also gets a dashed ring, so the difference survives a
      // theme where the accent and the page are close in value.
      ctx.setLineDash(attached ? [] : [3, 3])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}

/**
 * Highlight the element a dragged connector end would attach to, and mark the
 * exact point on its border where it would land.
 *
 * This is the answer to "will this connect, and where?" DURING the drag rather
 * than after it. Its ABSENCE is meaningful too: no highlight means the pointer
 * is over empty board, and releasing there detaches the end.
 *
 * Screen space, like every other affordance — an outline drawn in world units
 * would be hairline at 0.1x zoom and heavy at 2x.
 */
function drawAttachCandidate(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  element: CanvasElement,
  attach: ConnectorAttach,
  accent: string,
): void {
  const rect = worldRectToScreen(camera, element)
  ctx.save()
  ctx.strokeStyle = accent
  ctx.lineWidth = ATTACH_CANDIDATE_WIDTH
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

  const spot = worldToScreen(camera, attachPoint(element, attach))
  ctx.beginPath()
  ctx.arc(spot.x, spot.y, ATTACH_SPOT_SIZE / 2, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.restore()
}

/**
 * Draw the four directional creation handles around an element, in SCREEN
 * space.
 *
 * A filled accent circle with a light `+`, which is the INVERSE of the resize
 * grips' light square with an accent border. That contrast is functional, not
 * decorative: the two affordances sit within a few pixels of each other on
 * the same four edge midpoints, and a user has to be able to tell at a glance
 * which one resizes and which one creates.
 *
 * The circle is drawn at `CREATION_HANDLE_SIZE` but grabbed at
 * `CREATION_HANDLE_HIT` — `creationHandleRects` owns the latter, and input
 * uses it directly rather than re-deriving anything from what is drawn here.
 */
function drawCreationHandles(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  element: CanvasElement,
  accent: string,
  plus: string,
): void {
  const rects = creationHandleRects(camera, element)
  const radius = CREATION_HANDLE_SIZE / 2
  const arm = radius * 0.5

  ctx.save()
  for (const direction of CREATION_HANDLE_DIRECTIONS) {
    const rect = rects[direction]
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2

    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = plus
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx - arm, cy)
    ctx.lineTo(cx + arm, cy)
    ctx.moveTo(cx, cy - arm)
    ctx.lineTo(cx, cy + arm)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draw the dashed rubber band from a creation handle's source element to
 * wherever the pointer currently is.
 *
 * Dashed, and from the source's CENTRE rather than from the handle that was
 * grabbed: the gesture's meaning is "connect this element to whatever I drop
 * on", and anchoring at the centre reads that way at any angle, including
 * when the pointer has swung round to the opposite side of the element.
 *
 * Silently does nothing when the source has vanished mid-drag (a
 * collaborator's delete), which the gesture's own end handler also tolerates.
 */
function drawQuickCreatePreview(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  quickCreate: { fromId: string; toWorld: Point },
  accent: string,
): void {
  const source = scene.byId.get(quickCreate.fromId)
  if (!source) return
  const from = worldToScreen(camera, {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  })
  const to = worldToScreen(camera, quickCreate.toWorld)

  ctx.save()
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
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
    if (element.connector) {
      // A connector has no rectangle to outline — its stored bounds are a 1x1
      // placeholder that would draw a dot at the origin. It is highlighted by
      // re-stroking its own path instead, thickened and in the accent colour.
      drawConnectorSelection(ctx, element, scene, camera, chrome.accent)
      continue
    }
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
  //
  // Never for a connector: it has no independent bounds to resize, so
  // `handleRects` would place eight grips around its placeholder and every
  // one of them would drag something meaningless.
  if (selected.length === 1 && !selected[0].connector && !selection.editing) {
    const grips = handleRects(camera, selected[0])
    for (const handle of RESIZE_HANDLES) {
      const g = grips[handle]
      ctx.fillStyle = chrome.handleFill
      ctx.fillRect(g.x, g.y, g.width, g.height)
      ctx.strokeStyle = chrome.accent
      ctx.strokeRect(g.x + 0.5, g.y + 0.5, g.width - 1, g.height - 1)
    }
  }

  const handleTarget = creationHandleTarget(scene, selection)
  if (handleTarget) {
    drawCreationHandles(
      ctx,
      camera,
      handleTarget,
      chrome.accent,
      chrome.handleFill,
    )
  }

  if (selection.quickCreate) {
    drawQuickCreatePreview(ctx, scene, camera, selection.quickCreate, chrome.accent)
  }

  if (selection.connectorAttach) {
    const candidate = scene.byId.get(selection.connectorAttach.elementId)
    if (candidate) {
      drawAttachCandidate(
        ctx,
        camera,
        candidate,
        selection.connectorAttach.attach,
        chrome.accent,
      )
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
 * Amber rather than the selection accent (blue): a highlight reports "undo
 * just touched this", a distinct event from "this is selected", and reusing
 * the accent colour would make the two indistinguishable when both are true
 * at once. Fixed rather than themed — it needs to read clearly against
 * either background, the same reasoning `resolveTextColor` already uses for
 * the engine's one themed exception.
 */
export const HIGHLIGHT_COLOR = '#f59e0b'

/** Screen-space gap outside the element's own bounds, so the ring clears the resize grips instead of colliding with them. */
export const HIGHLIGHT_INSET = 4

/**
 * Draw the post-undo/redo highlight ring, in SCREEN space, after the camera
 * transform has been popped — same reasoning as `drawSelectionOverlay`: a
 * ring drawn in world space would be the wrong screen size at every zoom
 * except 1.
 *
 * Silently does nothing when the highlighted element no longer exists (a
 * refused undo whose target was deleted) or the caller's `intensity` has
 * already decayed to 0 — both are ordinary end states, not errors.
 */
function drawHighlight(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  highlight: RenderSelection['highlight'],
): void {
  if (!highlight) return
  const element = scene.byId.get(highlight.elementId)
  if (!element) return
  const intensity = Math.max(0, Math.min(1, highlight.intensity))
  if (intensity === 0) return

  const r = worldRectToScreen(camera, element)
  ctx.save()
  ctx.globalAlpha = intensity
  ctx.lineWidth = 3
  ctx.strokeStyle = HIGHLIGHT_COLOR
  ctx.strokeRect(
    r.x - HIGHLIGHT_INSET,
    r.y - HIGHLIGHT_INSET,
    r.width + HIGHLIGHT_INSET * 2,
    r.height + HIGHLIGHT_INSET * 2,
  )
  ctx.restore()
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

  // TWO PASSES, and the order is load-bearing rather than cosmetic.
  //
  // Every connector paints first, so connectors always sit BENEATH every
  // rectangle and text element — the way they do in FigJam, and without
  // needing a z-index convention that nobody can see and that a user's
  // bring-to-front would break. This is a deliberate departure from "paint in
  // z-order", which still governs everything within each pass.
  //
  // `hit-test.ts`'s `hitTest` runs its connector scan second for exactly this
  // reason: hit-testing has to agree with what the user can see, or clicking
  // a rectangle sometimes selects a connector drawn behind it. Change the
  // order in one place and the other must change too.
  for (const element of scene.elements) {
    if (element.connector) drawConnector(ctx, element, scene)
  }
  for (const element of scene.elements) {
    if (element.connector) continue
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
  drawHighlight(ctx, scene, camera, selection.highlight)
}

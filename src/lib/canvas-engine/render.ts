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
import {
  DEFAULT_ELEMENT_STYLE,
  effectiveCornerRadius,
  isCanvasShapeKind,
} from './scene'
import {
  arrowHead,
  attachPoint,
  bendMidpoint,
  curveEndDirection,
} from './connector-geometry'
import { connectorCurveOf, connectorPathOf } from './hit-test'
import { QUICK_CREATE_DIRECTIONS } from './quick-create'
import { DEFAULT_TEXT_STYLE, layoutText, pointFromCaret } from './text-layout'
import type { ConnectorCurve } from './connector-geometry'
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

/**
 * How far a creation handle REACHES from its element's edge, in screen px —
 * the outer edge of the furthest grab rectangle.
 *
 * Derived, never restated, because a second copy of this number is how the
 * region below and the rectangles above start describing different places.
 */
export const CREATION_HANDLE_REACH =
  CREATION_HANDLE_OFFSET + CREATION_HANDLE_HIT / 2

/**
 * Is a screen point close enough to this element to KEEP its creation handles
 * showing?
 *
 * The distinction that matters: `creationHandleRects` is what GRABS a handle,
 * this is what keeps the handles up long enough to reach one. They were the
 * same test until now, and that was the bug — a handle's grab rect spans
 * `CREATION_HANDLE_REACH` out from an edge but only `CREATION_HANDLE_HIT / 2`
 * ALONG it, so the pointer leaving a hovered element had to cross a dead ring
 * (nothing owns the first `CREATION_HANDLE_OFFSET - CREATION_HANDLE_HIT / 2`
 * pixels) down a corridor aimed at one edge midpoint. Every other approach —
 * diagonal, near a corner, anywhere off-centre along an edge — dropped the
 * hover deterministically, and once dropped it could not come back without
 * re-entering the element. A hover-shown handle was effectively unclickable.
 *
 * The region is the element's bounds inflated by the handles' own reach, so
 * it covers every handle and every gap between them with one predicate and no
 * corridor to aim down. In SCREEN space, like the constants it is built from:
 * the handles are a fixed on-screen size at every zoom, so the region that
 * keeps them up has to be too.
 */
export function withinCreationHandleReach(
  camera: Camera,
  rect: WorldRect,
  screen: Point,
): boolean {
  const r = worldRectToScreen(camera, rect)
  return (
    screen.x >= r.x - CREATION_HANDLE_REACH &&
    screen.x <= r.x + r.width + CREATION_HANDLE_REACH &&
    screen.y >= r.y - CREATION_HANDLE_REACH &&
    screen.y <= r.y + r.height + CREATION_HANDLE_REACH
  )
}

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
export const ATTACH_CANDIDATE_WIDTH = 3

/**
 * How far outside the candidate's own outline its highlight is drawn, in
 * SCREEN px — enough that the ring sits clear of the shape's own stroke
 * instead of being painted over it and read as a thicker border.
 */
export const ATTACH_CANDIDATE_INSET = 3

/**
 * Opacity of the tint filling the candidate.
 *
 * The ring alone is what this used to be, and a ring is easy to miss on a
 * busy board mid-drag — the eye is following the line, not the shape. Tinting
 * the whole target makes "this one" readable in peripheral vision, which is
 * where it actually has to be read. Low enough that the shape's own fill and
 * its text stay legible underneath.
 */
export const ATTACH_CANDIDATE_WASH = 0.18

/** Diameter of the dot marking exactly where on the border it would land. */
export const ATTACH_SPOT_SIZE = 9

/** Rim weight on that dot, so it stays visible against the ring behind it. */
const ATTACH_SPOT_RIM_WIDTH = 2

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

/** Drawn width of the diamond-shaped bend grip, corner to corner, in SCREEN px. */
export const CONNECTOR_BEND_SIZE = 11

/**
 * Grabbable edge length of the bend grip, in SCREEN pixels.
 *
 * SMALLER than `CONNECTOR_ENDPOINT_HIT`, and that is the whole reason it is a
 * separate constant. On a short connector the bend grip and the two endpoint
 * grips crowd together, and the ends are the more precise target — a
 * mis-grabbed end is a visibly wrong attachment, a mis-grabbed bend is merely
 * a curve the user did not ask for. Input tests the ends FIRST for the same
 * reason; the smaller rect is the belt to that braces.
 */
export const CONNECTOR_BEND_HIT = 20

/**
 * The bend hit rectangle for a connector's drawn path, in SCREEN space, or
 * null when there is no path to grab.
 *
 * Mirrors `connectorEndpointRects` in every respect that matters: it takes the
 * PATH that was actually stroked, it is exported so `use-canvas-input` tests
 * the rectangle this function produced rather than a second derivation of
 * "where the middle of the line is", and it is the only place the bend grip's
 * screen geometry exists. A curve's middle is not a point either side can
 * compute independently — it depends on the routing, the tension clamp and the
 * curvature all at once — so two derivations here would drift immediately.
 *
 * Note this says nothing about ROUTING. The caller decides whether a bend grip
 * belongs on screen at all (only `curved` has a bow to drag); this function
 * only answers where it would go.
 */
export function connectorBendRect(
  camera: Camera,
  path: ReadonlyArray<Point> | null | undefined,
): ScreenRect | null {
  const world = bendMidpoint(path)
  if (!world) return null
  const screen = worldToScreen(camera, world)
  const half = CONNECTOR_BEND_HIT / 2
  return {
    x: screen.x - half,
    y: screen.y - half,
    width: CONNECTOR_BEND_HIT,
    height: CONNECTOR_BEND_HIT,
  }
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
export function worldRectToScreen(camera: Camera, rect: WorldRect): ScreenRect {
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

/** Lay out an element's text with the element's own font size and alignment. */
export function layoutElementText(
  element: CanvasElement,
  measure: TextMeasurer,
): TextLayout {
  const frame = textFrame(element)
  return layoutText(
    element.text ?? '',
    {
      ...DEFAULT_TEXT_STYLE,
      fontSize: element.style.fontSize,
      align: element.style.textAlign,
    },
    frame.maxWidth,
    measure,
  )
}

/**
 * Where an element's text block STARTS vertically, in WORLD units.
 *
 * The counterpart to `textFrame` for the one offset that cannot be computed
 * alongside it: vertical alignment needs the laid-out height, and the layout
 * needs `textFrame`'s `maxWidth` first. So the frame answers "where does the
 * text begin and how wide may it run", and this answers "and how far down",
 * once there is a layout to measure.
 *
 * The SAME rule `textFrame` states applies here and matters more, because
 * there are four call sites rather than three: drawing, the caret, click-to-
 * caret and the IME anchor must all use this. A renderer that centred and an
 * input hook that did not would put the caret on a different line from the
 * glyphs.
 *
 * Extra space is clamped at zero, so a block TALLER than its box always starts
 * at the top whatever the alignment says — the same unclipped overflow the top
 * of the box has always shown, rather than text creeping up out of the shape.
 */
export function textOriginY(
  element: CanvasElement,
  layout: TextLayout,
): number {
  const available = Math.max(0, element.height - TEXT_PADDING * 2)
  const slack = Math.max(0, available - layout.height)
  const align = element.style.verticalAlign
  const offset = align === 'middle' ? slack / 2 : align === 'bottom' ? slack : 0
  return element.y + TEXT_PADDING + offset
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
 * `rectangle` appears here ONLY when it has a corner radius. A square one is
 * drawn with `fillRect`/`strokeRect` in `drawShape` below, because those are
 * the calls the renderer has always made for it and the recording-stub tests
 * assert on them by name; a rounded one has no rect-call equivalent and has
 * to be traced.
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
    case 'rectangle':
      // Only ever reached with a NON-ZERO radius — `drawShape` sends a square
      // rectangle down the `fillRect`/`strokeRect` path instead. Traced by
      // hand rather than through `ctx.roundRect`, which the recording-stub
      // context used by the tests does not implement and which would put the
      // corner arithmetic somewhere `elementContainsPoint` cannot mirror it.
      {
        const r = effectiveCornerRadius(element)
        const right = x + width
        const bottom = y + height
        ctx.moveTo(x + r, y)
        ctx.lineTo(right - r, y)
        ctx.arcTo(right, y, right, y + r, r)
        ctx.lineTo(right, bottom - r)
        ctx.arcTo(right, bottom, right - r, bottom, r)
        ctx.lineTo(x + r, bottom)
        ctx.arcTo(x, bottom, x, bottom - r, r)
        ctx.lineTo(x, y + r)
        ctx.arcTo(x, y, x + r, y, r)
      }
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
  // A SQUARE rectangle keeps `fillRect`/`strokeRect`: those are the calls the
  // renderer has always made for it, `traceShapePath` documents their absence
  // from itself, and the recording-stub tests assert on them by name. A
  // ROUNDED one has to become a path — there is no `fillRoundRect` — so the
  // radius decides which of the two ways this kind is drawn.
  if (element.kind === 'rectangle' && effectiveCornerRadius(element) === 0) {
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
  const originY = textOriginY(element, layout)

  ctx.fillStyle = resolveTextColor(element.style, theme)
  ctx.font = canvasFont(element.style.fontSize)
  ctx.textBaseline = 'top'
  // Still 'left', under every alignment. The horizontal offset is already in
  // each line's `carets[0]` — the layout owns it, so that the caret and the
  // glyphs cannot disagree about where the line starts. Handing the alignment
  // to `ctx.textAlign` instead would move the glyphs and leave the caret math
  // behind.
  ctx.textAlign = 'left'
  for (let i = 0; i < layout.lines.length; i += 1) {
    const line = layout.lines[i]
    ctx.fillText(
      line.text,
      frame.x + line.carets[0],
      originY + i * layout.lineHeight,
    )
  }
  // Returned so `drawScene` can hand it to `drawCaret` instead of paying for
  // a second layout of the same string on the same frame.
  return layout
}

/**
 * Length of ONE arrowhead barb at a connector's target end, in WORLD units.
 *
 * The barb, not the head's reach back along the shaft: `arrowHead` splays the
 * barbs by `ARROW_HALF_ANGLE`, so the head reaches back less than this.
 */
export const CONNECTOR_ARROW_SIZE = 14

/**
 * Lay a `ConnectorCurve` into the current path as the cubic it is.
 *
 * `project` is applied to the CONTROL POINTS, not to a flattened sample, and
 * that is exact rather than close: `worldToScreen` is affine, and the image of
 * a bezier under an affine map is the bezier through the images of its control
 * points. So the screen-space selection halo traces the identical curve the
 * world-space stroke does, at any zoom, with no second flattening to disagree
 * about.
 *
 * Assumes `ctx.beginPath()` has already been called — same contract as the
 * `moveTo`/`lineTo` walk it replaces.
 */
function traceCurve(
  ctx: CanvasRenderingContext2D,
  curve: ConnectorCurve,
  project: (point: Point) => Point = (point) => point,
): void {
  const from = project(curve.from)
  const c0 = project(curve.c0)
  const c1 = project(curve.c1)
  const to = project(curve.to)
  ctx.moveTo(from.x, from.y)
  ctx.bezierCurveTo(c0.x, c0.y, c1.x, c1.y, to.x, to.y)
}

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

  // A `curved` connector is stroked as the cubic it IS, not as the 24-segment
  // sample of it that everything else reads. The sample count is fixed in
  // world space, so every chord in it grows on screen as the camera zooms in;
  // walking it drew a visible polygon at any real magnification.
  // `bezierCurveTo` is resolution-independent — the curve is exact at 800% for
  // the same one path command it costs at 100%.
  const curve = connectorCurveOf(scene, element)

  ctx.strokeStyle = element.style.stroke
  ctx.lineWidth = element.style.strokeWidth
  ctx.beginPath()
  if (curve) {
    traceCurve(ctx, curve)
  } else {
    ctx.moveTo(path[0].x, path[0].y)
    for (let i = 1; i < path.length; i += 1) {
      ctx.lineTo(path[i].x, path[i].y)
    }
  }
  ctx.stroke()

  // Oriented off the curve's exact arrival tangent where there is one, which
  // is the target face's own normal reversed — so the head lands square to the
  // shape rather than square to the last sampled chord. See
  // `curveEndDirection`.
  const head = arrowHead(
    path,
    CONNECTOR_ARROW_SIZE,
    curve ? curveEndDirection(curve) : null,
  )
  if (head) {
    // An OPEN line arrowhead: the two barbs stroked THROUGH the tip, with no
    // closePath and no fill. `arrowHead` returns [tip, barbA, barbB], so the
    // chevron is drawn barbA -> tip -> barbB.
    //
    // It reuses the strokeStyle and lineWidth already set for the line above,
    // which keeps the head welded to its connector at every zoom and in every
    // colour. A FILLED head would additionally have to be painted in the
    // stroke colour rather than the element's own fill, because the engine's
    // default fill is a near-transparent tint meant to sit behind text -- not
    // a concern once the head is stroked.
    //
    // lineJoin/lineCap are restored: this ctx is shared with every element
    // drawn later in the same frame.
    const priorJoin = ctx.lineJoin
    const priorCap = ctx.lineCap
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(head[1].x, head[1].y)
    ctx.lineTo(head[0].x, head[0].y)
    ctx.lineTo(head[2].x, head[2].y)
    ctx.stroke()
    ctx.lineJoin = priorJoin
    ctx.lineCap = priorCap
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
  // `local.x` is already alignment-shifted (it comes from the line's carets);
  // only the vertical origin has to be resolved here.
  const originY = textOriginY(element, layout)

  ctx.strokeStyle = CHROME[theme].text
  ctx.lineWidth = 1 / camera.zoom
  ctx.beginPath()
  ctx.moveTo(frame.x + local.x, originY + local.y)
  ctx.lineTo(frame.x + local.x, originY + local.y + local.height)
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
  /**
   * The theme's page-coloured chrome fill (`CHROME[theme].handleFill`), used
   * for the bend diamond's rim. Passed in rather than read from a module-level
   * palette here for the same reason `accent` is: this function is handed
   * resolved colours and never learns which theme is active.
   */
  rim: string,
): void {
  const link = element.connector
  if (!link) return
  const path = connectorPathOf(scene, element)
  if (!path || path.length < 2) return

  const curve = connectorCurveOf(scene, element)

  ctx.save()
  ctx.strokeStyle = accent
  ctx.lineWidth = CONNECTOR_SELECTION_WIDTH
  ctx.beginPath()
  if (curve) {
    // The same two cubics `drawConnector` strokes, projected control point by
    // control point — see `traceCurve`. Flattening here instead would put a
    // faceted halo under a smooth line, and the mismatch widens with the zoom.
    traceCurve(ctx, curve, (point) => worldToScreen(camera, point))
  } else {
    const first = worldToScreen(camera, path[0])
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < path.length; i += 1) {
      const p = worldToScreen(camera, path[i])
      ctx.lineTo(p.x, p.y)
    }
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

  // The grip that BENDS the line. A DIAMOND — a fourth silhouette, because by
  // now four affordances can share a screen and the endpoint note above only
  // accounted for three: the resize grip's axis-aligned square, the creation
  // handle's filled `+` circle, the endpoint's hollow-or-solid ring, and this.
  // A fifth circle would have been indistinguishable from an endpoint grip at
  // a glance, and a second square from a resize grip, so the one silhouette
  // left that survives being 11px wide is a square turned 45 degrees.
  //
  // `curved` ONLY, matching `connectorPath`: a straight line and an elbow have
  // no bow to drag, so a grip on them would be an affordance that does
  // nothing. Input gates the press on the same condition — export-what-you-
  // draw in both directions, the same rule the resize-grip block obeys for a
  // connector's placeholder bounds.
  if (link.routing === 'curved') {
    const bend = connectorBendRect(camera, path)
    if (bend) {
      const cx = bend.x + bend.width / 2
      const cy = bend.y + bend.height / 2
      const reach = CONNECTOR_BEND_SIZE / 2
      ctx.beginPath()
      ctx.moveTo(cx, cy - reach)
      ctx.lineTo(cx + reach, cy)
      ctx.lineTo(cx, cy + reach)
      ctx.lineTo(cx - reach, cy)
      ctx.closePath()
      // Filled accent with a light rim, the same figure/ground inversion the
      // creation handle uses against the resize grip — the rim is what keeps
      // it visible where the diamond sits on top of the accent-coloured
      // selection stroke it is centred on.
      ctx.fillStyle = accent
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = rim
      ctx.stroke()
    }
  }
  ctx.restore()
}

/**
 * Highlight the element the connector being dragged would attach to, and mark
 * the exact point on its border where it would land.
 *
 * This is the answer to "will this connect, and where?" DURING the drag rather
 * than after it. Both drags that produce a connector feed it — a connector END
 * and a creation-handle drag — and its ABSENCE means something different to
 * each: releasing a connector end over empty board DETACHES it, while
 * releasing a creation-handle drag there CREATES a new element.
 *
 * Tinted as well as ringed. A ring alone is easy to miss mid-gesture, when the
 * eye is following the line rather than the shape, and the creation-handle
 * drag made that expensive — a miss there does not fail quietly, it leaves a
 * stray element behind that costs an undo.
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
  rim: string,
): void {
  const rect = worldRectToScreen(camera, element)
  const halo = {
    x: rect.x - ATTACH_CANDIDATE_INSET,
    y: rect.y - ATTACH_CANDIDATE_INSET,
    width: rect.width + ATTACH_CANDIDATE_INSET * 2,
    height: rect.height + ATTACH_CANDIDATE_INSET * 2,
  }
  ctx.save()

  // A rectangle and a text block ARE their box, and keep the `fillRect` /
  // `strokeRect` pair the renderer has always used for them. Every other kind
  // is highlighted on its DRAWN outline, because that outline is what the drop
  // is tested against: a box around an ellipse would promise the four corners
  // that a release there does not accept, which is the same
  // export-what-you-draw lie in a different costume.
  const boxed = element.kind === 'rectangle' || element.kind === 'text'
  ctx.fillStyle = accent
  ctx.strokeStyle = accent
  ctx.lineWidth = ATTACH_CANDIDATE_WIDTH
  if (boxed) {
    ctx.globalAlpha = ATTACH_CANDIDATE_WASH
    ctx.fillRect(halo.x, halo.y, halo.width, halo.height)
    ctx.globalAlpha = 1
    ctx.strokeRect(halo.x, halo.y, halo.width, halo.height)
  } else {
    // Traced in SCREEN space from a screen-sized copy of the element — the
    // whole overlay is drawn with the camera transform already popped, and a
    // world-space outline would be hairline at 0.1x zoom.
    traceShapePath(ctx, { ...element, ...halo })
    ctx.globalAlpha = ATTACH_CANDIDATE_WASH
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.stroke()
  }

  const spot = worldToScreen(camera, attachPoint(element, attach))
  ctx.beginPath()
  ctx.arc(spot.x, spot.y, ATTACH_SPOT_SIZE / 2, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.lineWidth = ATTACH_SPOT_RIM_WIDTH
  ctx.strokeStyle = rim
  ctx.stroke()
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
      drawConnectorSelection(
        ctx,
        element,
        scene,
        camera,
        chrome.accent,
        chrome.handleFill,
      )
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

  // Grips on EVERY selected element — one selected element or ten, the mark
  // is the same one a click puts on a shape. They only resize on a selection
  // of exactly one, which is what `use-canvas-input` hit-tests; on a
  // multi-selection they report "selected" and a press on one falls through
  // to the move gesture. Grips used to be drawn for a single selection only,
  // which left a marquee looking like it had selected nothing: the outline
  // above is stroked in `chrome.accent`, and that IS
  // `DEFAULT_ELEMENT_STYLE.stroke`, so a default-styled rectangle had its own
  // border repainted the colour it already was.
  //
  // Never for a connector: it has no independent bounds, so `handleRects`
  // would pile all eight onto its 1x1 placeholder.
  if (!selection.editing) {
    for (const element of selected) {
      if (element.connector) continue
      const grips = handleRects(camera, element)
      for (const handle of RESIZE_HANDLES) {
        const g = grips[handle]
        ctx.fillStyle = chrome.handleFill
        ctx.fillRect(g.x, g.y, g.width, g.height)
        ctx.strokeStyle = chrome.accent
        ctx.strokeRect(g.x + 0.5, g.y + 0.5, g.width - 1, g.height - 1)
      }
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
    drawQuickCreatePreview(
      ctx,
      scene,
      camera,
      selection.quickCreate,
      chrome.accent,
    )
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
        chrome.handleFill,
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
 * colour: the surface colour and the dot grid are themed CSS backgrounds on
 * the elements BEHIND the canvas (`CanvasBoard.tsx`), which is how the board
 * follows light/dark mode without the renderer knowing anything about design
 * tokens, and how the grid costs nothing per frame. See `grid.ts`.
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

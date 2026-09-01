// src/components/whiteboard/CanvasNodeLayer.tsx
// Hybrid canvas rendering (GH #142 → canvas migration). Draws every table as
// canvas draw calls on a SINGLE <canvas> that pans/zooms with React Flow's own
// viewport transform — replacing ~306 DOM nodes/table (11,940 for 39 tables)
// with one bitmap. This is the Figma model: canvas paints the diagram, DOM is
// reserved for the table the user is actively editing (added in a later step).
//
// STEP 1 (this file): non-destructive foundation. Unconditional on the main
// board (canvas-unconditional-default), it renders as an overlay so the
// drawing + transform-sync can be verified against the live DOM before the
// DOM node bodies are swapped off. No interaction yet — React Flow still owns
// pan/zoom/drag/selection/edges underneath.
//
// It lives INSIDE <ReactFlow> (a pane-fixed child, like <Background>), so it can
// read the viewport transform from the store and draw in screen space itself.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useReactFlow, useStore } from '@xyflow/react'
import { useWhiteboardPermissions } from './whiteboard-permissions-context'
import type {
  RelationshipEdgeData,
  TableNodeData,
} from '@/lib/react-flow/types'
import { useCanvasEdit } from '@/lib/react-flow/canvas-mode'
import {
  BADGE_ZONE,
  HEADER_H,
  NOTE_RESERVE,
  PAD_X,
  ROW_H,
  getEffectiveShowMode,
  getVisibleColumnsForShowMode,
} from '@/lib/react-flow/canvas-node-geometry'
import { getCachedTableWidth } from '@/lib/react-flow/canvas-node-metrics'
import {
  LOD_ZOOM_THRESHOLD,
  useForceFullDetail,
} from '@/lib/react-flow/level-of-detail'
import { createColumnHandleId } from '@/lib/react-flow/edge-routing'
import { useTheme } from '@/hooks/use-theme'

// Safe-corridor tuning (bug fix: canvas-handle-visibility) — see the
// `lastInsideRef`/`corridorRef` doc comment inside CanvasNodeLayer for the
// full mechanism. World units (unaffected by zoom, same space the draw loop
// paints in).
//
// How far (perpendicular to the row→dot direction) the wedge flares at the
// dot end — generous enough that a diagonal exit through the row's TOP or
// BOTTOM edge (not just its left/right edge) still lands inside the wedge.
const CORRIDOR_FLARE = ROW_H
// Backstop only (not the primary mechanism, which is the geometric wedge
// test below) — disarms a corridor whose cursor has been in transit this
// long without either arriving at the dot or leaving the wedge, e.g. a
// pointer parked mid-transit.
const CORRIDOR_TIMEOUT_MS = 600
// Once the cursor is this close to the dot's own center, treat it as
// "arrived" — armed unconditionally (no wedge/timeout check), matching the
// dot's own real hit-radius (drawHandleDot's visual size + the DOM
// handle's actual hit box).
const ARRIVED_RADIUS = 14

interface ThemeColors {
  bg: string
  border: string
  headerBg: string
  headerText: string
  text: string
  pk: string
  fk: string
  /** Constraint-badge colors — mirror the DOM ColumnRow's ConstraintBadges
   * (N = nullable, U = unique) so canvas rows show the SAME per-field
   * constraints the DOM does. PK/FK reuse the pk/fk vars above. */
  nullable: string
  unique: string
  /** Comment badge accent (tactical plan: canvas-table-affordances) — same
   * `--rf-edge-stroke-selected` var the DOM unresolved-comment badge uses
   * (TableNode.tsx), so the canvas glyph and the DOM badge never disagree
   * on color. */
  accent: string
  /** Drag-to-connect handle dot colors (bug fix: canvas-handle-visibility) —
   * same `--rf-handle-bg`/`--rf-handle-border`/`--rf-handle-hover-bg`/
   * `--rf-handle-hover-border` vars react-flow-theme.css's
   * `.column-row:hover > .react-flow__handle` rules read, so the canvas-
   * painted dot and the (invisible but still-live) DOM handle never disagree
   * on color between light/dark themes. */
  handleBg: string
  handleBorder: string
  handleHoverBg: string
  handleHoverBorder: string
}

function readColors(el: HTMLElement): ThemeColors {
  const s = getComputedStyle(el)
  const v = (name: string, fallback: string) =>
    s.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--rf-table-bg', '#ffffff'),
    border: v('--rf-table-border', '#e5e7eb'),
    headerBg: v('--rf-table-header-bg', '#f9fafb'),
    headerText: v('--rf-table-header-text', '#111827'),
    text: v('--rf-table-text', '#374151'),
    pk: v('--rf-primary-key-color', '#3b82f6'),
    fk: v('--rf-foreign-key-color', '#10b981'),
    nullable: v('--rf-nullable-color', '#94a3b8'),
    unique: v('--rf-unique-color', '#10b981'),
    accent: v('--rf-edge-stroke-selected', '#6366f1'),
    handleBg: v('--rf-handle-bg', '#ffffff'),
    handleBorder: v('--rf-handle-border', '#9ca3af'),
    handleHoverBg: v('--rf-handle-hover-bg', '#3b82f6'),
    handleHoverBorder: v('--rf-handle-hover-border', '#2563eb'),
  }
}

/**
 * Canvas table affordance icons (tactical plan: canvas-table-affordances) —
 * lucide-inspired glyphs drawn centered on (cx, cy). They are HOLLOW (outline
 * stroke) by default and FILLED only when hovered (canvas hover hit-testing —
 * see `hoveredIcon` below), always in a single monochrome `color` (the theme
 * text color = near-black in light mode, near-white in dark mode) so they read
 * in both themes — never a color fill. Acting on them is via the table's
 * right-click context menu (Note/Comment) + click hit-testing.
 */
const ICON_STROKE = 1.4

function drawNoteGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  filled: boolean,
) {
  // Sticky note: rounded square with a folded bottom-right corner.
  const s = 11
  const x0 = cx - s / 2
  const y0 = cy - s / 2
  const fold = 3.5
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x0 + 1.5, y0)
  ctx.lineTo(x0 + s, y0)
  ctx.lineTo(x0 + s, y0 + s - fold)
  ctx.lineTo(x0 + s - fold, y0 + s)
  ctx.lineTo(x0 + 1.5, y0 + s)
  ctx.arcTo(x0, y0 + s, x0, y0 + s - 1.5, 1.5)
  ctx.lineTo(x0, y0 + 1.5)
  ctx.arcTo(x0, y0, x0 + 1.5, y0, 1.5)
  ctx.closePath()
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = ICON_STROKE
    ctx.stroke()
    // Fold detail.
    ctx.beginPath()
    ctx.moveTo(x0 + s - fold, y0 + s)
    ctx.lineTo(x0 + s - fold, y0 + s - fold)
    ctx.lineTo(x0 + s, y0 + s - fold)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCommentGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  bg: string,
  count: number,
  filled: boolean,
) {
  // Speech bubble: rounded rect body + a small tail at the bottom-left.
  const w = 12
  const h = 9
  const r = 2.5
  const x0 = cx - w / 2
  const y0 = cy - h / 2 - 1
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x0 + r, y0)
  ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r)
  ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r)
  ctx.lineTo(x0 + 4, y0 + h)
  ctx.lineTo(x0 + 2, y0 + h + 3) // tail
  ctx.lineTo(x0 + 2, y0 + h)
  ctx.arcTo(x0, y0 + h, x0, y0, r)
  ctx.arcTo(x0, y0, x0 + w, y0, r)
  ctx.closePath()
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = ICON_STROKE
    ctx.stroke()
  }
  // Unresolved count digit, centered in the bubble — inverted against the
  // fill on hover so it stays legible.
  if (count > 0) {
    ctx.fillStyle = filled ? bg : color
    ctx.font = '700 8px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(count > 9 ? '9+' : String(count), cx, y0 + h / 2 + 0.5)
  }
  ctx.restore()
}

function drawRelationsGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  filled: boolean,
) {
  // Link (lucide "link-2"): two rounded link halves joined by a bar.
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const half = 5
  if (filled) {
    // Filled: two solid rounded-rect link ends + connecting bar.
    ctx.fillStyle = color
    roundRect(ctx, cx - half - 1, cy - 3, 5, 6, 2.5)
    ctx.fill()
    roundRect(ctx, cx + half - 4, cy - 3, 5, 6, 2.5)
    ctx.fill()
    ctx.fillRect(cx - 3, cy - 1, 6, 2)
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = ICON_STROKE
    // left half-link
    ctx.beginPath()
    ctx.arc(cx - 2.5, cy, 3.2, Math.PI * 0.5, Math.PI * 1.5)
    ctx.stroke()
    // right half-link
    ctx.beginPath()
    ctx.arc(cx + 2.5, cy, 3.2, Math.PI * 1.5, Math.PI * 0.5)
    ctx.stroke()
    // connecting bar
    ctx.beginPath()
    ctx.moveTo(cx - 2, cy)
    ctx.lineTo(cx + 2, cy)
    ctx.stroke()
  }
  ctx.restore()
}

/** Fixed per-glyph footprint (px, at zoom=1) in the header's right-aligned
 * glyph strip — used both to draw each glyph and to reserve space out of
 * the header name's `truncateToWidth` max width so the name never overlaps
 * the strip. */
const GLYPH_BOX = 20

/**
 * Subtle rounded "chip" drawn behind an affordance icon while it's hovered, so
 * the icon reads as a real icon-button (not a bare glyph). Monochrome + low
 * alpha so it works in both themes.
 */
function drawIconHoverChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  size: number,
) {
  ctx.save()
  ctx.globalAlpha = 0.14
  ctx.fillStyle = color
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 4)
  ctx.fill()
  ctx.restore()
}

/**
 * Draw a drag-to-connect handle dot at world-space (cx, cy) — the canvas
 * equivalent of react-flow-theme.css's `.react-flow__handle::before` rule
 * (bug fix: canvas-handle-visibility). CSS renders a 10px-diameter,
 * border-box circle with a 2px border (Tailwind preflight sets
 * `box-sizing: border-box` globally, so the border eats INTO the 10px, not
 * around it: a 3px-radius `bg`-filled core plus a 2px `border` ring out to
 * radius 5). Mirrored here as an r=4 filled disc (`bg`) painted first, then
 * a 2px stroke (`border`) centered on that same r=4 path — the stroke
 * straddles radius 3..5 and opaquely overwrites the fill in that band,
 * leaving an r=3 `bg` core exactly like the CSS version. Sizes are in WORLD
 * units (not divided by zoom, unlike the table border's `1 / zoom` hairline
 * trick elsewhere in this file) because the real DOM handle is inside the
 * SAME `.react-flow__viewport` zoom transform as everything else and scales
 * with it — matching that, not staying a constant screen size, is what
 * keeps this paint pixel-aligned with the real (invisible) DOM handle underneath.
 */
function drawHandleDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bg: string,
  border: string,
) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = border
  ctx.stroke()
  ctx.restore()
}

/** Sign of the cross product (p − a) × (b − a) — the building block
 * `pointInConvexPolygon` below uses to test which side of edge `a→b` point
 * `p` falls on (bug fix: canvas-handle-visibility "safe corridor"). */
function crossSign(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

/**
 * Point-in-convex-polygon test (same-sign-of-every-edge-cross-product
 * technique, vertices in either consistent winding order) — used to keep a
 * handle dot (and its now-armed real DOM handle) alive while the cursor
 * transits from a hovered row out to that dot, which sits OUTSIDE the row's
 * own box. This is the classic "safe triangle" hoverable-submenu technique,
 * generalized to a TRAPEZOID: the wedge's near edge spans the row's own
 * full height at the exit side (not a single exit pixel — exiting anywhere
 * along that edge counts, including the corners), widening to a larger
 * flared span at the dot end. That near-edge height is what tolerates a
 * diagonal exit through the row's top/bottom edge, not just its left/right
 * edge, immediately after leaving.
 */
function pointInConvexPolygon(
  p: { wx: number; wy: number },
  vertices: ReadonlyArray<{ wx: number; wy: number }>,
): boolean {
  let hasNeg = false
  let hasPos = false
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const d = crossSign(p.wx, p.wy, a.wx, a.wy, b.wx, b.wy)
    if (d < 0) hasNeg = true
    if (d > 0) hasPos = true
  }
  return !(hasNeg && hasPos)
}

/**
 * Truncate `text` with a trailing ellipsis so it fits within `maxWidth`,
 * measured with the CURRENT `ctx.font` (caller must set font before calling
 * — measurement must match the paint call's own font). Replaces reliance on
 * `fillText`'s `maxWidth` argument, which condenses/squishes glyphs to fit
 * rather than clipping the text (tactical plan Phase 4, "canvas text
 * ellipsis"). Returns `text` unchanged when it already fits.
 */
function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  // Binary search the longest prefix (+ ellipsis) that still fits.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = text.slice(0, mid) + ellipsis
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Draw one constraint badge (PK / FK / N / U) in a column row, mirroring the
 * DOM ColumnRow's `ConstraintBadges`: filled with `activeColor` + white text
 * when the constraint is set, transparent with a faint outline + faint label
 * when not. Returns the badge's width so the caller can advance x.
 */
function drawConstraintBadge(
  ctx: CanvasRenderingContext2D,
  bx: number,
  cy: number,
  label: string,
  active: boolean,
  activeColor: string,
  borderColor: string,
  textColor: string,
): number {
  ctx.save()
  ctx.font = '700 9px Inter, system-ui, sans-serif'
  const w = Math.max(16, Math.ceil(ctx.measureText(label).width) + 6)
  const h = 14
  roundRect(ctx, bx, cy - h / 2, w, h, 2)
  if (active) {
    ctx.fillStyle = activeColor
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 1
  } else {
    ctx.lineWidth = 1
    ctx.strokeStyle = borderColor
    ctx.stroke()
    ctx.fillStyle = textColor
    ctx.globalAlpha = 0.4
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // +0.5 optical nudge: all-caps glyphs sit high of the `middle` baseline, so
  // they read as not-quite-centered in the badge without this.
  ctx.fillText(label, bx + w / 2, cy + 0.5)
  ctx.restore()
  return w
}

interface DrawNode {
  id: string
  x: number
  y: number
  w: number
  data: TableNodeData
}

// Stable shared reference returned by the `drawNodes` selector when canvas
// mode is off, so a disabled board triggers neither a nodeLookup iteration
// nor a new-array re-render on every store tick (pan/drag/selection all
// bump the store) — see canvas-node-rendering-migration Phase 1 fix #1.
const EMPTY_DRAW_NODES: Array<DrawNode> = []

export function CanvasNodeLayer({
  enabled,
  editingTableId = null,
}: {
  enabled: boolean
  /**
   * The one table (if any) currently mounted as a full-DOM edit overlay
   * (tactical plan Phase 3, "In-place DOM edit overlay") — excluded from
   * the draw list below so the canvas never double-paints underneath the
   * DOM overlay.
   */
  editingTableId?: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Image export (tactical plan Phase 4, "export forces full DOM + canvas
  // excluded from capture"): while an export is capturing the live DOM,
  // every TableNode is forced back to full-DOM detail (ForceFullDetailContext
  // — see level-of-detail.ts). This viewport-sized `<canvas>` sits at
  // z-1000 ABOVE the DOM, so if left painted it would be rasterized
  // mis-framed into the natural-bounds export capture instead of the forced
  // full-DOM tables underneath. Bail out (return null below) for the
  // duration of the export.
  const forceFullDetail = useForceFullDetail()

  // Theme-change repaint (tactical plan Phase 4, item 1): `readColors` below
  // reads `--rf-*` CSS custom properties fresh on every draw, but nothing
  // previously triggered a redraw when ONLY the theme changed (no pan/zoom).
  // Depending on `resolvedTheme` in the draw effect's deps closes that gap —
  // CanvasNodeLayer renders inside `ThemeProvider` (src/routes/__root.tsx),
  // so this hook is always available here.
  const { resolvedTheme } = useTheme()

  // Pane-resize repaint (tactical plan Phase 4, item 2): opening/closing a
  // side panel resizes the pane WITHOUT firing a `window` resize event, so a
  // `ResizeObserver` on the canvas's own parent is required (not a window
  // listener) to catch it. Bumping this tick is the draw effect's cue to
  // reallocate the backing store (via the existing size-change-only guard
  // below) and repaint at the new size.
  const [resizeTick, setResizeTick] = useState(0)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) return
    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => {
      setResizeTick((t) => t + 1)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [enabled])

  // Viewport transform [translateX, translateY, zoom] — updates every pan/zoom
  // frame. This is the whole point: a transform change redraws the canvas
  // instead of re-laying-out 12k DOM nodes.
  const transform = useStore((s) => s.transform)
  // Latest transform for the pointermove hover hit-test (which runs outside
  // React render), so it maps screen→world with the current pan/zoom.
  const transformRef = useRef(transform)
  transformRef.current = transform

  // Canvas hover hit-testing for the affordance icons: icons are hollow by
  // default and fill when hovered. The draw loop records each icon's WORLD-space
  // center + radius into `iconHitboxesRef`; a pointermove listener on the pane
  // maps the cursor to world coords and sets `hoveredIcon` (only when it
  // changes), which the draw effect keys on to re-fill just that icon.
  const iconHitboxesRef = useRef<
    Array<{ key: string; wx: number; wy: number; hw: number; hh: number }>
  >([])
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  // Latest world-space pointer position (bug fix: canvas-handle-visibility)
  // — read by the draw loop (via ref, same imperative-data pattern as
  // `iconHitboxesRef`) to tell which of a hovered row's two source handles
  // (if either) the cursor is actually over, so it alone can get the
  // `--rf-handle-hover-*` colors — mirrors react-flow-theme.css's
  // `.column-row:hover > .react-flow__handle.source:hover::before` rule,
  // which is scoped to the specific handle, not the whole row.
  const pointerWorldRef = useRef<{ wx: number; wy: number } | null>(null)
  // Row geometry for the CURRENTLY hoverable rows, keyed by the same
  // `columnrow` hitbox key the draw loop pushes into `iconHitboxesRef`
  // (bug fix: canvas-handle-visibility) — lets the corridor logic below
  // recover a row's exact (x, w, cy) on entry without a second column scan.
  // Rebuilt every draw pass, same lifecycle as `iconHitboxesRef`.
  const rowGeometryRef = useRef<
    Map<
      string,
      { tableId: string; columnId: string; x: number; w: number; cy: number }
    >
  >(new Map())
  // "Safe corridor" state (bug fix: canvas-handle-visibility) — lets a
  // handle dot (and the real DOM handle underneath it) stay visible/
  // interactive while the cursor transits from a hovered row out to the dot
  // itself, which sits OUTSIDE the row's own box (ColumnHandles.tsx's
  // `left: '-14px'` / `right: '-14px'`). Without this, the row's own
  // hitbox clears the instant the cursor leaves its rectangle — before it
  // reaches the dot — hiding the dot exactly as the user arrives, and (on
  // the real DOM side) leaving the handle stuck at `pointer-events: none`
  // forever, since it can only turn interactive while `.column-row:hover`
  // is genuinely true.
  //
  // `lastInsideRef` — the row (and its geometry) last seen INSIDE, refreshed
  // continuously while inside and frozen the instant the cursor leaves.
  // `corridorRef` — the committed transit target (one specific handle side,
  // decided by which half of the row the cursor exited from) once the
  // cursor has actually left. The wedge (`pointInConvexPolygon` above) is a
  // TRAPEZOID: its near edge is centered on the EXIT x-position (`exitWx`,
  // not the row's fixed far edge — an exit point can be well inside the
  // row's horizontal span while already past its top/bottom edge, the
  // diagonal-exit case) spanning the row's own height (±ROW_H/2), widening
  // to a larger flared span at the dot end. The near edge's own height is
  // what tolerates the exit happening a beat before the cursor is
  // vertically clear of the row.
  const lastInsideRef = useRef<{
    tableId: string
    columnId: string
    x: number
    w: number
    cy: number
    exitWx: number
  } | null>(null)
  const corridorRef = useRef<{
    key: string
    tableId: string
    columnId: string
    side: 'left' | 'right'
    x: number
    w: number
    cy: number
    exitWx: number
    armedAt: number
  } | null>(null)
  // The `data-handleid` currently carrying the JS-toggled `.handle-armed`
  // class (react-flow-theme.css's sibling rule to `.column-row:hover >
  // .react-flow__handle...`) — tracked so it can be cleanly removed before
  // arming a different handle, without a DOM-wide query every frame. This
  // is what keeps the REAL DOM handle interactive through the corridor —
  // `armedHandleKey` state below only drives the CANVAS paint.
  const armedDomHandleIdRef = useRef<string | null>(null)
  const [armedHandleKey, setArmedHandleKey] = useState<string | null>(null)
  const { requestAffordance } = useCanvasEdit()
  const rf = useReactFlow()

  // Bug fix (requirement 2, previously deferred, now confirmed a real
  // user-facing gap): during an active connection drag, canvas mode gave no
  // visual cue for which OTHER tables' columns are valid drop targets — a
  // user had to blind-hover each candidate field for its dot to appear.
  // Mirrors react-flow-theme.css's `.is-connecting
  // .react-flow__handle.target.connectionindicator::before` rule (which
  // lights up EVERY target handle unconditionally, table of origin
  // included) in canvas terms — EXCEPT FR-016: a connection dragged from a
  // SHAPE's own handle must NOT light up table columns (a shape-to-table
  // pair is always invalid), matching the DOM's `.is-connecting-from-shape`
  // carve-out. `fromNode` is read via a selector (not the raw object) so
  // this only re-renders on the boolean's OWN change, not on every
  // in-progress connection-line coordinate update.
  const isConnectingFromTable = useConnection(
    (c) => c.inProgress && c.fromNode.type !== 'shape',
  )

  useEffect(() => {
    const parent = canvasRef.current?.parentElement
    if (!parent || !enabled) return

    // Map a screen-space pointer to world coordinates via the current
    // viewport transform.
    const toWorld = (e: { clientX: number; clientY: number }) => {
      const rect = parent.getBoundingClientRect()
      const [tx, ty, zoom] = transformRef.current
      return {
        wx: (e.clientX - rect.left - tx) / zoom,
        wy: (e.clientY - rect.top - ty) / zoom,
      }
    }

    // Map a screen-space pointer to the affordance-icon key under it (or null),
    // via the world-space hitboxes recorded by the draw loop.
    const hitTest = (world: { wx: number; wy: number }): string | null => {
      for (const hb of iconHitboxesRef.current) {
        if (
          Math.abs(world.wx - hb.wx) <= hb.hw &&
          Math.abs(world.wy - hb.wy) <= hb.hh
        ) {
          return hb.key
        }
      }
      return null
    }

    // Add/remove the JS-toggled `.handle-armed` class on the ONE real DOM
    // handle the corridor currently targets (bug fix: canvas-handle-
    // visibility) — a no-op-safe imperative DOM write, same pattern this
    // effect already uses for `parent.style.cursor` below.
    //
    // ALSO toggles `.content-visibility-armed` on that handle's table node
    // (react-flow-theme.css — see its doc comment for why lifting
    // `content-visibility` is necessary AND for the box-shadow/z-index
    // leak it would otherwise expose, and how that leak is neutralized).
    // Scoped to the ONE currently-armed table, narrow enough to leave the
    // GH #121 pan/zoom perf win intact for every other table on the board.
    const setDomArmed = (handleId: string | null) => {
      if (armedDomHandleIdRef.current === handleId) return
      if (armedDomHandleIdRef.current) {
        const prevEl = document.querySelector(
          `[data-handleid="${armedDomHandleIdRef.current}"]`,
        )
        prevEl?.classList.remove('handle-armed')
        prevEl
          ?.closest('.react-flow__node-erTable')
          ?.classList.remove('content-visibility-armed')
      }
      if (handleId) {
        const nextEl = document.querySelector(`[data-handleid="${handleId}"]`)
        nextEl?.classList.add('handle-armed')
        nextEl
          ?.closest('.react-flow__node-erTable')
          ?.classList.add('content-visibility-armed')
      }
      armedDomHandleIdRef.current = handleId
    }

    const disarmCorridor = () => {
      corridorRef.current = null
      setArmedHandleKey((prev) => (prev === null ? prev : null))
      setDomArmed(null)
    }

    // Evaluate the in-progress corridor (if any) against the CURRENT
    // pointer position: "arrived" (close enough to the dot) always wins —
    // it must be able to hold indefinitely (e.g. the user pauses on the dot
    // deciding whether to click), unlike the transit itself, which is
    // capped by CORRIDOR_TIMEOUT_MS as a backstop against a cursor parked
    // mid-wedge. Otherwise: inside the trapezoid from the exit x-position to
    // the flared dot → stay armed; outside it → disarm immediately (no
    // grace period — moving away hides the dot right away, per spec).
    const evaluateCorridor = (world: { wx: number; wy: number }) => {
      const c = corridorRef.current
      if (!c) return
      const dotWx = c.side === 'left' ? c.x - 14 : c.x + c.w + 14
      const dotWy = c.cy
      const distToDot = Math.hypot(world.wx - dotWx, world.wy - dotWy)
      if (distToDot <= ARRIVED_RADIUS) {
        setArmedHandleKey((prev) => (prev === c.key ? prev : c.key))
        setDomArmed(
          createColumnHandleId(c.tableId, c.columnId, c.side, 'source'),
        )
        return
      }
      const withinTimeout = Date.now() - c.armedAt <= CORRIDOR_TIMEOUT_MS
      const dirSign = c.side === 'left' ? -1 : 1
      const inWedge =
        withinTimeout &&
        pointInConvexPolygon(world, [
          { wx: c.exitWx, wy: c.cy - ROW_H / 2 },
          { wx: dotWx + dirSign * 8, wy: dotWy - CORRIDOR_FLARE },
          { wx: dotWx + dirSign * 8, wy: dotWy + CORRIDOR_FLARE },
          { wx: c.exitWx, wy: c.cy + ROW_H / 2 },
        ])
      if (inWedge) {
        setArmedHandleKey((prev) => (prev === c.key ? prev : c.key))
        setDomArmed(
          createColumnHandleId(c.tableId, c.columnId, c.side, 'source'),
        )
      } else {
        disarmCorridor()
      }
    }

    const onMove = (e: PointerEvent) => {
      const world = toWorld(e)
      pointerWorldRef.current = world
      const found = hitTest(world)
      parent.style.cursor = found ? 'pointer' : ''
      setHoveredKey((prev) => (prev === found ? prev : found))

      // Safe-corridor bookkeeping (bug fix: canvas-handle-visibility) — see
      // the refs' doc comments above for the full mechanism.
      const insideGeometry = found ? rowGeometryRef.current.get(found) : undefined
      if (found && insideGeometry) {
        // Genuinely inside a row: keep refreshing the anchor, and drop any
        // in-progress corridor — both dots are already shown/interactive
        // via the plain row-hover path below (`hoveredKey === rowHoverKey`
        // in the draw loop), so no corridor is needed until the cursor
        // actually leaves again.
        lastInsideRef.current = {
          tableId: insideGeometry.tableId,
          columnId: insideGeometry.columnId,
          x: insideGeometry.x,
          w: insideGeometry.w,
          cy: insideGeometry.cy,
          exitWx: world.wx,
        }
        if (corridorRef.current) disarmCorridor()
        return
      }

      if (!corridorRef.current && lastInsideRef.current) {
        // Just left a row — commit a corridor toward whichever dot sits on
        // the side the cursor exited from (its horizontal position at the
        // moment of exit, which is well-defined even for a diagonal exit
        // through the row's top/bottom edge).
        const li = lastInsideRef.current
        const side: 'left' | 'right' =
          li.exitWx <= li.x + li.w / 2 ? 'left' : 'right'
        corridorRef.current = {
          key: `${li.tableId}|handle|${li.columnId}|${side}`,
          tableId: li.tableId,
          columnId: li.columnId,
          side,
          x: li.x,
          w: li.w,
          cy: li.cy,
          exitWx: li.exitWx,
          armedAt: Date.now(),
        }
        lastInsideRef.current = null
      }
      evaluateCorridor(world)
    }
    const onLeave = () => {
      parent.style.cursor = ''
      pointerWorldRef.current = null
      setHoveredKey(null)
      lastInsideRef.current = null
      disarmCorridor()
    }
    // Capture-phase click so the icon's action fires BEFORE React Flow's node
    // click handler sees it, and is stopped there — clicking an icon opens its
    // popover/panel and does NOT also select/deselect the table.
    const onClick = (e: MouseEvent) => {
      const key = hitTest(toWorld(e))
      if (!key) return
      const parts = key.split('|')
      // Hover-only entry (bug fix: canvas-handle-visibility) — this hitbox
      // exists solely to drive the handle-dot paint below via `hoveredKey`.
      // Returning here WITHOUT preventDefault/stopPropagation lets the click
      // fall through untouched to the real DOM `.column-row` underneath
      // (double-click-to-edit, drag-to-connect) exactly as it did before
      // this hitbox existed.
      if (parts[1] === 'columnrow') return
      e.preventDefault()
      e.stopPropagation()
      if (parts[1] === 'fieldnote') {
        // Canvas-native column-note popover (tactical plan:
        // canvas-field-note-popover) — opens ColumnNotePopover in place,
        // anchored beside this column's row; never mounts the edit overlay
        // (parts[0]=tableId, parts[2]=columnId — key format is
        // `${node.id}|fieldnote|${col.id}`, see the draw loop below).
        requestAffordance(parts[0], 'fieldnote', parts[2])
      } else if (parts[1] === 'jumprow') {
        // Canvas relations list → jump to the related table: re-anchor the
        // relations preview to it AND pan the viewport so it's centered.
        const targetId = parts[2]
        requestAffordance(targetId, 'relations')
        const tn = rf.getInternalNode(targetId)
        if (tn) {
          // Absolute for the same nesting reason as the draw loop above —
          // centering on a grouped table's relative position would pan the
          // viewport to the wrong place entirely.
          const origin = tn.internals.positionAbsolute
          // `getInternalNode` guarantees `measured` (unlike `getNode`), so no
          // optional chain here — eslint rejects one as provably unnecessary.
          const cx = origin.x + (tn.measured.width ?? 110) / 2
          const cy = origin.y + (tn.measured.height ?? 44) / 2
          rf.setCenter(cx, cy, { zoom: transformRef.current[2], duration: 300 })
        }
      } else {
        requestAffordance(
          parts[0],
          parts[1] as 'note' | 'comment' | 'relations',
        )
      }
    }
    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    parent.addEventListener('click', onClick, true)
    return () => {
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
      parent.removeEventListener('click', onClick, true)
      parent.style.cursor = ''
      // Raw DOM/ref cleanup only (no state setters here — this can also run
      // on a plain effect re-run, not just unmount, and there is nothing to
      // redraw for): clear any handle this instance left armed.
      if (armedDomHandleIdRef.current) {
        const el = document.querySelector(
          `[data-handleid="${armedDomHandleIdRef.current}"]`,
        )
        el?.classList.remove('handle-armed')
        el
          ?.closest('.react-flow__node-erTable')
          ?.classList.remove('content-visibility-armed')
        armedDomHandleIdRef.current = null
      }
      lastInsideRef.current = null
      corridorRef.current = null
    }
  }, [enabled, requestAffordance, rf])

  // Note-glyph permission gate (tactical plan: canvas-table-affordances) —
  // mirrors the full-DOM header's `canEdit &&` gate on TableNotePopover
  // (TableNode.tsx). CanvasNodeLayer renders inside the same
  // WhiteboardPermissionsProvider subtree as TableNode (ReactFlowWhiteboard),
  // so this hook is always available here.
  const { canEdit } = useWhiteboardPermissions()

  // Relations glyph data source (tactical plan: canvas-table-affordances) —
  // a table gets the relations glyph when it appears as either endpoint of
  // any edge. Read once per edges-array-identity change (not per node) and
  // reduced to a Set for O(1) membership tests in the draw loop below.
  const edges = useStore((s) => s.edges)
  const relatedTableIds = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) {
      set.add(e.source)
      set.add(e.target)
    }
    return set
  }, [edges])

  // Pull table nodes straight from the store's nodeLookup so this doesn't
  // depend on the parent threading node state down. Only `type === 'table'`
  // nodes are drawn here (areas/comments keep their own render paths).
  //
  // Gated on `enabled` FIRST, before touching nodeLookup at all: this
  // selector runs on EVERY store tick regardless of whether the canvas is
  // even mounted-visible (previously it iterated every table and called
  // getCachedTableWidth per table on every pan/drag/selection tick even
  // with canvas mode off — exactly the DOM-node-count hot path #142 exists
  // to speed up). Returning the same empty-array reference when disabled
  // means: no iteration, no width lookups, and no new object identity to
  // trigger a redraw-effect re-run either.
  const drawNodes = useStore((s) => {
    if (!enabled) return EMPTY_DRAW_NODES
    const out: Array<DrawNode> = []
    for (const [, n] of s.nodeLookup) {
      if (n.type !== 'table' || n.hidden) continue
      // Skip the table currently overlaid by the full-DOM edit path — its
      // TableNode instance renders the real thing in place; drawing it here
      // too would double-paint the same table.
      if (n.id === editingTableId) continue
      const data = n.data as unknown as TableNodeData
      // Width comes from the SAME cache TableNode's chrome-light wrapper
      // reads (canvas-node-metrics.ts) — not `n.measured?.width` — so
      // canvas draw and DOM handle positions can never drift apart (the
      // measured DOM width becomes meaningless once TableNode stops
      // rendering full column rows under canvas mode).
      const w = getCachedTableWidth(
        n.id,
        data.table.name,
        data.table.columns,
        data.table.width,
      )
      // ABSOLUTE, not `n.position` (area nesting, todo #55 follow-up): a table
      // grouped into an area is a React Flow child, and a child's `position` is
      // relative to its parent. Painting that as an absolute canvas coordinate
      // drew every grouped table offset by minus the area's origin — the table
      // text appeared OUTSIDE the area while its DOM chrome sat inside it.
      // `nodeLookup` holds InternalNodes, so the composed absolute position is
      // right here; un-nested tables have positionAbsolute === position.
      const absolute = n.internals.positionAbsolute
      out.push({
        id: n.id,
        x: absolute.x,
        y: absolute.y,
        w,
        data,
      })
    }
    return out
  })

  // Latest `drawNodes` for the connecting-blanket effect below, via ref (not
  // a dependency) — `drawNodes` gets a new array identity on every pan/zoom/
  // drag frame, and re-running a DOM class sweep that often would defeat the
  // whole point of `content-visibility-connecting` being scoped to "only
  // while actually connecting". Reading a ref lets that effect depend ONLY
  // on `isConnectingFromTable` (which flips twice per drag: start, end).
  const drawNodesRef = useRef(drawNodes)
  drawNodesRef.current = drawNodes

  // Bug fix (requirement 2): lift `content-visibility` (see
  // `.content-visibility-armed`'s doc comment in react-flow-theme.css for
  // why this is necessary — hit-testing, not just paint) on EVERY currently
  // drawn table for the duration of the drag, via its own class name
  // (`content-visibility-connecting`, distinct from the corridor's
  // `content-visibility-armed`) so the two independent lifecycles never
  // fight over which one owns removing the class from a table they happen
  // to share. Snapshots the table list at drag START — a table panned into
  // view mid-drag is a rare-enough case (the user's cursor is busy
  // dragging) not to justify re-running this on every frame.
  useEffect(() => {
    if (!enabled || !isConnectingFromTable) return
    const els = drawNodesRef.current
      .map((n) =>
        document.querySelector(
          `[data-table-name="${CSS.escape(n.data.table.name)}"]`,
        ),
      )
      .filter((el): el is Element => el !== null)
    for (const el of els) el.classList.add('content-visibility-connecting')
    return () => {
      for (const el of els) el.classList.remove('content-visibility-connecting')
    }
  }, [enabled, isConnectingFromTable])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) return
    const parent = canvas.parentElement
    if (!parent) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const colors = readColors(parent)
    const dpr = window.devicePixelRatio || 1
    const rect = parent.getBoundingClientRect()

    // Size the backing store to device pixels for crisp text; keep the CSS box
    // at the pane size. Reallocating the backing store (setting canvas.width)
    // is expensive and CLEARS the canvas — do it ONLY when the size actually
    // changes, never on a plain pan/zoom redraw (that was the 2fps bug).
    const bw = Math.round(rect.width * dpr)
    const bh = Math.round(rect.height * dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }

    const [tx, ty, zoom] = transform
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    // Apply the React Flow viewport transform: world → screen.
    ctx.translate(tx, ty)
    ctx.scale(zoom, zoom)

    ctx.textBaseline = 'middle'

    // Rebuilt every draw: the affordance-icon hit targets (world space) the
    // pointermove hover test reads. Cleared here so it never accumulates
    // across repaints.
    iconHitboxesRef.current = []
    // Rebuilt every draw alongside it (bug fix: canvas-handle-visibility) —
    // row geometry the corridor logic looks up by the same `columnrow` key.
    rowGeometryRef.current = new Map()

    // Lookups for the canvas relations list (drawn AFTER the node loop so it
    // stacks above adjacent tables): id → drawn node, for both related-table
    // names and geometry.
    const nodeById = new Map(drawNodes.map((n) => [n.id, n]))
    const relationsLists: Array<{
      tableId: string
      x: number
      y: number
      w: number
      related: Array<{ id: string; name: string; conn: string }>
    }> = []

    for (const node of drawNodes) {
      // LOD parity (tactical plan Phase 4, item 4) + showMode parity: draw
      // only the columns the DOM mounts a handle for. getEffectiveShowMode
      // folds the sub-threshold "collapse to header-only" rule in with the
      // raw showMode filtering (ALL_FIELDS = all, KEY_ONLY = PK/FK only,
      // TABLE_NAME = none — header only) — the single source of truth
      // TableNode's chrome-light path also consults, so canvas rows and DOM
      // handles always agree. `forceFullDetail=false` here is deliberate:
      // this component doesn't paint at all during export (see the
      // `forceFullDetail` early-return below), so the export exemption is
      // moot for this call site. See the "Show-mode parity in canvas
      // render" spec-delta requirement.
      const isBelowLodThreshold = zoom < LOD_ZOOM_THRESHOLD
      const effectiveShowMode = getEffectiveShowMode(
        node.data.showMode,
        isBelowLodThreshold,
        false,
      )
      const columns = getVisibleColumnsForShowMode(
        node.data.table.columns,
        effectiveShowMode,
      )
      const h = HEADER_H + columns.length * ROW_H
      const { x, y, w } = node

      // Body + border.
      ctx.fillStyle = colors.bg
      roundRect(ctx, x, y, w, h, 8)
      ctx.fill()
      ctx.lineWidth = 1 / zoom
      ctx.strokeStyle = colors.border
      ctx.stroke()

      // Header.
      ctx.save()
      roundRect(ctx, x, y, w, HEADER_H, 8)
      ctx.clip()
      ctx.fillStyle = colors.headerBg
      ctx.fillRect(x, y, w, HEADER_H)
      ctx.restore()

      // Affordance glyph strip (tactical plan: canvas-table-affordances) —
      // right-aligned indicators for comment/note/relations, drawn only
      // when the corresponding data exists (locked decision #3) and never
      // below the LOD zoom threshold (locked decision #5, same gate the
      // effective-show-mode collapse above already applies). Left-click is
      // inert on these (locked decision #2) — acting is via the table's
      // right-click context menu (TableNodeContextMenu's Note/Comment
      // items, wired in TableNode.tsx's chrome-light branch).
      const unresolvedCount = (node.data.commentThreads ?? []).filter(
        (t) => !t.root.resolved,
      ).length
      const showCommentGlyph =
        !isBelowLodThreshold &&
        Boolean(node.data.canComment) &&
        unresolvedCount > 0
      const showNoteGlyph =
        !isBelowLodThreshold &&
        canEdit &&
        Boolean(node.data.table.description?.trim())
      const showRelationsGlyph =
        !isBelowLodThreshold && relatedTableIds.has(node.id)
      const glyphs: Array<'relations' | 'comment' | 'note'> = []
      if (showRelationsGlyph) glyphs.push('relations')
      if (showCommentGlyph) glyphs.push('comment')
      if (showNoteGlyph) glyphs.push('note')
      const reservedGlyphWidth =
        glyphs.length > 0 ? glyphs.length * GLYPH_BOX + 4 : 0

      ctx.fillStyle = colors.headerText
      ctx.font = '600 13px Inter, system-ui, sans-serif'
      ctx.fillText(
        truncateToWidth(
          ctx,
          node.data.table.name,
          w - PAD_X * 2 - reservedGlyphWidth,
        ),
        x + PAD_X,
        y + HEADER_H / 2,
      )

      if (glyphs.length > 0) {
        const cy = y + HEADER_H / 2
        let glyphX = x + w - PAD_X - GLYPH_BOX / 2
        for (let i = glyphs.length - 1; i >= 0; i--) {
          const g = glyphs[i]
          const key = `${node.id}|${g}`
          // Hover shows ONLY a background chip; the icon itself stays hollow.
          if (hoveredKey === key) {
            drawIconHoverChip(ctx, glyphX, cy, colors.headerText, GLYPH_BOX - 3)
          }
          if (g === 'relations') {
            drawRelationsGlyph(ctx, glyphX, cy, colors.headerText, false)
          } else if (g === 'comment') {
            drawCommentGlyph(
              ctx,
              glyphX,
              cy,
              colors.headerText,
              colors.headerBg,
              unresolvedCount,
              false,
            )
          } else {
            drawNoteGlyph(ctx, glyphX, cy, colors.headerText, false)
          }
          // Record a world-space hit target for the pointermove hover test.
          iconHitboxesRef.current.push({
            key,
            wx: glyphX,
            wy: cy,
            hw: GLYPH_BOX / 2,
            hh: GLYPH_BOX / 2,
          })
          glyphX -= GLYPH_BOX
        }
      }

      // Column rows — constraint badges (PK / FK / N / U) + name + type +
      // field-note indicator, mirroring the DOM ColumnRow (ConstraintBadges +
      // ColumnNotePopover) so a canvas table shows the SAME per-field
      // constraints and notes the DOM does — not just a name + type.
      columns.forEach((col, i) => {
        const cy = y + HEADER_H + i * ROW_H + ROW_H / 2

        // Constraint badges (left, within the fixed BADGE_ZONE) — PK / FK / N /
        // U are ALL always shown (filled + colored when the constraint is set,
        // faint outline when not), so the badge columns and the field name stay
        // aligned across every row.
        let bx = x + PAD_X
        bx +=
          drawConstraintBadge(
            ctx,
            bx,
            cy,
            'PK',
            col.isPrimaryKey,
            colors.pk,
            colors.border,
            colors.text,
          ) + 2
        bx +=
          drawConstraintBadge(
            ctx,
            bx,
            cy,
            'FK',
            col.isForeignKey,
            colors.fk,
            colors.border,
            colors.text,
          ) + 2
        bx +=
          drawConstraintBadge(
            ctx,
            bx,
            cy,
            'N',
            col.isNullable,
            colors.nullable,
            colors.border,
            colors.text,
          ) + 2
        drawConstraintBadge(
          ctx,
          bx,
          cy,
          'U',
          col.isUnique,
          colors.unique,
          colors.border,
          colors.text,
        )

        const hasNote = Boolean(col.description?.trim())
        const nameStart = x + PAD_X + BADGE_ZONE
        const typeRight = x + w - PAD_X - NOTE_RESERVE

        // Name — starts after the fixed badge zone so names align across rows.
        ctx.font = '12px Inter, system-ui, sans-serif'
        const typeW = ctx.measureText(col.dataType).width
        const nameMax = Math.max(16, typeRight - typeW - 16 - nameStart)
        ctx.fillStyle = colors.text
        ctx.globalAlpha = 1
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(truncateToWidth(ctx, col.name, nameMax), nameStart, cy)

        // Type — right-aligned, leaving the note-indicator reserve.
        ctx.save()
        ctx.textAlign = 'right'
        ctx.globalAlpha = 0.7
        ctx.fillText(truncateToWidth(ctx, col.dataType, 100), typeRight, cy)
        ctx.restore()

        // Field-note indicator — the "notes for the fields" the DOM shows via
        // ColumnNotePopover. Hollow b/w note icon, filled on hover, drawn only
        // when the column has a note AND the viewer can edit (tactical plan:
        // canvas-field-note-popover, locked decision #1 — editor-only glyph,
        // matches the DOM ColumnRow's `canEdit &&` gate and this file's own
        // table-note glyph gate above). No hitbox is registered for viewers,
        // so their clicks at this position are inert.
        if (hasNote && canEdit) {
          const noteCx = x + w - PAD_X - 6
          const key = `${node.id}|fieldnote|${col.id}`
          // Hover shows ONLY a background chip; the note icon stays hollow.
          if (hoveredKey === key) {
            drawIconHoverChip(ctx, noteCx, cy, colors.text, 18)
          }
          drawNoteGlyph(ctx, noteCx, cy, colors.text, false)
          iconHitboxesRef.current.push({
            key,
            wx: noteCx,
            wy: cy,
            hw: 9,
            hh: 9,
          })
        }

        // Drag-to-connect handle dots (bug fix: canvas-handle-visibility) —
        // CanvasNodeLayer paints an opaque table body ABOVE the chrome-light
        // DOM row (z-[4] vs the node's own z=1 stacking context), so the DOM
        // `.column-row:hover > .react-flow__handle.source.connectionindicator
        // ::before` reveal rule (react-flow-theme.css) can never show
        // through no matter what z-index it's given — its z-index is scoped
        // inside the occluded node's own stacking context. The DOM handles
        // (ColumnHandles.tsx) still WORK: this canvas is pointer-events-none,
        // so hover/click/drag hit-testing passes straight through to the
        // real `.column-row` beneath. They are just invisible. Fix: paint
        // the same dot on the canvas, keyed off the SAME `hoveredKey` state
        // the glyph/fieldnote hover-chips above already use.
        //
        // Hitbox spans the FULL row (not just near a handle) — pushed AFTER
        // the fieldnote hitbox above so hovering the fieldnote icon still
        // wins there (`hitTest` returns the first match by push order); for
        // every other point in the row, this one matches, mirroring
        // `.column-row:hover`'s whole-row CSS scope. The `columnrow` key
        // prefix is recognized (and ignored, hover-only) by this effect's
        // `onClick` above so it can never hijack a real click/dblclick/drag.
        const rowHoverKey = `${node.id}|columnrow|${col.id}`
        iconHitboxesRef.current.push({
          key: rowHoverKey,
          wx: x + w / 2,
          wy: cy,
          hw: w / 2,
          hh: ROW_H / 2,
        })
        // Row geometry for the corridor logic (bug fix: canvas-handle-
        // visibility) — same key, so `rowGeometryRef.current.get(found)` in
        // the pointermove handler recovers exactly this row's (x, w, cy).
        rowGeometryRef.current.set(rowHoverKey, {
          tableId: node.id,
          columnId: col.id,
          x,
          w,
          cy,
        })
        // Only SOURCE handles reveal on row hover (react-flow-theme.css's
        // `.column-row:hover > .react-flow__handle.source...` rule) — target
        // handles stay hidden here; they only light up during an active
        // connection drag (react-flow-theme.css's `.is-connecting
        // .react-flow__handle.target...` rule), which this canvas layer
        // deliberately does NOT paint — correctly respecting FR-016's
        // `.is-connecting-from-shape` suppression (a shape-originated drag
        // must NOT show table columns as valid drop targets) needs
        // connection-origin tracking beyond a small addition, so it was left
        // out rather than risk a half-correct implementation.
        //
        // A side is drawn when EITHER the whole row is hovered (both dots,
        // the base case) OR the safe corridor has armed that specific side
        // (the cursor is mid-transit toward it, or has arrived — see
        // `armedHandleKey`/`corridorRef` above). Position matches
        // ColumnHandles.tsx's inline style EXACTLY (`left: '-14px'` /
        // `right: '-14px'`, vertically centered on the row) so the canvas
        // paint and the real DOM hit target never drift apart — same parity
        // rule as the table-width lookup above.
        const leftX = x - 14
        const rightX = x + w + 14
        const rowHovered = hoveredKey === rowHoverKey
        const leftArmed =
          rowHovered || armedHandleKey === `${node.id}|handle|${col.id}|left`
        const rightArmed =
          rowHovered || armedHandleKey === `${node.id}|handle|${col.id}|right`
        if (leftArmed || rightArmed) {
          const pointer = pointerWorldRef.current
          const leftHovered =
            pointer !== null &&
            Math.abs(pointer.wx - leftX) <= 14 &&
            Math.abs(pointer.wy - cy) <= 14
          const rightHovered =
            pointer !== null &&
            Math.abs(pointer.wx - rightX) <= 14 &&
            Math.abs(pointer.wy - cy) <= 14
          if (leftArmed) {
            drawHandleDot(
              ctx,
              leftX,
              cy,
              leftHovered ? colors.handleHoverBg : colors.handleBg,
              leftHovered ? colors.handleHoverBorder : colors.handleBorder,
            )
          }
          if (rightArmed) {
            drawHandleDot(
              ctx,
              rightX,
              cy,
              rightHovered ? colors.handleHoverBg : colors.handleBg,
              rightHovered ? colors.handleHoverBorder : colors.handleBorder,
            )
          }
        }

        // Bug fix (requirement 2): target-handle reveal during an active
        // connection drag — mirrors react-flow-theme.css's `.is-connecting
        // .react-flow__handle.target.connectionindicator::before` rule,
        // which lights up EVERY target handle unconditionally (no hover
        // needed, no per-handle hover tint either — matching that rule
        // exactly, unlike the source reveal above). Skips a side already
        // drawn as an armed SOURCE dot above (`leftArmed`/`rightArmed`) —
        // same position, same default colors, would just be a redundant
        // second draw call, not a second dot.
        if (isConnectingFromTable) {
          if (!leftArmed) {
            drawHandleDot(ctx, leftX, cy, colors.handleBg, colors.handleBorder)
          }
          if (!rightArmed) {
            drawHandleDot(ctx, rightX, cy, colors.handleBg, colors.handleBorder)
          }
        }
      })

      // Relations preview (canvas-native, no DOM): when this table's relations
      // are open, collect its 1-hop related tables so a small list can be drawn
      // beside it AFTER the node loop (so it stacks above adjacent tables).
      if (node.data.isRelationsPreviewOpen) {
        // One row PER edge (not deduped by table) so a table with two FKs to
        // the same neighbor shows both key connections — parity with the old
        // DOM TableRelationsPanel.
        const thisName = node.data.table.name
        const related: Array<{ id: string; name: string; conn: string }> = []
        for (const e of edges) {
          const other =
            e.source === node.id
              ? e.target
              : e.target === node.id
                ? e.source
                : null
          if (!other) continue
          const on = nodeById.get(other)
          if (!on) continue
          // Field-to-field key connection (e.g. `Orders.customer_id →
          // Customers.id`), oriented from THIS table's side. Derived from the
          // edge's relationship column snapshots — same logic the DOM panel
          // used. Skip the line if either snapshot is missing (stale edge).
          const rel = (e.data as RelationshipEdgeData | undefined)?.relationship
          let conn = ''
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- sourceColumn/targetColumn are typed non-nullable, but an edge's snapshot can be stale/missing at runtime; this guard skips such edges (see comment above).
          if (rel?.sourceColumn && rel?.targetColumn) {
            const thisIsSource = rel.sourceTableId === node.id
            const thisCol = thisIsSource ? rel.sourceColumn : rel.targetColumn
            const otherCol = thisIsSource ? rel.targetColumn : rel.sourceColumn
            conn = `${thisName}.${thisCol.name} → ${on.data.table.name}.${otherCol.name}`
          }
          related.push({ id: other, name: on.data.table.name, conn })
        }
        relationsLists.push({ tableId: node.id, x, y, w, related })
      }
    }

    // Draw the canvas relations lists on top of everything else.
    for (const rl of relationsLists) {
      const PANEL_PAD = 8
      const HEADER = 20
      // Each related row is a two-line block: the neighbor table name plus the
      // field-to-field key connection (`Orders.customer_id → Customers.id`) —
      // parity with the old DOM TableRelationsPanel. A row without a resolved
      // connection (stale edge) is single-line.
      const NAME_FONT = '12px Inter, system-ui, sans-serif'
      const CONN_FONT = '10px ui-monospace, Menlo, Consolas, monospace'
      const REL_ROW_H = 32

      ctx.font = '600 11px Inter, system-ui, sans-serif'
      let listW = ctx.measureText('Related tables').width
      for (const r of rl.related) {
        ctx.font = NAME_FONT
        listW = Math.max(listW, ctx.measureText(r.name).width)
        if (r.conn) {
          ctx.font = CONN_FONT
          listW = Math.max(listW, ctx.measureText(r.conn).width)
        }
      }
      const panelW = Math.ceil(listW) + PANEL_PAD * 2
      const rowsH = Math.max(1, rl.related.length) * REL_ROW_H
      const panelH = HEADER + rowsH + PANEL_PAD
      // Prefer right of the table; flip left if it would overflow far right.
      const px = rl.x + rl.w + 12
      const py = rl.y

      ctx.save()
      ctx.fillStyle = colors.bg
      roundRect(ctx, px, py, panelW, panelH, 8)
      ctx.fill()
      ctx.lineWidth = 1 / zoom
      ctx.strokeStyle = colors.border
      ctx.stroke()

      ctx.fillStyle = colors.headerText
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('Related tables', px + PANEL_PAD, py + HEADER / 2 + 2)

      if (rl.related.length === 0) {
        ctx.font = NAME_FONT
        ctx.fillStyle = colors.text
        ctx.globalAlpha = 0.6
        ctx.fillText('None', px + PANEL_PAD, py + HEADER + REL_ROW_H / 2)
        ctx.globalAlpha = 1
      } else {
        rl.related.forEach((r, i) => {
          const ry = py + HEADER + i * REL_ROW_H
          // Suffix the row index so two edges to the SAME neighbor get
          // distinct hover/hitbox keys; the click handler only reads parts[2]
          // (the target id), so the extra segment is inert there.
          const rowKey = `${rl.tableId}|jumprow|${r.id}|${i}`
          if (hoveredKey === rowKey) {
            ctx.save()
            ctx.globalAlpha = 0.12
            ctx.fillStyle = colors.headerText
            roundRect(ctx, px + 3, ry + 2, panelW - 6, REL_ROW_H - 4, 4)
            ctx.fill()
            ctx.restore()
          }
          ctx.textAlign = 'left'
          ctx.font = NAME_FONT
          ctx.fillStyle = colors.text
          ctx.fillText(
            truncateToWidth(ctx, r.name, panelW - PANEL_PAD * 2),
            px + PANEL_PAD,
            ry + 12,
          )
          if (r.conn) {
            ctx.font = CONN_FONT
            ctx.fillStyle = colors.text
            ctx.globalAlpha = 0.65
            ctx.fillText(
              truncateToWidth(ctx, r.conn, panelW - PANEL_PAD * 2),
              px + PANEL_PAD,
              ry + 25,
            )
            ctx.globalAlpha = 1
          }
          iconHitboxesRef.current.push({
            key: rowKey,
            wx: px + panelW / 2,
            wy: ry + REL_ROW_H / 2,
            hw: panelW / 2,
            hh: REL_ROW_H / 2,
          })
        })
      }
      ctx.restore()
    }
    // `forceFullDetail` is a dep (not just read): export sets it true → this
    // component returns null (canvas unmounts) → export ends, sets it back
    // false → a NEW canvas element mounts. transform/drawNodes/
    // resolvedTheme/resizeTick are all unchanged across that round-trip, so
    // without this dep the effect wouldn't re-run and the fresh canvas
    // would stay blank until an incidental pan/zoom (Hermes review
    // BLOCKER). The `!canvas` guard above already no-ops the true
    // transition (canvas is unmounted then), so this only matters for the
    // false transition repaint.
    //
    // `canEdit`/`relatedTableIds` (tactical plan: canvas-table-affordances):
    // the glyph strip reads both but neither is captured by `drawNodes`
    // (nodeLookup-only) or `transform` — without these deps, toggling
    // permissions or adding/removing a relationship wouldn't repaint the
    // glyphs until an incidental pan/zoom.
    //
    // `armedHandleKey` (bug fix: canvas-handle-visibility): drives the
    // corridor's single-side handle-dot paint independently of `hoveredKey`
    // — without this dep, the dot wouldn't repaint as the cursor transits
    // from the row out to it.
    //
    // `isConnectingFromTable` (bug fix, requirement 2): drives the
    // target-handle reveal — without this dep, the target dots wouldn't
    // paint/clear at drag start/end.
  }, [
    enabled,
    transform,
    drawNodes,
    resolvedTheme,
    resizeTick,
    forceFullDetail,
    canEdit,
    relatedTableIds,
    hoveredKey,
    armedHandleKey,
    isConnectingFromTable,
    edges,
  ])

  if (!enabled || forceFullDetail) return null

  return (
    <canvas
      ref={canvasRef}
      data-testid="canvas-node-layer"
      className="pointer-events-none absolute inset-0 z-[4]"
    />
  )
}

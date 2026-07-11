// src/components/whiteboard/CanvasNodeLayer.tsx
// Hybrid canvas rendering (GH #142 → canvas migration). Draws every table as
// canvas draw calls on a SINGLE <canvas> that pans/zooms with React Flow's own
// viewport transform — replacing ~306 DOM nodes/table (11,940 for 39 tables)
// with one bitmap. This is the Figma model: canvas paints the diagram, DOM is
// reserved for the table the user is actively editing (added in a later step).
//
// STEP 1 (this file): non-destructive foundation. Gated by `?canvas=1`, it
// renders as an overlay so the drawing + transform-sync can be verified against
// the live DOM before the DOM node bodies are swapped off. No interaction yet —
// React Flow still owns pan/zoom/drag/selection/edges underneath.
//
// It lives INSIDE <ReactFlow> (a pane-fixed child, like <Background>), so it can
// read the viewport transform from the store and draw in screen space itself.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import type { TableNodeData } from '@/lib/react-flow/types'
import {
  HEADER_H,
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
import { useTheme } from '@/hooks/use-theme'

interface ThemeColors {
  bg: string
  border: string
  headerBg: string
  headerText: string
  text: string
  pk: string
  fk: string
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
  }
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

interface DrawNode {
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
      out.push({
        x: n.position.x,
        y: n.position.y,
        w,
        data,
      })
    }
    return out
  })

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
      const effectiveShowMode = getEffectiveShowMode(
        node.data.showMode,
        zoom < LOD_ZOOM_THRESHOLD,
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
      ctx.fillStyle = colors.headerText
      ctx.font = '600 13px Inter, system-ui, sans-serif'
      ctx.fillText(
        truncateToWidth(ctx, node.data.table?.name ?? '', w - PAD_X * 2),
        x + PAD_X,
        y + HEADER_H / 2,
      )

      // Column rows.
      ctx.font = '12px Inter, system-ui, sans-serif'
      columns.forEach((col, i) => {
        const ry = y + HEADER_H + i * ROW_H
        // PK/FK marker dot.
        if (col.isPrimaryKey || col.isForeignKey) {
          ctx.fillStyle = col.isPrimaryKey ? colors.pk : colors.fk
          ctx.beginPath()
          ctx.arc(x + PAD_X - 4, ry + ROW_H / 2, 3, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = colors.text
        ctx.fillText(
          truncateToWidth(ctx, col.name, w * 0.55),
          x + PAD_X + 6,
          ry + ROW_H / 2,
        )
        // Type, right-aligned.
        ctx.save()
        ctx.textAlign = 'right'
        ctx.globalAlpha = 0.7
        ctx.fillText(
          truncateToWidth(ctx, col.dataType, w * 0.4),
          x + w - PAD_X,
          ry + ROW_H / 2,
        )
        ctx.restore()
      })
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
  }, [enabled, transform, drawNodes, resolvedTheme, resizeTick, forceFullDetail])

  if (!enabled || forceFullDetail) return null

  return (
    <canvas
      ref={canvasRef}
      data-testid="canvas-node-layer"
      className="pointer-events-none absolute inset-0 z-[1000]"
    />
  )
}

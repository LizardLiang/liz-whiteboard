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
import { useEffect, useRef } from 'react'
import { useStore } from '@xyflow/react'
import type { TableNodeData } from '@/lib/react-flow/types'

// Geometry — mirrors TableNode's DOM so canvas tables land on the same pixels.
const HEADER_H = 34
const ROW_H = 28 // === TableNode COLUMN_ROW_HEIGHT
const DEFAULT_W = 220
const PAD_X = 12

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

export function CanvasNodeLayer({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Viewport transform [translateX, translateY, zoom] — updates every pan/zoom
  // frame. This is the whole point: a transform change redraws the canvas
  // instead of re-laying-out 12k DOM nodes.
  const transform = useStore((s) => s.transform)

  // Pull table nodes straight from the store's nodeLookup so this doesn't
  // depend on the parent threading node state down. Only `type === 'table'`
  // nodes are drawn here (areas/comments keep their own render paths).
  const drawNodes = useStore((s) => {
    const out: Array<DrawNode> = []
    for (const [, n] of s.nodeLookup) {
      if (n.type !== 'table' || n.hidden) continue
      const data = n.data as unknown as TableNodeData
      out.push({
        x: n.position.x,
        y: n.position.y,
        w: n.measured?.width ?? (data.table?.width || DEFAULT_W),
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
      const columns = node.data.table?.columns ?? []
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
      ctx.fillText(node.data.table?.name ?? '', x + PAD_X, y + HEADER_H / 2, w - PAD_X * 2)

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
        ctx.fillText(col.name, x + PAD_X + 6, ry + ROW_H / 2, w * 0.55)
        // Type, right-aligned.
        ctx.save()
        ctx.textAlign = 'right'
        ctx.globalAlpha = 0.7
        ctx.fillText(col.dataType, x + w - PAD_X, ry + ROW_H / 2, w * 0.4)
        ctx.restore()
      })
    }
  }, [enabled, transform, drawNodes])

  if (!enabled) return null

  return (
    <canvas
      ref={canvasRef}
      data-testid="canvas-node-layer"
      className="pointer-events-none absolute inset-0 z-[1000]"
    />
  )
}

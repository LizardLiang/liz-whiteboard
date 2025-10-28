// src/components/whiteboard/Minimap.tsx
// Minimap component for canvas navigation - provides overview of entire diagram

import { useEffect, useRef } from 'react'
import type { DiagramTable } from '@prisma/client'
import type { CanvasViewport } from './Canvas'

/**
 * Minimap component props
 */
export interface MinimapProps {
  /** All tables in the whiteboard */
  tables: Array<Pick<DiagramTable, 'id' | 'positionX' | 'positionY'>>
  /** Current canvas viewport state */
  viewport: CanvasViewport
  /** Canvas dimensions */
  canvasWidth: number
  canvasHeight: number
  /** Callback when user clicks on minimap */
  onNavigate?: (x: number, y: number) => void
  /** Minimap width in pixels */
  width?: number
  /** Minimap height in pixels */
  height?: number
}

/**
 * Table dimensions (should match TableNode constants)
 */
const TABLE_WIDTH = 200
const TABLE_HEIGHT = 150

/**
 * Minimap component
 * Shows overview of entire canvas with viewport indicator
 * Click to navigate to different areas
 *
 * @example
 * ```tsx
 * <Minimap
 *   tables={whiteboard.tables}
 *   viewport={canvasViewport}
 *   canvasWidth={window.innerWidth}
 *   canvasHeight={window.innerHeight - 160}
 *   onNavigate={(x, y) => {
 *     // Pan canvas to position
 *   }}
 * />
 * ```
 */
export function Minimap({
  tables,
  viewport,
  canvasWidth,
  canvasHeight,
  onNavigate,
  width = 200,
  height = 150,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /**
   * Calculate bounding box of all tables
   */
  const calculateBounds = () => {
    if (tables.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: canvasWidth,
        maxY: canvasHeight,
        width: canvasWidth,
        height: canvasHeight,
      }
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    tables.forEach((table) => {
      minX = Math.min(minX, table.positionX)
      minY = Math.min(minY, table.positionY)
      maxX = Math.max(maxX, table.positionX + TABLE_WIDTH)
      maxY = Math.max(maxY, table.positionY + TABLE_HEIGHT)
    })

    // Add padding
    const padding = 50
    minX -= padding
    minY -= padding
    maxX += padding
    maxY += padding

    // Include viewport area
    const viewportMinX = -viewport.offsetX / viewport.zoom
    const viewportMinY = -viewport.offsetY / viewport.zoom
    const viewportMaxX = viewportMinX + canvasWidth / viewport.zoom
    const viewportMaxY = viewportMinY + canvasHeight / viewport.zoom

    minX = Math.min(minX, viewportMinX)
    minY = Math.min(minY, viewportMinY)
    maxX = Math.max(maxX, viewportMaxX)
    maxY = Math.max(maxY, viewportMaxY)

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }

  /**
   * Render minimap
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas resolution for crisp rendering
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.fillStyle = '#0a0a0a' // Dark background
    ctx.fillRect(0, 0, width, height)

    // Calculate bounds
    const bounds = calculateBounds()

    // Calculate scale to fit minimap
    const scaleX = width / bounds.width
    const scaleY = height / bounds.height
    const scale = Math.min(scaleX, scaleY)

    // Center offset
    const offsetX = (width - bounds.width * scale) / 2
    const offsetY = (height - bounds.height * scale) / 2

    /**
     * Transform world coordinates to minimap coordinates
     */
    const worldToMinimap = (x: number, y: number) => {
      return {
        x: (x - bounds.minX) * scale + offsetX,
        y: (y - bounds.minY) * scale + offsetY,
      }
    }

    // Draw tables as rectangles
    ctx.fillStyle = '#3b82f6' // Blue for tables
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = 1

    tables.forEach((table) => {
      const pos = worldToMinimap(table.positionX, table.positionY)
      const w = TABLE_WIDTH * scale
      const h = TABLE_HEIGHT * scale

      ctx.fillRect(pos.x, pos.y, w, h)
      ctx.strokeRect(pos.x, pos.y, w, h)
    })

    // Draw viewport rectangle
    const viewportMinX = -viewport.offsetX / viewport.zoom
    const viewportMinY = -viewport.offsetY / viewport.zoom
    const viewportMaxX = viewportMinX + canvasWidth / viewport.zoom
    const viewportMaxY = viewportMinY + canvasHeight / viewport.zoom

    const viewportTopLeft = worldToMinimap(viewportMinX, viewportMinY)
    const viewportBottomRight = worldToMinimap(viewportMaxX, viewportMaxY)

    ctx.strokeStyle = '#22c55e' // Green for viewport
    ctx.lineWidth = 2
    ctx.strokeRect(
      viewportTopLeft.x,
      viewportTopLeft.y,
      viewportBottomRight.x - viewportTopLeft.x,
      viewportBottomRight.y - viewportTopLeft.y,
    )

    // Draw semi-transparent fill for viewport
    ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'
    ctx.fillRect(
      viewportTopLeft.x,
      viewportTopLeft.y,
      viewportBottomRight.x - viewportTopLeft.x,
      viewportBottomRight.y - viewportTopLeft.y,
    )
  }, [tables, viewport, canvasWidth, canvasHeight, width, height])

  /**
   * Handle click on minimap to navigate
   */
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onNavigate) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Calculate bounds
    const bounds = calculateBounds()

    // Calculate scale
    const scaleX = width / bounds.width
    const scaleY = height / bounds.height
    const scale = Math.min(scaleX, scaleY)

    // Center offset
    const offsetX = (width - bounds.width * scale) / 2
    const offsetY = (height - bounds.height * scale) / 2

    // Convert minimap coordinates to world coordinates
    const worldX = (x - offsetX) / scale + bounds.minX
    const worldY = (y - offsetY) / scale + bounds.minY

    // Center viewport on clicked position
    const canvasCenterX = canvasWidth / 2
    const canvasCenterY = canvasHeight / 2

    const newOffsetX = canvasCenterX - worldX * viewport.zoom
    const newOffsetY = canvasCenterY - worldY * viewport.zoom

    onNavigate(newOffsetX, newOffsetY)
  }

  return (
    <div
      className="minimap"
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: '#1a1a1a',
        border: '1px solid #404040',
        borderRadius: '4px',
        overflow: 'hidden',
        cursor: onNavigate ? 'pointer' : 'default',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
      }}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  )
}

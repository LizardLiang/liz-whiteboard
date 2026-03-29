import type { Viewport } from '@xyflow/react'
import type { ReactFlowViewport } from './types'

/**
 * Default viewport configuration
 */
export const DEFAULT_VIEWPORT: ReactFlowViewport = {
  x: 0,
  y: 0,
  zoom: 1,
}

/**
 * Viewport constraints
 */
export const VIEWPORT_CONSTRAINTS = {
  minZoom: 0.1,
  maxZoom: 5,
  zoomStep: 0.1,
} as const

/**
 * Calculate viewport to fit all nodes in view
 * @param nodes - Array of nodes with positions
 * @param viewportWidth - Width of the viewport
 * @param viewportHeight - Height of the viewport
 * @param padding - Padding around the content (default: 50)
 * @returns Calculated viewport
 */
export function calculateFitViewport(
  nodes: Array<{
    position: { x: number; y: number }
    width?: number
    height?: number
  }>,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 50,
): ReactFlowViewport {
  if (nodes.length === 0) {
    return DEFAULT_VIEWPORT
  }

  // Calculate bounding box
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  nodes.forEach((node) => {
    const nodeWidth = node.width || 250 // Default table width
    const nodeHeight = node.height || 200 // Estimated table height

    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + nodeWidth)
    maxY = Math.max(maxY, node.position.y + nodeHeight)
  })

  // Add padding
  minX -= padding
  minY -= padding
  maxX += padding
  maxY += padding

  // Calculate content dimensions
  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  // Calculate zoom to fit
  const zoomX = viewportWidth / contentWidth
  const zoomY = viewportHeight / contentHeight
  const zoom = Math.min(zoomX, zoomY, VIEWPORT_CONSTRAINTS.maxZoom)

  // Calculate offset to center content
  const x = (viewportWidth - contentWidth * zoom) / 2 - minX * zoom
  const y = (viewportHeight - contentHeight * zoom) / 2 - minY * zoom

  return { x, y, zoom }
}

/**
 * Clamp zoom value to valid range
 * @param zoom - Zoom value to clamp
 * @returns Clamped zoom value
 */
export function clampZoom(zoom: number): number {
  return Math.max(
    VIEWPORT_CONSTRAINTS.minZoom,
    Math.min(VIEWPORT_CONSTRAINTS.maxZoom, zoom),
  )
}

/**
 * Calculate zoom step increment
 * @param currentZoom - Current zoom level
 * @param direction - Zoom direction: 1 for zoom in, -1 for zoom out
 * @returns New zoom level
 */
export function calculateZoomStep(
  currentZoom: number,
  direction: 1 | -1,
): number {
  const newZoom = currentZoom + direction * VIEWPORT_CONSTRAINTS.zoomStep
  return clampZoom(newZoom)
}

/**
 * Convert screen coordinates to canvas coordinates
 * @param screenX - Screen X coordinate
 * @param screenY - Screen Y coordinate
 * @param viewport - Current viewport
 * @returns Canvas coordinates
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  }
}

/**
 * Convert canvas coordinates to screen coordinates
 * @param canvasX - Canvas X coordinate
 * @param canvasY - Canvas Y coordinate
 * @param viewport - Current viewport
 * @returns Screen coordinates
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: canvasX * viewport.zoom + viewport.x,
    y: canvasY * viewport.zoom + viewport.y,
  }
}

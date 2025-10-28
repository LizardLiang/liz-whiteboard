// src/components/whiteboard/Canvas.tsx
// Base Konva Stage wrapper component with zoom and pan support

import { useCallback, useEffect, useRef, useState } from 'react'
import { Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'

/**
 * Get CSS variable value from document root
 * @param varName - CSS variable name (e.g., '--canvas-bg')
 * @param fallback - Fallback value if variable not found
 * @returns Color value
 */
function getCSSVariable(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  try {
    const root = document.documentElement
    const value = getComputedStyle(root).getPropertyValue(varName).trim()
    return value || fallback
  } catch (error) {
    console.error(`Failed to read CSS variable ${varName}:`, error)
    return fallback
  }
}

/**
 * Canvas viewport state
 */
export interface CanvasViewport {
  zoom: number
  offsetX: number
  offsetY: number
}

/**
 * Canvas component props
 */
export interface CanvasProps {
  /** Canvas width in pixels */
  width: number
  /** Canvas height in pixels */
  height: number
  /** Initial viewport state */
  initialViewport?: CanvasViewport
  /** Callback when viewport changes (zoom or pan) */
  onViewportChange?: (viewport: CanvasViewport) => void
  /** Child elements to render on canvas */
  children?: React.ReactNode
  /** Optional CSS class name */
  className?: string
  /** Optional stage ref to access Konva stage externally */
  stageRef?: React.RefObject<Konva.Stage>
}

/**
 * Zoom constraints
 */
const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
const ZOOM_SPEED = 0.1

/**
 * Base Canvas component with zoom and pan support
 * Uses Konva Stage for rendering
 *
 * Features:
 * - Mouse wheel zoom (centered on cursor position)
 * - Pan by dragging empty space
 * - Touch pinch-to-zoom support
 * - Viewport state management
 *
 * @example
 * ```tsx
 * <Canvas
 *   width={800}
 *   height={600}
 *   initialViewport={{ zoom: 1, offsetX: 0, offsetY: 0 }}
 *   onViewportChange={(viewport) => saveViewport(viewport)}
 * >
 *   <TableNode table={table} />
 *   <RelationshipEdge relationship={rel} />
 * </Canvas>
 * ```
 */
export function Canvas({
  width,
  height,
  initialViewport = { zoom: 1, offsetX: 0, offsetY: 0 },
  onViewportChange,
  children,
  className = '',
  stageRef: externalStageRef,
}: CanvasProps) {
  const internalStageRef = useRef<Konva.Stage>(null)
  const stageRef = externalStageRef || internalStageRef
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport)
  const [isPanning, setIsPanning] = useState(false)
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const pendingViewportRef = useRef<CanvasViewport | null>(null)

  /**
   * Update viewport state and notify parent
   */
  const updateViewport = useCallback(
    (newViewport: CanvasViewport) => {
      setViewport(newViewport)
      onViewportChange?.(newViewport)
    },
    [onViewportChange],
  )

  /**
   * Handle mouse wheel zoom
   * Zooms toward/away from cursor position
   */
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()

      const stage = stageRef.current
      if (!stage) return

      const oldZoom = viewport.zoom
      const pointer = stage.getPointerPosition()
      if (!pointer) return

      // Calculate zoom direction and amount
      const direction = e.evt.deltaY > 0 ? -1 : 1
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, oldZoom + direction * ZOOM_SPEED),
      )

      if (newZoom === oldZoom) return

      // Calculate new position to zoom toward cursor
      const mousePointTo = {
        x: (pointer.x - viewport.offsetX) / oldZoom,
        y: (pointer.y - viewport.offsetY) / oldZoom,
      }

      const newOffsetX = pointer.x - mousePointTo.x * newZoom
      const newOffsetY = pointer.y - mousePointTo.y * newZoom

      updateViewport({
        zoom: newZoom,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      })
    },
    [viewport, updateViewport],
  )

  /**
   * Handle mouse down - detect if clicking on empty space
   */
  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return

    // Check if clicked on empty space (Stage) vs a shape (TableNode, etc.)
    const clickedOnEmpty = e.target === stage

    if (clickedOnEmpty) {
      e.evt.preventDefault()
      setIsPanning(true)
      const pointer = stage.getPointerPosition()
      if (pointer) {
        lastPointerPosition.current = pointer
      }
    }
  }, [])

  /**
   * Apply viewport changes to stage
   */
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    stage.scale({ x: viewport.zoom, y: viewport.zoom })
    stage.position({ x: viewport.offsetX, y: viewport.offsetY })
    stage.batchDraw()
  }, [viewport])

  /**
   * Reset viewport when initial viewport prop changes
   */
  useEffect(() => {
    setViewport(initialViewport)
  }, [initialViewport])

  /**
   * Handle mouse move for panning when dragging empty space
   * Uses RAF throttling and direct stage manipulation for smooth 60fps panning
   */
  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!isPanning) return

      e.evt.preventDefault()

      const stage = stageRef.current
      if (!stage) return

      const pointer = stage.getPointerPosition()
      if (!pointer || !lastPointerPosition.current) return

      const dx = pointer.x - lastPointerPosition.current.x
      const dy = pointer.y - lastPointerPosition.current.y

      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }

      // Store the pending viewport update
      const currentPos = stage.position()
      const newOffsetX = currentPos.x + dx
      const newOffsetY = currentPos.y + dy

      pendingViewportRef.current = {
        zoom: viewport.zoom,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      }

      // Schedule RAF update
      rafIdRef.current = requestAnimationFrame(() => {
        const stage = stageRef.current
        if (!stage || !pendingViewportRef.current) return

        // Apply position directly to stage (no state update during drag)
        stage.position({
          x: pendingViewportRef.current.offsetX,
          y: pendingViewportRef.current.offsetY,
        })
        stage.batchDraw()

        rafIdRef.current = null
      })

      lastPointerPosition.current = pointer
    },
    [isPanning, viewport.zoom],
  )

  /**
   * Handle mouse up - stop panning and sync viewport state
   */
  const handleMouseUp = useCallback(() => {
    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }

    // Sync final position to React state
    const stage = stageRef.current
    if (stage && pendingViewportRef.current) {
      updateViewport(pendingViewportRef.current)
      pendingViewportRef.current = null
    }

    setIsPanning(false)
    lastPointerPosition.current = null
  }, [updateViewport])

  // Read theme-aware colors from CSS variables
  const canvasBg = getCSSVariable('--canvas-bg', '#0a0a0a')
  const zoomIndicatorBg = getCSSVariable(
    '--canvas-zoom-indicator-bg',
    '#1a1a1a',
  )
  const zoomIndicatorText = getCSSVariable(
    '--canvas-zoom-indicator-text',
    '#a3a3a3',
  )
  const zoomIndicatorBorder = getCSSVariable(
    '--canvas-zoom-indicator-border',
    '#404040',
  )

  return (
    <div
      className={`canvas-container ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab',
        backgroundColor: canvasBg,
      }}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        draggable={false}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>{children}</Layer>
      </Stage>

      {/* Zoom level indicator */}
      <div
        className="zoom-indicator"
        style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          backgroundColor: zoomIndicatorBg,
          color: zoomIndicatorText,
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: 500,
          pointerEvents: 'none',
          border: `1px solid ${zoomIndicatorBorder}`,
        }}
      >
        {Math.round(viewport.zoom * 100)}%
      </div>
    </div>
  )
}

/**
 * Hook to programmatically control canvas viewport
 * @param stageRef - Ref to Konva Stage
 * @param onViewportChange - Callback when viewport changes
 * @returns Viewport control functions
 */
export function useCanvasControls(
  stageRef: React.RefObject<Konva.Stage>,
  onViewportChange?: (viewport: CanvasViewport) => void,
) {
  /**
   * Notify parent of viewport change from stage state
   */
  const notifyViewportChange = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !onViewportChange) return

    onViewportChange({
      zoom: stage.scaleX(),
      offsetX: stage.x(),
      offsetY: stage.y(),
    })
  }, [stageRef, onViewportChange])

  /**
   * Zoom in by one step
   */
  const zoomIn = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return

    const oldZoom = stage.scaleX()
    const newZoom = Math.min(MAX_ZOOM, oldZoom + ZOOM_SPEED)

    // Zoom toward center
    const center = {
      x: stage.width() / 2,
      y: stage.height() / 2,
    }

    const mousePointTo = {
      x: (center.x - stage.x()) / oldZoom,
      y: (center.y - stage.y()) / oldZoom,
    }

    stage.scale({ x: newZoom, y: newZoom })
    stage.position({
      x: center.x - mousePointTo.x * newZoom,
      y: center.y - mousePointTo.y * newZoom,
    })
    stage.batchDraw()

    // Notify parent
    notifyViewportChange()
  }, [stageRef, notifyViewportChange])

  /**
   * Zoom out by one step
   */
  const zoomOut = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return

    const oldZoom = stage.scaleX()
    const newZoom = Math.max(MIN_ZOOM, oldZoom - ZOOM_SPEED)

    // Zoom toward center
    const center = {
      x: stage.width() / 2,
      y: stage.height() / 2,
    }

    const mousePointTo = {
      x: (center.x - stage.x()) / oldZoom,
      y: (center.y - stage.y()) / oldZoom,
    }

    stage.scale({ x: newZoom, y: newZoom })
    stage.position({
      x: center.x - mousePointTo.x * newZoom,
      y: center.y - mousePointTo.y * newZoom,
    })
    stage.batchDraw()

    // Notify parent
    notifyViewportChange()
  }, [stageRef, notifyViewportChange])

  /**
   * Reset zoom to 100% and center canvas
   */
  const resetZoom = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return

    stage.scale({ x: 1, y: 1 })
    stage.position({ x: 0, y: 0 })
    stage.batchDraw()

    // Notify parent
    notifyViewportChange()
  }, [stageRef, notifyViewportChange])

  /**
   * Fit all content to viewport
   * @param padding - Padding around content in pixels
   */
  const fitToScreen = useCallback(
    (padding = 50) => {
      const stage = stageRef.current
      if (!stage) return

      const layer = stage.getLayers()[0]
      if (!layer) return

      // Get bounding box of all content
      const clientRect = layer.getClientRect()

      if (clientRect.width === 0 || clientRect.height === 0) {
        // No content, reset to default
        resetZoom()
        return
      }

      // Calculate zoom to fit content with padding
      const scaleX = (stage.width() - padding * 2) / clientRect.width
      const scaleY = (stage.height() - padding * 2) / clientRect.height
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.min(scaleX, scaleY)),
      )

      // Center content
      const newOffsetX =
        (stage.width() - clientRect.width * newZoom) / 2 -
        clientRect.x * newZoom
      const newOffsetY =
        (stage.height() - clientRect.height * newZoom) / 2 -
        clientRect.y * newZoom

      stage.scale({ x: newZoom, y: newZoom })
      stage.position({ x: newOffsetX, y: newOffsetY })
      stage.batchDraw()

      // Notify parent
      notifyViewportChange()
    },
    [stageRef, resetZoom, notifyViewportChange],
  )

  return {
    zoomIn,
    zoomOut,
    resetZoom,
    fitToScreen,
  }
}

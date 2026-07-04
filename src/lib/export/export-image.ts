// src/lib/export/export-image.ts
// Exports the full whiteboard diagram (all tables + relationships) as a
// downloadable PNG or SVG image, independent of the current pan/zoom.
//
// Follows React Flow's documented "download image" recipe: compute the
// bounding box of all nodes, derive a viewport transform that fits that box
// exactly, then rasterize/vectorize the `.react-flow__viewport` DOM node
// with html-to-image at that transform. Minimap/controls/toolbar sit
// outside `.react-flow__viewport` and are excluded automatically.

import { toPng, toSvg } from 'html-to-image'
import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import type { Node } from '@xyflow/react'

/** Export image format */
export type ExportImageFormat = 'png' | 'svg'

/** Export background mode */
export type ExportImageBackground = 'solid' | 'transparent'

/** Padding fraction applied around the diagram's natural bounds (10%) */
export const EXPORT_PADDING = 0.1

/** Minimum/maximum zoom allowed when fitting the export viewport */
const EXPORT_MIN_ZOOM = 0.5
const EXPORT_MAX_ZOOM = 2

/** Pixel ratio used for PNG export — keeps text/lines crisp on export */
export const PNG_PIXEL_RATIO = 2

/** Fallback filename stem when the whiteboard has no usable name */
export const FALLBACK_FILENAME = 'diagram'

export interface ExportDiagramImageOptions {
  /** Current React Flow nodes (used to compute natural bounds) */
  nodes: Array<Node>
  /** The `.react-flow__viewport` DOM element to capture */
  viewportEl: HTMLElement
  /** Output format */
  format: ExportImageFormat
  /** Background mode — 'solid' fills `themeBg`, 'transparent' omits a background */
  background: ExportImageBackground
  /** Resolved theme background color (e.g. computed style of `.react-flow`),
   * used only when background is 'solid' */
  themeBg: string
  /** Whiteboard name — sanitized into the download filename */
  filename: string | null | undefined
}

/**
 * Sanitize a whiteboard name into a safe filename stem.
 * Falls back to "diagram" when the result would be empty.
 */
export function sanitizeFilename(name: string | null | undefined): string {
  const sanitized = (name ?? '').trim().replace(/[^\w.-]+/g, '_')
  return sanitized.length > 0 ? sanitized : FALLBACK_FILENAME
}

/**
 * Compute the width/height/transform needed to capture the full diagram at
 * its natural bounds, independent of the current on-screen pan/zoom.
 */
export function computeExportViewport(nodes: Array<Node>): {
  width: number
  height: number
  viewport: { x: number; y: number; zoom: number }
} {
  const bounds = getNodesBounds(nodes)
  // A 0x0 bounding box means the nodes haven't been measured yet (React Flow's
  // ResizeObserver hasn't run) — exporting now would silently produce a valid
  // but near-blank image. Throw so the caller's catch surfaces a toast instead
  // of handing the user a "successful" but broken download.
  if (bounds.width === 0 && bounds.height === 0) {
    throw new Error('Diagram not ready to export — try again in a moment')
  }
  // Guard against a residual zero dimension (e.g. a single zero-height node) —
  // html-to-image / the browser canvas can't render a 0-sized image.
  const width = Math.max(bounds.width, 1) * (1 + EXPORT_PADDING * 2)
  const height = Math.max(bounds.height, 1) * (1 + EXPORT_PADDING * 2)
  const viewport = getViewportForBounds(
    bounds,
    width,
    height,
    EXPORT_MIN_ZOOM,
    EXPORT_MAX_ZOOM,
    EXPORT_PADDING,
  )
  return { width, height, viewport }
}

/**
 * Trigger a browser download for a data URL, then release the reference.
 */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Export the full whiteboard diagram as a PNG or SVG image and trigger a
 * browser download. Captures at the diagram's natural bounds regardless of
 * the current pan/zoom (React Flow's documented download-image recipe).
 *
 * @throws when html-to-image fails to rasterize/vectorize the DOM node —
 * callers should wrap this in a try/catch and surface a user-facing error.
 */
export async function exportDiagramImage({
  nodes,
  viewportEl,
  format,
  background,
  themeBg,
  filename,
}: ExportDiagramImageOptions): Promise<void> {
  const { width, height, viewport } = computeExportViewport(nodes)

  const captureOptions = {
    width,
    height,
    backgroundColor: background === 'solid' ? themeBg : undefined,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  }

  const stem = sanitizeFilename(filename)

  if (format === 'png') {
    const dataUrl = await toPng(viewportEl, {
      ...captureOptions,
      pixelRatio: PNG_PIXEL_RATIO,
    })
    downloadDataUrl(dataUrl, `${stem}.png`)
  } else {
    const dataUrl = await toSvg(viewportEl, captureOptions)
    downloadDataUrl(dataUrl, `${stem}.svg`)
  }
}

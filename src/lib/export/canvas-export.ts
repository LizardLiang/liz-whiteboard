import { connectorPathOf, resolvedBounds } from '@/lib/canvas-engine/hit-test'
import {
  CONNECTOR_ARROW_SIZE,
  renderPersistentScene,
} from '@/lib/canvas-engine/render'
import {
  CanvasRenderTarget,
  FONT_FAMILY,
} from '@/lib/canvas-engine/render-target'
import { EXPORT_PADDING, PNG_PIXEL_RATIO, sanitizeFilename } from './export-image'
import type { CanvasTheme } from '@/lib/canvas-engine/render'
import type {
  PersistentRenderTarget,
  RenderPaint,
  RenderPathCommand,
  RenderTextLine,
} from '@/lib/canvas-engine/render-target'
import type { Scene } from '@/lib/canvas-engine/scene'
import type { WorldRect } from '@/lib/canvas-engine/hit-test'
import type {
  ExportImageBackground,
  ExportImageFormat,
} from './export-image'

export const CANVAS_EXPORT_MIN_PADDING = 12

export interface CanvasExportOptions {
  scene: Scene
  theme: CanvasTheme
  format: ExportImageFormat
  background: ExportImageBackground
  backgroundColor: string
  filename: string | null | undefined
}

interface SvgSerializationOptions {
  scene: Scene
  theme: CanvasTheme
  background: ExportImageBackground
  backgroundColor: string
  measureText: (text: string, fontSize: number) => number
}

function isDrawable(scene: Scene, index: number): boolean {
  const element = scene.elements[index]
  if (element.connector) return connectorPathOf(scene, element) !== null
  if (element.kind === 'group') return true
  if ((element.text ?? '').length > 0) return true
  return element.style.fill !== 'none' || element.style.strokeWidth > 0
}

function expandedElementBounds(
  scene: Scene,
  index: number,
): WorldRect | null {
  const element = scene.elements[index]
  const rect = resolvedBounds(scene, element)
  if (!rect || !isDrawable(scene, index)) return null
  const outline =
    (element.connector ? CONNECTOR_ARROW_SIZE : 0) + element.style.strokeWidth / 2
  const groupOutline = element.kind === 'group' ? 0.5 : 0
  const expansion = Math.max(outline, groupOutline)
  return {
    x: rect.x - expansion,
    y: rect.y - expansion,
    width: rect.width + expansion * 2,
    height: rect.height + expansion * 2,
  }
}

/** Bounds of every drawable persistent element, including output padding. */
export function canvasExportBounds(scene: Scene): WorldRect {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (let index = 0; index < scene.elements.length; index += 1) {
    const rect = expandedElementBounds(scene, index)
    if (!rect) continue
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }

  if (![left, top, right, bottom].every(Number.isFinite)) {
    throw new Error('This canvas has nothing to export')
  }

  const contentWidth = Math.max(1, right - left)
  const contentHeight = Math.max(1, bottom - top)
  const padding = Math.max(
    CANVAS_EXPORT_MIN_PADDING,
    Math.max(contentWidth, contentHeight) * EXPORT_PADDING,
  )
  return {
    x: left - padding,
    y: top - padding,
    width: contentWidth + padding * 2,
    height: contentHeight + padding * 2,
  }
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function n(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return Number(normalized.toFixed(4)).toString()
}

function paintAttributes(paint: RenderPaint): string {
  const attributes = [
    `fill="${xml(paint.fill ?? 'none')}"`,
    `stroke="${xml(paint.stroke ?? 'none')}"`,
  ]
  if (paint.stroke && paint.strokeWidth !== undefined) {
    attributes.push(`stroke-width="${n(paint.strokeWidth)}"`)
  }
  if (paint.lineJoin) attributes.push(`stroke-linejoin="${paint.lineJoin}"`)
  if (paint.lineCap) attributes.push(`stroke-linecap="${paint.lineCap}"`)
  return attributes.join(' ')
}

class SvgRenderTarget implements PersistentRenderTarget {
  readonly nodes: Array<string> = []

  constructor(
    private readonly measure: (text: string, fontSize: number) => number,
  ) {}

  measureText(text: string, fontSize: number): number {
    return this.measure(text, fontSize)
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    paint: RenderPaint,
  ): void {
    const rounded = radius > 0 ? ` rx="${n(radius)}" ry="${n(radius)}"` : ''
    this.nodes.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"${rounded} ${paintAttributes(paint)}/>`,
    )
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    paint: RenderPaint,
  ): void {
    this.nodes.push(
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${paintAttributes(paint)}/>`,
    )
  }

  path(commands: ReadonlyArray<RenderPathCommand>, paint: RenderPaint): void {
    const data = commands
      .map((command) => {
        if (command.kind === 'move')
          return `M ${n(command.point.x)} ${n(command.point.y)}`
        if (command.kind === 'line')
          return `L ${n(command.point.x)} ${n(command.point.y)}`
        if (command.kind === 'cubic') {
          return `C ${n(command.c0.x)} ${n(command.c0.y)} ${n(command.c1.x)} ${n(command.c1.y)} ${n(command.to.x)} ${n(command.to.y)}`
        }
        return 'Z'
      })
      .join(' ')
    this.nodes.push(`<path d="${data}" ${paintAttributes(paint)}/>`)
  }

  text(
    lines: ReadonlyArray<RenderTextLine>,
    fontSize: number,
    color: string,
  ): void {
    const tspans = lines
      .map(
        (line) =>
          `<tspan x="${n(line.x)}" y="${n(line.y)}">${xml(line.text)}</tspan>`,
      )
      .join('')
    this.nodes.push(
      `<text fill="${xml(color)}" font-family="${xml(FONT_FAMILY)}" font-size="${n(fontSize)}" dominant-baseline="text-before-edge">${tspans}</text>`,
    )
  }
}

export function serializeCanvasSceneSvg({
  scene,
  theme,
  background,
  backgroundColor,
  measureText,
}: SvgSerializationOptions): string {
  const bounds = canvasExportBounds(scene)
  const target = new SvgRenderTarget(measureText)
  renderPersistentScene(target, scene, theme)
  const backgroundNode =
    background === 'solid'
      ? `<rect data-export-background="true" x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}" fill="${xml(backgroundColor)}"/>`
      : ''
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(bounds.width)}" height="${n(bounds.height)}" viewBox="${n(bounds.x)} ${n(bounds.y)} ${n(bounds.width)} ${n(bounds.height)}">`,
    backgroundNode,
    ...target.nodes,
    '</svg>',
  ].join('')
}

function scratchMeasurer(): (text: string, fontSize: number) => number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas export is unavailable in this browser')
  return (text, fontSize) => {
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    return ctx.measureText(text).width
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = href
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG encoding failed'))
    }, 'image/png')
  })
}

/** Render and download a complete Canvas 2D scene. */
export async function exportCanvasScene(
  options: CanvasExportOptions,
): Promise<void> {
  const bounds = canvasExportBounds(options.scene)
  const stem = sanitizeFilename(options.filename)

  if (options.format === 'svg') {
    const svg = serializeCanvasSceneSvg({
      scene: options.scene,
      theme: options.theme,
      background: options.background,
      backgroundColor: options.backgroundColor,
      measureText: scratchMeasurer(),
    })
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${stem}.svg`,
    )
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(bounds.width * PNG_PIXEL_RATIO)
  canvas.height = Math.ceil(bounds.height * PNG_PIXEL_RATIO)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas export is unavailable in this browser')
  ctx.setTransform(
    PNG_PIXEL_RATIO,
    0,
    0,
    PNG_PIXEL_RATIO,
    -bounds.x * PNG_PIXEL_RATIO,
    -bounds.y * PNG_PIXEL_RATIO,
  )
  if (options.background === 'solid') {
    ctx.fillStyle = options.backgroundColor
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  }
  renderPersistentScene(
    new CanvasRenderTarget(ctx),
    options.scene,
    options.theme,
  )
  downloadBlob(await canvasBlob(canvas), `${stem}.png`)
}

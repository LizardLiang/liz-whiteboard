import {
  EXPORT_PADDING,
  PNG_PIXEL_RATIO,
  sanitizeFilename,
} from './export-image'
import type { CanvasTheme } from '@/lib/canvas-engine/render'
import type {
  PersistentRenderTarget,
  RenderPaint,
  RenderPathCommand,
  RenderTextLine,
} from '@/lib/canvas-engine/render-target'
import type { Scene } from '@/lib/canvas-engine/scene'
import type { WorldRect } from '@/lib/canvas-engine/hit-test'
import type { ExportImageBackground, ExportImageFormat } from './export-image'
import {
  CanvasRenderTarget,
  FONT_FAMILY,
} from '@/lib/canvas-engine/render-target'
import {
  CONNECTOR_ARROW_SIZE,
  layoutElementText,
  renderPersistentScene,
  textFrame,
  textOriginY,
} from '@/lib/canvas-engine/render'
import { connectorPathOf, resolvedBounds } from '@/lib/canvas-engine/hit-test'

export const CANVAS_EXPORT_MIN_PADDING = 12
export const PNG_MAX_DIMENSION = 16_384
export const PNG_MAX_PIXELS = 67_108_864

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
  if (element.connector) {
    return (
      element.style.strokeWidth > 0 && connectorPathOf(scene, element) !== null
    )
  }
  if (element.kind === 'group') return true
  if ((element.text ?? '').length > 0) return true
  return element.style.fill !== 'none' || element.style.strokeWidth > 0
}

function expandedElementBounds(scene: Scene, index: number): WorldRect | null {
  const element = scene.elements[index]
  if (element.kind === 'text') return null
  const rect = resolvedBounds(scene, element)
  if (!rect || !isDrawable(scene, index)) return null
  const outline =
    (element.connector ? CONNECTOR_ARROW_SIZE : 0) +
    element.style.strokeWidth / 2
  const groupOutline = element.kind === 'group' ? 0.5 : 0
  const expansion = Math.max(outline, groupOutline)
  return {
    x: rect.x - expansion,
    y: rect.y - expansion,
    width: rect.width + expansion * 2,
    height: rect.height + expansion * 2,
  }
}

function textBounds(
  scene: Scene,
  index: number,
  measureText: (text: string, fontSize: number) => number,
): WorldRect | null {
  const element = scene.elements[index]
  if (element.connector || (element.text ?? '').length === 0) return null

  const measure = (text: string) => measureText(text, element.style.fontSize)
  const layout = layoutElementText(element, measure)
  const frame = textFrame(element)
  const originY = textOriginY(element, layout)
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY

  for (const line of layout.lines) {
    const lineLeft = frame.x + line.carets[0]
    left = Math.min(left, lineLeft)
    right = Math.max(right, lineLeft + line.width)
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return {
    x: left,
    y: originY,
    width: Math.max(0, right - left),
    height: layout.height,
  }
}

/** Bounds of every drawable persistent element, including rendered text. */
export function canvasExportBounds(
  scene: Scene,
  measureText: (text: string, fontSize: number) => number,
): WorldRect {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (let index = 0; index < scene.elements.length; index += 1) {
    const rect = expandedElementBounds(scene, index)
    const text = textBounds(scene, index, measureText)
    for (const bounds of [rect, text]) {
      if (!bounds) continue
      left = Math.min(left, bounds.x)
      top = Math.min(top, bounds.y)
      right = Math.max(right, bounds.x + bounds.width)
      bottom = Math.max(bottom, bounds.y + bounds.height)
    }
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
  let valid = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (
      codePoint !== undefined &&
      (codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff))
    ) {
      valid += character
    }
  }
  return valid
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const SAFE_HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i
const SAFE_FUNCTION_COLOR = /^(?:rgb|rgba|hsl|hsla)\([\s\d.,%+\-/]*\)$/i
const SAFE_COLOR_KEYWORDS = new Set(['black', 'white', 'transparent'])

function svgColor(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? ''
  if (
    SAFE_HEX_COLOR.test(normalized) ||
    SAFE_FUNCTION_COLOR.test(normalized) ||
    SAFE_COLOR_KEYWORDS.has(normalized.toLowerCase())
  ) {
    return normalized
  }
  return fallback
}

function n(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return Number(normalized.toFixed(4)).toString()
}

function paintAttributes(paint: RenderPaint): string {
  const attributes = [
    `fill="${xml(paint.fill === undefined ? 'none' : svgColor(paint.fill, '#000000'))}"`,
    `stroke="${xml(paint.stroke === undefined ? 'none' : svgColor(paint.stroke, '#000000'))}"`,
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
      `<text fill="${xml(svgColor(color, '#0f172a'))}" font-family="${xml(FONT_FAMILY)}" font-size="${n(fontSize)}" dominant-baseline="text-before-edge">${tspans}</text>`,
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
  const bounds = canvasExportBounds(scene, measureText)
  const target = new SvgRenderTarget(measureText)
  renderPersistentScene(target, scene, theme)
  const backgroundNode =
    background === 'solid'
      ? `<rect data-export-background="true" x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}" fill="${xml(svgColor(backgroundColor, theme === 'dark' ? '#020617' : '#ffffff'))}"/>`
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

export function pngExportDimensions(bounds: WorldRect): {
  width: number
  height: number
} {
  const width = Math.ceil(bounds.width * PNG_PIXEL_RATIO)
  const height = Math.ceil(bounds.height * PNG_PIXEL_RATIO)
  if (
    width > PNG_MAX_DIMENSION ||
    height > PNG_MAX_DIMENSION ||
    width * height > PNG_MAX_PIXELS
  ) {
    throw new Error('Canvas is too large to export as PNG')
  }
  return { width, height }
}

/** Render and download a complete Canvas 2D scene. */
export async function exportCanvasScene(
  options: CanvasExportOptions,
): Promise<void> {
  const measureText = scratchMeasurer()
  const bounds = canvasExportBounds(options.scene, measureText)
  const stem = sanitizeFilename(options.filename)

  if (options.format === 'svg') {
    const svg = serializeCanvasSceneSvg({
      scene: options.scene,
      theme: options.theme,
      background: options.background,
      backgroundColor: options.backgroundColor,
      measureText,
    })
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${stem}.svg`,
    )
    return
  }

  const canvas = document.createElement('canvas')
  const dimensions = pngExportDimensions(bounds)
  canvas.width = dimensions.width
  canvas.height = dimensions.height
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

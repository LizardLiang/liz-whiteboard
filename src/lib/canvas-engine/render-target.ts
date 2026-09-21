import type { Point } from './camera'

export type RenderPathCommand =
  | { kind: 'move'; point: Point }
  | { kind: 'line'; point: Point }
  | { kind: 'cubic'; c0: Point; c1: Point; to: Point }
  | { kind: 'close' }

export interface RenderPaint {
  fill?: string
  stroke?: string
  strokeWidth?: number
  lineJoin?: CanvasLineJoin
  lineCap?: CanvasLineCap
}

export interface RenderTextLine {
  text: string
  x: number
  y: number
}

/**
 * Persistent scene primitives. Geometry and layout are decided by the engine;
 * targets only translate those decisions to a concrete output format.
 */
export interface PersistentRenderTarget {
  measureText(text: string, fontSize: number): number
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    paint: RenderPaint,
  ): void
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    paint: RenderPaint,
  ): void
  path(commands: ReadonlyArray<RenderPathCommand>, paint: RenderPaint): void
  text(
    lines: ReadonlyArray<RenderTextLine>,
    fontSize: number,
    color: string,
  ): void
}

export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK TC", sans-serif'

export function canvasFont(fontSize: number): string {
  return `${fontSize}px ${FONT_FAMILY}`
}

export class CanvasRenderTarget implements PersistentRenderTarget {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  measureText(text: string, fontSize: number): number {
    this.ctx.font = canvasFont(fontSize)
    return this.ctx.measureText(text).width
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    paint: RenderPaint,
  ): void {
    if (radius <= 0) {
      if (paint.fill) {
        this.ctx.fillStyle = paint.fill
        this.ctx.fillRect(x, y, width, height)
      }
      if (paint.stroke && (paint.strokeWidth ?? 0) > 0) {
        this.ctx.strokeStyle = paint.stroke
        this.ctx.lineWidth = paint.strokeWidth ?? 1
        this.ctx.strokeRect(x, y, width, height)
      }
      return
    }

    const right = x + width
    const bottom = y + height
    this.ctx.beginPath()
    this.ctx.moveTo(x + radius, y)
    this.ctx.lineTo(right - radius, y)
    this.ctx.arcTo(right, y, right, y + radius, radius)
    this.ctx.lineTo(right, bottom - radius)
    this.ctx.arcTo(right, bottom, right - radius, bottom, radius)
    this.ctx.lineTo(x + radius, bottom)
    this.ctx.arcTo(x, bottom, x, bottom - radius, radius)
    this.ctx.lineTo(x, y + radius)
    this.ctx.arcTo(x, y, x + radius, y, radius)
    this.ctx.closePath()
    this.paint(paint)
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    paint: RenderPaint,
  ): void {
    this.ctx.beginPath()
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    this.ctx.closePath()
    this.paint(paint)
  }

  path(commands: ReadonlyArray<RenderPathCommand>, paint: RenderPaint): void {
    if (commands.length === 0) return
    this.ctx.beginPath()
    for (const command of commands) {
      if (command.kind === 'move') {
        this.ctx.moveTo(command.point.x, command.point.y)
      } else if (command.kind === 'line') {
        this.ctx.lineTo(command.point.x, command.point.y)
      } else if (command.kind === 'cubic') {
        this.ctx.bezierCurveTo(
          command.c0.x,
          command.c0.y,
          command.c1.x,
          command.c1.y,
          command.to.x,
          command.to.y,
        )
      } else {
        this.ctx.closePath()
      }
    }
    this.paint(paint)
  }

  text(
    lines: ReadonlyArray<RenderTextLine>,
    fontSize: number,
    color: string,
  ): void {
    this.ctx.fillStyle = color
    this.ctx.font = canvasFont(fontSize)
    this.ctx.textBaseline = 'top'
    this.ctx.textAlign = 'left'
    for (const line of lines) this.ctx.fillText(line.text, line.x, line.y)
  }

  private paint(paint: RenderPaint): void {
    if (paint.fill) {
      this.ctx.fillStyle = paint.fill
      this.ctx.fill()
    }
    if (paint.stroke && (paint.strokeWidth ?? 0) > 0) {
      const priorJoin = this.ctx.lineJoin
      const priorCap = this.ctx.lineCap
      this.ctx.strokeStyle = paint.stroke
      this.ctx.lineWidth = paint.strokeWidth ?? 1
      if (paint.lineJoin) this.ctx.lineJoin = paint.lineJoin
      if (paint.lineCap) this.ctx.lineCap = paint.lineCap
      this.ctx.stroke()
      this.ctx.lineJoin = priorJoin
      this.ctx.lineCap = priorCap
    }
  }
}

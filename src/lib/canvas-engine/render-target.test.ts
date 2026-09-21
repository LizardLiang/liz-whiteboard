import { describe, expect, it } from 'vitest'
import { renderPersistentScene } from './render'
import { sceneFrom } from './scene'
import type {
  PersistentRenderTarget,
  RenderPaint,
  RenderPathCommand,
  RenderTextLine,
} from './render-target'
import type { CanvasElement } from './scene'

class RecordingTarget implements PersistentRenderTarget {
  calls: Array<{ kind: string; payload: unknown }> = []

  measureText(text: string, fontSize: number) {
    return text.length * fontSize * 0.5
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    paint: RenderPaint,
  ) {
    this.calls.push({
      kind: 'rect',
      payload: { x, y, width, height, radius, paint },
    })
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, paint: RenderPaint) {
    this.calls.push({ kind: 'ellipse', payload: { cx, cy, rx, ry, paint } })
  }

  path(commands: ReadonlyArray<RenderPathCommand>, paint: RenderPaint) {
    this.calls.push({ kind: 'path', payload: { commands, paint } })
  }

  text(lines: ReadonlyArray<RenderTextLine>, fontSize: number, color: string) {
    this.calls.push({ kind: 'text', payload: { lines, fontSize, color } })
  }
}

const baseStyle = {
  fill: '#fff',
  stroke: '#123456',
  strokeWidth: 2,
  fontSize: 16,
  color: '#0f172a',
  cornerRadius: 8,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
}

function element(patch: Partial<CanvasElement>): CanvasElement {
  return {
    id: 'shape',
    kind: 'rectangle',
    x: 10,
    y: 20,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 1,
    text: 'hello world',
    style: baseStyle,
    ...patch,
  }
}

describe('renderPersistentScene', () => {
  it('emits connectors before shapes and keeps text layout above the target boundary', () => {
    const source = element({ id: 'source', x: 0, y: 0, zIndex: 0 })
    const target = element({ id: 'target', x: 300, y: 0, zIndex: 1 })
    const connector = element({
      id: 'connector',
      kind: 'connector',
      zIndex: 99,
      text: null,
      connector: {
        source: { kind: 'element', elementId: source.id },
        target: { kind: 'element', elementId: target.id },
        routing: 'curved',
      },
    })
    const scene = sceneFrom([source, target, connector])
    const recorder = new RecordingTarget()

    renderPersistentScene(recorder, scene, 'light')

    expect(recorder.calls[0].kind).toBe('path')
    expect(recorder.calls.filter((call) => call.kind === 'text')).toHaveLength(
      2,
    )
    expect(recorder.calls.at(-1)?.kind).toBe('text')
  })

  it.each(['rectangle', 'ellipse', 'diamond', 'triangle'] as const)(
    'emits supported %s geometry',
    (kind) => {
      const recorder = new RecordingTarget()
      renderPersistentScene(recorder, sceneFrom([element({ kind })]), 'dark')
      expect(recorder.calls.some((call) => call.kind !== 'text')).toBe(true)
    },
  )

  it('emits elbow bend points and an explicit open arrowhead', () => {
    const source = element({ id: 'source', x: 0, y: 0 })
    const target = element({ id: 'target', x: 300, y: 160 })
    const connector = element({
      id: 'connector',
      kind: 'connector',
      text: null,
      connector: {
        source: { kind: 'element', elementId: source.id },
        target: { kind: 'element', elementId: target.id },
        routing: 'elbow',
      },
    })
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([source, target, connector]),
      'light',
    )

    const connectorPaths = recorder.calls.filter((call) => call.kind === 'path')
    expect(connectorPaths).toHaveLength(2)
    expect(connectorPaths[1].payload).toMatchObject({
      paint: { lineCap: 'round', lineJoin: 'round' },
    })
  })

  it('emits no path for a connector with no visible stroke', () => {
    const connector = element({
      kind: 'connector',
      text: null,
      style: { ...baseStyle, strokeWidth: 0 },
      connector: {
        source: { kind: 'point', point: { x: 0, y: 0 } },
        target: { kind: 'point', point: { x: 100, y: 100 } },
        routing: 'straight',
      },
    })
    const recorder = new RecordingTarget()

    renderPersistentScene(recorder, sceneFrom([connector]), 'light')

    expect(recorder.calls).toEqual([])
  })
})

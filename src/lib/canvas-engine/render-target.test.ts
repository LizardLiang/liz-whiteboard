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
  private commands: Array<RenderPathCommand> = []
  private lines: Array<RenderTextLine> = []
  private fontSize = 0
  private color = ''

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

  beginPath() {
    this.commands = []
  }

  moveTo(x: number, y: number) {
    this.commands.push({ kind: 'move', point: { x, y } })
  }

  lineTo(x: number, y: number) {
    this.commands.push({ kind: 'line', point: { x, y } })
  }

  cubicTo(
    c0x: number,
    c0y: number,
    c1x: number,
    c1y: number,
    x: number,
    y: number,
  ) {
    this.commands.push({
      kind: 'cubic',
      c0: { x: c0x, y: c0y },
      c1: { x: c1x, y: c1y },
      to: { x, y },
    })
  }

  closePath() {
    this.commands.push({ kind: 'close' })
  }

  paintPath(paint: RenderPaint) {
    this.calls.push({
      kind: 'path',
      payload: { commands: this.commands, paint },
    })
  }

  beginText(fontSize: number, color: string) {
    this.lines = []
    this.fontSize = fontSize
    this.color = color
  }

  textLine(text: string, x: number, y: number) {
    this.lines.push({ text, x, y })
  }

  endText() {
    this.calls.push({
      kind: 'text',
      payload: {
        lines: this.lines,
        fontSize: this.fontSize,
        color: this.color,
      },
    })
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
  it('returns only the requested editing layout instead of a scene-wide layout map', () => {
    const recorder = new RecordingTarget()
    const scene = sceneFrom([
      element({ id: 'first', text: 'first' }),
      element({ id: 'editing', text: 'edit me' }),
      element({ id: 'last', text: 'last' }),
    ])

    const editingLayout = renderPersistentScene(
      recorder,
      scene,
      'light',
      new Set(),
      'editing',
    )

    expect(editingLayout).toMatchObject({
      lines: [{ text: 'edit me' }],
    })
    expect(editingLayout).not.toBeInstanceOf(Map)
  })

  it('emits exact rectangle paint, wrapped alignment, and theme-resolved text', () => {
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([
        element({
          width: 60,
          text: 'alpha beta',
          style: {
            ...baseStyle,
            textAlign: 'right',
            verticalAlign: 'bottom',
          },
        }),
      ]),
      'dark',
    )

    expect(recorder.calls).toEqual([
      {
        kind: 'rect',
        payload: {
          x: 10,
          y: 20,
          width: 60,
          height: 80,
          radius: 8,
          paint: { fill: '#fff', stroke: '#123456', strokeWidth: 2 },
        },
      },
      {
        kind: 'text',
        payload: {
          lines: [
            { text: 'alpha', x: 22, y: 47.2 },
            { text: ' beta', x: 22, y: 69.6 },
          ],
          fontSize: 16,
          color: '#f8fafc',
        },
      },
    ])
  })

  it('emits a persistent group frame with exact resting and emphasized theme paint', () => {
    const group = element({
      id: 'group',
      kind: 'group',
      text: null,
      group: { childIds: [] },
    })
    const resting = new RecordingTarget()
    const emphasized = new RecordingTarget()

    renderPersistentScene(resting, sceneFrom([group]), 'light')
    renderPersistentScene(
      emphasized,
      sceneFrom([group]),
      'dark',
      new Set(['group']),
    )

    expect(resting.calls).toEqual([
      {
        kind: 'rect',
        payload: {
          x: 10,
          y: 20,
          width: 120,
          height: 80,
          radius: 0,
          paint: { stroke: 'rgba(59, 130, 246, 0.10)', strokeWidth: 1 },
        },
      },
    ])
    expect(emphasized.calls[0]).toMatchObject({
      payload: { paint: { stroke: '#60a5fa', strokeWidth: 1 } },
    })
  })

  it.each([
    ['straight', 'line'],
    ['curved', 'cubic'],
  ] as const)(
    'emits exact %s connector geometry and matching line/head paint',
    (routing, segmentKind) => {
      const recorder = new RecordingTarget()
      renderPersistentScene(
        recorder,
        sceneFrom([
          element({
            kind: 'connector',
            text: null,
            connector: {
              source: { kind: 'point', point: { x: 0, y: 0 } },
              target: { kind: 'point', point: { x: 100, y: 0 } },
              routing,
            },
          }),
        ]),
        'light',
      )

      expect(recorder.calls).toHaveLength(2)
      expect(recorder.calls[0]).toMatchObject({
        kind: 'path',
        payload: {
          commands: [
            { kind: 'move', point: { x: 0, y: 0 } },
            { kind: segmentKind },
          ],
          paint: { stroke: '#123456', strokeWidth: 2 },
        },
      })
      expect(recorder.calls[1]).toMatchObject({
        kind: 'path',
        payload: {
          commands: [
            { kind: 'move' },
            { kind: 'line', point: { x: 100, y: 0 } },
            { kind: 'line' },
          ],
          paint: {
            stroke: '#123456',
            strokeWidth: 2,
            lineJoin: 'round',
            lineCap: 'round',
          },
        },
      })
    },
  )

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
